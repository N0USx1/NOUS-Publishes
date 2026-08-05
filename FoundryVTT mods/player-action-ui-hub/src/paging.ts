/**
 * 扇区分页 —— 纯函数，无 Foundry 依赖。
 *
 * 为什么需要：实测 `game.pf2e.actions` 有 **70 条**，一圈放不下。
 * 过滤解决不了页数（去掉 downtime 与 exploration 也还剩 54 条），
 * 所以是**排序把对的东西顶到第 1 页 + 翻页兜住其余**
 * （见 `docs/2026-08-05-plan-v0.3-v0.6.md` 顶部的说明）。
 */

/**
 * 一页最多几个扇区。设计定档 §7 定的 7 ——
 * 再多扇区就细到点不准，而轮盘的卖点正是"不用瞄"。
 */
export const PAGE_SIZE = 7;

/**
 * 总页数。
 * **空列表也算一页**：返回 0 的话，调用处到处都要特判"零页"，
 * 而且回环取模会除零。
 */
export function pageCount(total: number): number {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/**
 * 把任意页码折回 `[0, count)`。
 *
 * ★ 回环放在这里而不是调用处，是为了让胶囊的 `‹ ›` 可以**无脑加减一**，
 *   不必自己判边界。
 * ⚠ 先加一轮再取模：JS 的 `%` 对负数返回负值，`-1 % 3` 是 `-1` 不是 `2`。
 */
export function normalizePage(page: number, count: number): number {
    if (count <= 0) return 0;
    return ((page % count) + count) % count;
}

/** 取第 `page` 页；页码超范围时按 `normalizePage` 回环。 */
export function pageOf<T>(items: T[], page: number): T[] {
    if (!items.length) return [];
    const p = normalizePage(page, pageCount(items.length));
    return items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
}
