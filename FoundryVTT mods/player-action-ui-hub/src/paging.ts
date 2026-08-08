/**
 * 扇区分页 —— 纯函数，无 Foundry 依赖。
 *
 * 为什么需要：实测 `game.pf2e.actions` 有 **70 条**，一圈放不下。
 * 过滤解决不了页数（去掉 downtime 与 exploration 也还剩 54 条），
 * 所以是**排序把对的东西顶到第 1 页 + 翻页兜住其余**
 * （见 `docs/2026-08-05-plan-v0.3-v0.6.md` 顶部的说明）。
 */

/**
 * 一页最多几个扇区。
 *
 * ★ **7 → 9**（Nous 2026-08-07 定）：实测他的 Magus 一共 8 个法术，
 *   被切成 7+1 两页 —— 第二页只有孤零零一个，翻一次页去拿它，
 *   比一圈多两格难点得多。**分页是为了放不下，不是为了整齐。**
 *
 * ⚠ 9 是他给的上限（"最大值9？"）。再往上扇区就细到点不准了，
 *   而轮盘的卖点正是"不用瞄"——这个数不要因为"某个角色刚好 10 个"再往上调，
 *   那是让最坏的一例决定所有人的手感。
 */
export const PAGE_SIZE = 9;

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

/** `carryPage` 只认这一点形状，不依赖 `WheelLevel`。 */
export interface PagingLike {
    page: number;
    groups?: { label: string }[];
}

/**
 * 重建盘面之后，把**翻页位置带过来**。
 *
 * ★ 起因（Nous 2026-08-08 实机发现，症状报成"休息了 ui 不更新"）：
 *   每个 `rebuild` 返回的都是 `paging: { page: 0 }`，而 `refresh()` 原来只带了
 *   `variant.index`。于是**翻到第 2 页以后，任何一次角色数据变化都把人弹回第 1 页** ——
 *   在 1 环页点休息，盘跳回戏法页，而戏法页上没有环 badge，
 *   看起来就像"数没变"。★ 真正坏的是位置，被读成了数据不刷新。
 *
 * ★★ **有 groups 时按标签找回，不按下标**：
 *   用光的环整页会消失（`spell-slots.ts` 里 `uses.value <= 0` 整组跳过），
 *   下标带过去会指到**别的环**上 —— 而"我在看 2 环"和"我在看第 2 页"是两回事，
 *   带错了比弹回第 1 页更坏：它看起来成功了。
 *
 * ⚠ 找不到同名（那一环刚被用光、这一页没了）→ 退回按下标，
 *   再由 `normalizePage` 收进合法范围。宁可落在邻近的一页，也不要越界。
 */
export function carryPage(
    prev: PagingLike | undefined,
    next: PagingLike | undefined,
    nextPageCount: number,
): number {
    if (!prev || !next) return next?.page ?? 0;
    const 旧 = prev.groups?.length
        ? prev.groups[normalizePage(prev.page, prev.groups.length)]?.label
        : undefined;
    if (旧 !== undefined && next.groups?.length) {
        const i = next.groups.findIndex((g) => g.label === 旧);
        if (i >= 0) return i;
    }
    return normalizePage(prev.page, nextPageCount);
}
