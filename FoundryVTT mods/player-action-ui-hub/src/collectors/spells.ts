import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { SPELL_ENTRY_ICONS, SPELL_ENTRY_DEFAULT } from "../icons";
import { spellGroupsOf, spellPages, slotMatrix, type SlotColumn } from "../spell-slots";
import { detailLine, HUB_CLAUSE_MAX } from "../triggers";

/**
 * 施法条目的最小形状。
 *
 * ⚠ **`id` 必须放进来，不能靠下标回查原数组。** 过滤之后下标就错位了 ——
 *   executor 的 `findStrike` 当年正是这么错的（那处注释里本来就警告过）。
 *   凡是"先 filter 再按 i 取原数组"的写法，一律是这个错的变体。
 */
export interface EntryLike {
    id: string;
    name: string;
    category?: string;
    isFocusPool?: boolean;
    spellCount: number;
}

/** 专注点池。实测路径 `actor.system.resources.focus` = `{value,max,cap}`。 */
export interface FocusPool { value: number; max: number }

/** 某一环位的法术位。实测路径 `entry.system.slots.slotN` = `{max,value,prepared}`。 */
export interface Slot { max: number; value: number }

/**
 * 能用的施法条目。
 *
 * ⚠ **空条目必须滤掉**：实测 Magus 的 `Rituals` 条目 `spellCount` 为 0，
 *   留着会在法术层出现一个点不动的空格。
 */
export function usableEntries(entries: EntryLike[]): EntryLike[] {
    return entries.filter(e => (e.spellCount ?? 0) > 0);
}

/** 专注点余量徽章；没池子或池子为 0 就不画。 */
export function focusBadge(pool: FocusPool | null): string | undefined {
    if (!pool || pool.max <= 0) return undefined;
    return `✦ ${pool.value}/${pool.max}`;
}

/**
 * 法术位余量徽章。
 * ★ 这是玩家真正关心的那个数：**这一环还剩几个位**。
 *   戏法与专注法术没有位，返回 undefined（不画）。
 */
export function slotBadge(slot: Slot | null): string | undefined {
    if (!slot || slot.max <= 0) return undefined;
    return `◈ ${slot.value}/${slot.max}`;
}

/**
 * 法术的动作消耗。
 * ★ 用 `actionGlyph`（实测它直接就是 `"1"` / `"2"`），不去解析 `system.time.value` ——
 *   后者是自由文本（"10 minutes" 之类），解析它等于自己造一套规则。
 */
export function spellCost(spell: { actionGlyph?: string }): SectorData["cost"] {
    switch (spell.actionGlyph) {
        case "1": return "1";
        case "2": return "2";
        case "3": return "3";
        case "R": return "reaction";
        case "F": return "free";
        default: return null;    // 施法时间以分钟/小时计的，不画记号
    }
}

/**
 * 第一层：施法条目。
 *
 * ★ 分两层而不是一次铺平：实测一个角色可以同时有准备位、专注、仪式三个条目，
 *   铺平之后同名法术会重复出现，且分不清用的是哪个位。
 */
