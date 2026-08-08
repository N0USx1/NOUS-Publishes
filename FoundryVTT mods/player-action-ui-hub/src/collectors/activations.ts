import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { costToSectorCost } from "./actions";
import { detailLine, HUB_CLAUSE_MAX } from "../triggers";

/**
 * **激活**：卷轴、魔杖、药水、炼金药剂，以及带激活的魔法物品。
 *
 * ★ 起因（Nous 2026-08-07）：
 *   > "要是这个 class 没有 spell，就看看有没有 activation（卷轴）……
 *   >  如果都没有，就不要显示 spell 栏了。"
 *
 *   ★ 它填的是同一个坑：**法术那一格对一半职业永远是空的**，
 *     而那一半职业身上常常揣着卷轴和药水 —— 同样是"点一下放个效果"，
 *     只是来源从法术书换成了背包。
 *
 * ★★ **筛选判据是 pf2e 自己的两个 getter**（2026-08-07 实测标定）：
 *
 *   | 条目 | isMagical | isAlchemical | 收不收 |
 *   |---|---|---|---|
 *   | Scroll of Grim Tendrils | ✔ | | 收 |
 *   | Wand of Mystic Armor | ✔ | | 收 |
 *   | Healing Potion | ✔ | | 收 |
 *   | Elixir of Life | | ✔ | 收 |
 *   | Marvelous Miniature | ✔ | | 收 |
 *   | Rations / Chalk / Oil | | | **不收** |
 *
 *   ⚠ 我先想按 `category !== "other"` 筛 —— 那会把 Marvelous Miniature
 *     （category 是 `other` 的一件真魔法物品）一起丢掉。
 *   ⚠ 也不能按 `consumable` 特性筛：**魔杖没有那个特性**（实测 `["magical","wand"]`）。
 *   ★ 两个 getter 是 pf2e 用来回答"这东西算不算魔法/炼金"的**那个**判据，照用就行。
 *
 * ⚠ 用完的不收（`uses.value <= 0`）：摆一个点了没反应的格子会被读成"坏了"。
 */

/** 这个物品收不收。抽出来才能不依赖 Foundry 做单测。 */
export interface ActivatableLike {
    id: string;
    name: string;
    img?: string;
    type: string;
    isMagical?: boolean;
    isAlchemical?: boolean;
    /** `system.uses`，没有次数概念的物品可以缺省 */
    uses?: { value?: number; max?: number } | null;
    /** `system.activations` 的键数；> 0 说明这件穿戴物品自带激活动作 */
    activationCount?: number;
    /** 激活/使用要花几个动作 */
    actions?: number | null;
    description?: string;
}

/** 还有没有得用。⚠ **没有 uses 字段不等于用完了** —— 穿戴物品本来就没有次数。 */
export function hasCharges(i: ActivatableLike): boolean {
    if (!i.uses || i.uses.value === undefined) return true;
    return Number(i.uses.value) > 0;
}

/**
 * 挑出可激活的条目。
 *
 * ★ 两条路各自成立、取并集：
 *   ① 魔法/炼金的消耗品（卷轴、魔杖、药水、药剂）；
 *   ② 任何**自带激活动作**的物品（穿戴的魔法物品走这条）。
 */
export function pickActivatable(items: ActivatableLike[]): ActivatableLike[] {
    return items
        .filter(i => {
            if (!hasCharges(i)) return false;
            if ((i.activationCount ?? 0) > 0) return true;
            return i.type === "consumable" && (i.isMagical === true || i.isAlchemical === true);
        })
        // 按名字排：这一格的用途是"翻一翻我还带着什么"，位置稳定比排得聪明重要
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** 采集激活扇区。只读，绝不写 actor。 */
export function collectActivations(actor: ActorPF2e | null): SectorData[] {
    try {
        const items: ActivatableLike[] = ((actor as any)?.items?.contents ?? []).map((i: any) => ({
            id: i.id,
            name: i.name,
            img: i.img,
            type: i.type,
            isMagical: i.isMagical,
            isAlchemical: i.isAlchemical,
            uses: i.system?.uses ?? null,
            activationCount: Object.keys(i.system?.activations ?? {}).length,
            // ⚠ 消耗品的动作消耗不在 `system.actions` 上，多数是 1 个动作；
            //   读不到就不画记号（宁可不画也不画错一个，同 costToSectorCost 的立场）
            actions: i.system?.actions?.value ?? null,
            description: i.system?.description?.value ?? "",
        }));
        return pickActivatable(items).map((i): SectorData => ({
            id: `activate:${i.id}`,
            label: i.name,
            img: i.img,
            cost: costToSectorCost(i.actions ?? null),
            // 还剩几次是"不看就会点错"的信息 → 印在扇区上
            badge: i.uses && Number.isFinite(Number(i.uses.max)) && Number(i.uses.max) > 1
                ? `${Number(i.uses.value ?? 0)}/${Number(i.uses.max)}` : undefined,
            detail: detailLine(i.description, false, HUB_CLAUSE_MAX,
                               (k) => game.i18n.localize(k)) ?? undefined,
            state: "normal",
            infoUuid: (actor as any)?.items?.get?.(i.id)?.uuid,
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectActivations 失败", err);
        return [];
    }
}
