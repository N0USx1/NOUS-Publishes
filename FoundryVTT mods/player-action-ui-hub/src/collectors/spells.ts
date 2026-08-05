import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";

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
export function collectSpells(actor: ActorPF2e | null, entryId: string): SectorData[] {
    try {
        const entry = (actor as any)?.spellcasting?.get?.(entryId);
        if (!entry) return [];
        const slots = entry.system?.slots ?? {};

        return [...(entry.spells ?? [])].map((s: any): SectorData => {
            // 戏法与专注法术不占法术位 —— 只有普通法术才查该环的余量
            const slot = (s.isCantrip || s.isFocusSpell) ? null : (slots[`slot${s.rank}`] ?? null);
            return {
                id: `spell:${entryId}:${s.id}`,
                label: s.name,
                img: s.img,
                cost: spellCost(s),
                state: "normal",
                badge: slotBadge(slot),
            };
        });
    } catch (err) {
        console.error("player-action-ui-hub | collectSpells 失败", err);
        return [];
    }
}