export function collectSpellEntries(actor: ActorPF2e | null): SectorData[] {
    try {
        const contents: any[] = (actor as any)?.spellcasting?.contents ?? [];
        const entries: EntryLike[] = contents.map(e => ({
            id: e.id,
            name: e.name,
            category: e.category ?? e.system?.prepared?.value,
            isFocusPool: e.isFocusPool,
            spellCount: e.spells?.size ?? 0,
        }));
        const pool = (actor as any)?.system?.resources?.focus ?? null;

        // ⚠ id 取自 e 自己，**不是** contents[i] —— 过滤后下标已经错位
        return usableEntries(entries).map((e): SectorData => ({
            id: `spellentry:${e.id}`,
            label: e.name,
            // 条目自带的是 pf2e 的默认占位图（三个条目长一样），换成按类别区分的
            img: SPELL_ENTRY_ICONS[e.category ?? ""] ?? SPELL_ENTRY_DEFAULT,
            cost: null,
            state: "normal",
            badge: e.isFocusPool ? focusBadge(pool) : undefined,
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectSpellEntries 失败", err);
        return [];
    }
}

/**
 * 第二层：某个施法条目下的法术。
 *
 * ⚠ **按 `spell.rank` 施放，不自己算提升环位**：`rank` 是 pf2e 已经算好的
 *   "这个法术现在按几环施放"（实测戏法 `baseRank: 1` 但 `rank: 3`，
 *   系统自动升到了角色的最高环）。我们只做遥控器，规则计算一概交给系统。
 */
/** 法术层的一层盘面：扇区全量 + 每一环占哪一段。 */
export interface SpellLevelData {
    sectors: SectorData[];
    groups: { label: string; badge?: string; from: number; count: number }[];
    /** 点阵图的列（一列一环）；退化路径下为空 */
    columns: SlotColumn[];
}

/**
 * 第二层：某个施法条目下的法术，**一页一环**。
 *
 * ★ 页 = 环（Nous 2026-08-08 定）：和角色卡上那几栏一一对应。
 *   同一个法术能升几环就在几页上各出现一次 —— 那不是重复，
 *   **卡上本来就是这么显示的**，而且点哪一页就按哪一环放，一次多余点击都没有。
 *
 * ⚠ 扇区 id 带上 `castRank` 与 `slotIndex`：
 *   同一个 spellId 会在多页出现，只靠 spellId **认不出玩家点的是哪一环**。
 */
export function collectSpells(actor: ActorPF2e | null, entryId: string): SpellLevelData {
    const 空: SpellLevelData = { sectors: [], groups: [], columns: [] };
    try {
        const entry = (actor as any)?.spellcasting?.get?.(entryId);
        if (!entry) return 空;

        /*
         * ★★ **优先照角色卡的分组搬**。
         * ⚠ 拿不到分组才走退化路径（按 `entry.spells` 平铺）——
         *   那条路**看不见环位**，所以只是不瞎，不是等价。
         */
        const groups = spellGroupsOf(actor, entryId);
        if (groups) {
            const pages = spellPages(groups, (k: string) => game.i18n.localize(k));
            const sectors: SectorData[] = [];
            const ranges: SpellLevelData["groups"] = [];
            for (const p of pages) {
                ranges.push({ label: p.label, badge: p.badge, from: sectors.length, count: p.entries.length });
                for (const e of p.entries) {
                    sectors.push({
                        id: `spell:${entryId}:${e.spellId}:${e.castRank}:${e.slotIndex}`,
                        label: e.name,
                        img: e.img,
                        cost: spellCost({ actionGlyph: e.actionGlyph }),
                        /*
                         * ★★ **用掉的位置灰保留，不抽走**（Nous 2026-08-08）：
                         *   > "用掉的就直接消失了，这个应该置灰保留，按照原来的 sheet
                         *   >  点击弹窗无效，我们那个红框置灰也应该做到一样的效果。"
                         *   ★ 角色卡对用掉的法术是**划线保留**（截图里 Force Barrage / Acid Grip）。
                         *     整条抽走会让这一页的格数随用量变化，玩家每施一次法就要重新找位置
                         *     （playbook 一：格数不变、宽度可变）。
                         * ⚠ `gated` 在本盘里是**红框 + 压暗**，而且**照旧可点** ——
                         *   点了由 pf2e 自己拒绝（"slot is already expended"），
                         *   与角色卡上点划线法术的行为一致。
                         * ⚠ 理由**指得到字段**（`slot.expended`），不是我们编的（playbook 7.5）。
                         */
                        state: e.expended ? "gated" : "normal",
                        reason: e.expended ? "That slot is already expended." : undefined,
                        // ⚠ 这里**不再画余量角标** —— 余量是整环共用的一个数，
                        //   印在每一格上是同一件事说 N 遍。它现在在毂里那一行（页标签）。
                        // ★ 法术也要有说明（Nous 2026-08-08："各种法术也没有功能说明"）
                        detail: detailLine(e.description, false, HUB_CLAUSE_MAX,
                                           (k: string) => game.i18n.localize(k)) ?? undefined,
                        infoUuid: e.uuid,
                    });
                }
            }
            return { sectors, groups: ranges, columns: slotMatrix(groups) };
        }

        // —— 退化路径：拿不到卡上的分组 ——
        const slots = entry.system?.slots ?? {};
        return {
            sectors: [...(entry.spells ?? [])].map((s: any): SectorData => {
                const slot = (s.isCantrip || s.isFocusSpell) ? null : (slots[`slot${s.rank}`] ?? null);
                return {
                    id: `spell:${entryId}:${s.id}`,
                    label: s.name,
                    img: s.img,
                    cost: spellCost(s),
                    state: "normal",
                    badge: slotBadge(slot),
                };
            }),
            groups: [],
            columns: [],
        };
    } catch (err) {
        console.error("player-action-ui-hub | collectSpells 失败", err);
        return 空;
    }
}
