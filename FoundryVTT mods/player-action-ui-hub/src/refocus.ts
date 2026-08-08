import type { SectorData } from "./types";

/**
 * **Refocus** —— 把焦点点数拿回来的那一步。
 *
 * ★ 起因（Nous 2026-08-07）："另外一个 focus spell 也没有 recharge。"
 *
 * ★★ **这一条系统真的有，只是不在我们取的那个集合里**（2026-08-07 实测）：
 *   - `game.pf2e.actions` 注册表里**没有** refocus（那个集合只收遭遇战动作）；
 *   - 但 `pf2e.actionspf2e` 纲要里有一条完整的 `Refocus`
 *     （`Compendium.pf2e.actionspf2e.Item.OSefkMgojBLqmRDh`）。
 *   所以描述、图标、规则文本一律照它取，我们一个字都不编。
 *
 * ⚠ **恢复点数得我们自己写** —— pf2e 对 Refocus 没有任何自动化
 *   （只有 `restForTheNight` 会把池子填满）。这不是"替系统判规则"：
 *   Refocus 恢复 1 点是无条件的，而且这一下是**玩家自己点的**。
 *   ⚠ 但要**说出来**：毂里那句话写明"会加 1 点"，
 *     未经预告地改玩家的资源，比不改更糟。
 *
 * ⚠ **池子满了就不摆这一格**：满的时候点它什么也不会发生，
 *   而一个点了没反应的格子会让人以为功能坏了。
 */
export const REFOCUS_UUID = "Compendium.pf2e.actionspf2e.Item.OSefkMgojBLqmRDh";
export const REFOCUS_ID = "refocus";

/** 焦点池的形状；没有焦点的角色整个字段都不存在。 */
export interface FocusPool { value?: number; max?: number }

/** 还缺几点。⚠ 没有池子（max 为 0 或缺失）时返回 0 —— 这类角色不该看到这一格。 */
export function focusMissing(pool: FocusPool | null | undefined): number {
    const max = Number(pool?.max ?? 0);
    if (!Number.isFinite(max) || max <= 0) return 0;
    const val = Number(pool?.value ?? 0);
    return Math.max(0, max - (Number.isFinite(val) ? val : 0));
}

/**
 * 焦点没满时给出那一格；满了或没有焦点返回 null。
 *
 * @param label 纲要里那条 `Refocus` 的名字与图标（由调用方 `fromUuidSync` 取，保持本函数可测）
 */
export function refocusSector(
    pool: FocusPool | null | undefined,
    label: { name: string; img?: string } = { name: "Refocus" },
): SectorData | null {
    const 缺 = focusMissing(pool);
    if (缺 <= 0) return null;
    return {
        id: REFOCUS_ID,
        label: label.name,
        img: label.img,
        // ⚠ **不画动作记号**：Refocus 是 10 分钟的探索活动，不花遭遇战动作点。
        //   画一个 ◆ 会让它看起来能在战斗轮里点一下就好。
        cost: null,
        state: "normal",
        detail: `10 minutes of exploration. Restores 1 Focus Point (${Number(pool?.value ?? 0)}/${Number(pool?.max ?? 0)} now).`,
    };
}

/** 恢复之后的新点数 —— 不许超过上限。 */
export function refocusedValue(pool: FocusPool | null | undefined): number {
    const max = Number(pool?.max ?? 0);
    const val = Number(pool?.value ?? 0);
    return Math.min(max, (Number.isFinite(val) ? val : 0) + 1);
}
