import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "./types";

/**
 * G11 · **条件层数一键递减**（Nous 2026-08-07 在三个方案里选了这个：
 * "2，把感觉玩家感知上好一点"）。
 *
 * ★★ **缺口是实测出来的，而且它正在污染我们已经在显示的东西**：
 *
 *   | 谁做 | 实测（2026-08-07） |
 *   |---|---|
 *   | effect 到期 | ✅ **pf2e 自己做**，`automation.removeExpiredEffects` 默认开 |
 *   | **条件层数递减** | ⛔ **完全没有**。frightened 2 跨完整一个回合仍是 2；stunned 3 纹丝不动 |
 *   | 是不是开关被关了 | ❌ 不是。68 条 pf2e 设置里**根本没有这一项** |
 *
 *   ★ 为什么这条非做不可：动作经济读 stunned 算"这回合少几个动作"，
 *     而 stunned 永远不减 —— 我们的动作格会一路少下去，
 *     **又是一个看起来正确的错数**。
 *
 * ★ **为什么是"一键"而不是"自动"**（Nous 拍板，理由也站得住）：
 *   自动递减 = 替系统判规则 + 未经请求就写 actor。
 *   摆一格让他点一下，就仍然是"**玩家发出的指令**"——与整个模组同形。
 *
 * ★ **不登记"哪些条件会递减"**：任何带层数的条件都摆出来让他减。
 *   登记一张"该减的清单"就是又抄一遍规则书，而且会随版本腐坏。
 *   下面那张 `TURN_HINTS` 只是**提示文案**，少一条顶多少一句提示，
 *   不影响任何一格能不能点 —— 这是它可以存在的唯一理由。
 */

/** 一条带层数的条件。纯数据，便于单测。 */
export interface ConditionLike {
    slug: string;
    name: string;
    img?: string;
    /** 当前层数；没有层数的条件（如 off-guard）为 null */
    value: number | null;
}

/**
 * 规则里"到某个时点自己会降"的那几条，纯**提示文案**。
 *
 * ⚠ 它不参与任何过滤 —— 表里没有的条件照样列得出来、点得下去。
 *   一旦让它决定"能不能点"，这张表就变成了规则书的副本。
 */
export const TURN_HINTS: Record<string, string> = {
    frightened: "Rules: reduce by 1 at the end of each of your turns.",
    stunned: "Rules: reduce by the number of actions you lose to it.",
};

/**
 * 去掉名字末尾的层数。
 *
 * ⚠ 实测 pf2e 的条件 `name` **自带层数**（"Frightened 2"）。
 *   照抄的话扇区会写成 "Frightened 2" 而记号又画一个 "2" ——
 *   同一个数出现两次，还会在层数变化时一个变一个不变（记号是现读的，名字是快照）。
 */
export function baseName(name: string): string {
    return String(name).replace(/\s+\d+$/, "");
}

/** 条件扇区的 id 前缀。 */
export const CONDITION_PREFIX = "cond:";

/**
 * 挑出能递减的条件：**有层数的**。
 *
 * ⚠ 没有层数的条件（off-guard、prone…）不列 —— "减一层"对它们没有意义，
 *   列出来只会让玩家点一下什么也没发生，那比不列更糟。
 * ★ 有提示文案的排前面：它们是玩家真的忘了要减的那几条。
 */
export function pickConditions(conditions: ConditionLike[]): ConditionLike[] {
    return conditions
        .filter(c => typeof c.value === "number" && c.value > 0)
        .sort((a, b) => {
            const 前 = (c: ConditionLike) => (TURN_HINTS[c.slug] ? 0 : 1);
            return 前(a) - 前(b) || a.name.localeCompare(b.name);
        });
}

/** 采集条件扇区。只读，绝不写 actor —— 写发生在点击那一刻。 */
export function collectConditions(actor: ActorPF2e | null): SectorData[] {
    try {
        /*
         * ⚠ 读 `conditions.active` 而不是 `itemTypes.condition`：
         *   前者是 pf2e **解析过压制关系之后**的结果（震慑压制缓慢那一条），
         *   后者是原始条目。拿原始条目会把被压制的那条也摆出来，
         *   而玩家减它一点用都没有 —— 与动作经济读同一个源，两处才不会互相打架。
         */
        const list: ConditionLike[] = ((actor as any)?.conditions?.active ?? []).map((c: any) => ({
            slug: String(c?.slug ?? ""),
            name: String(c?.name ?? c?.slug ?? ""),
            img: c?.img,
            value: typeof c?.value === "number" ? c.value : null,
        }));

        return pickConditions(list).map((c): SectorData => {
        const 名 = baseName(c.name);
        return {
            id: `${CONDITION_PREFIX}${c.slug}`,
            label: 名,
            img: c.img,
            cost: null,
            // 层数直接印在扇区上：它是"不看就得记"的那类信息
            badge: String(c.value),
            detail: TURN_HINTS[c.slug]
                ? `${TURN_HINTS[c.slug]} Click to reduce to ${(c.value ?? 1) - 1}.`
                : `Click to reduce ${名} to ${(c.value ?? 1) - 1}.`,
            state: "normal",
        };
        });
    } catch (err) {
        console.error("player-action-ui-hub | collectConditions 失败", err);
        return [];
    }
}
