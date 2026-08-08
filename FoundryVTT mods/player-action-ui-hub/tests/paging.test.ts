import { describe, it, expect } from "vitest";
import { pageOf, pageCount, normalizePage, carryPage, PAGE_SIZE } from "../src/paging";

/*
 * ⚠ **所有期望值都从 `PAGE_SIZE` 推**，不写死数字（2026-08-07 把 7 改成 9 时发现）。
 *   原来这里写死了 7，一改上限就 6 条同时变红 —— 而它们验的根本不是"上限等于 7"，
 *   是"分页会不会漏、会不会重、回环对不对"。
 *   **写死的期望值会把「参数变了」报成「功能坏了」**，而两者要看的东西完全不同。
 */
const 每页 = PAGE_SIZE;
/** 造两页半，好让"最后一页不满"这条真的不满。 */
const items = Array.from({ length: 每页 * 2 + 3 }, (_, i) => `s${i}`);
const 末页起 = 每页 * 2;

describe("pageCount", () => {
    it("按每页上限算总页数", () => {
        expect(pageCount(items.length)).toBe(3);
        expect(pageCount(每页 * 2)).toBe(2);
        expect(pageCount(每页)).toBe(1);
    });

    it("上限本身要落在能点得准的范围里", () => {
        // ★ 9 是 Nous 定的上限：再多扇区就细到点不准，而轮盘的卖点是"不用瞄"
        expect(PAGE_SIZE).toBeGreaterThanOrEqual(7);
        expect(PAGE_SIZE).toBeLessThanOrEqual(9);
    });

    it("空也算一页 —— 免得除零，也免得到处特判「零页」", () => {
        expect(pageCount(0)).toBe(1);
    });
});

describe("normalizePage 页码回环", () => {
    it("范围内原样返回", () => {
        expect(normalizePage(1, 3)).toBe(1);
    });

    it("★ 超出末页回到第 0 页", () => {
        expect(normalizePage(3, 3)).toBe(0);
    });

    it("★ 负页码回到末页（在第 0 页点 ‹）", () => {
        expect(normalizePage(-1, 3)).toBe(2);
    });

    it("连翻多轮也不会跑飞", () => {
        expect(normalizePage(7, 3)).toBe(1);
        expect(normalizePage(-7, 3)).toBe(2);
    });
});

describe("pageOf", () => {
    it("第 0 页是前一整页", () => {
        expect(pageOf(items, 0)).toEqual(items.slice(0, 每页));
    });

    it("最后一页可以不满", () => {
        expect(pageOf(items, 2)).toEqual(items.slice(末页起));
        expect(pageOf(items, 2).length).toBeLessThan(每页);
    });

    it("★ 页码回环：最后一页再往后回到第 0 页", () => {
        expect(pageOf(items, 3)).toEqual(items.slice(0, 每页));
    });

    it("★ 负页码回环到最后一页", () => {
        expect(pageOf(items, -1)).toEqual(items.slice(末页起));
    });

    it("空列表返回空数组而不抛错", () => {
        expect(pageOf([], 0)).toEqual([]);
        expect(pageOf([], -1)).toEqual([]);
    });

    it("★ 所有页拼起来正好是原列表，不重不漏", () => {
        const all = [0, 1, 2].flatMap(p => pageOf(items, p));
        expect(all).toEqual(items);
    });

    it("★ 正好装满一页时不该多出一页（8 个法术不该被切成 7+1）", () => {
        // Nous 2026-08-07 实测：他的 Magus 8 个法术被切成两页，第二页只有一个
        const 八 = Array.from({ length: 8 }, (_, i) => `x${i}`);
        expect(pageCount(八.length)).toBe(1);
        expect(pageOf(八, 0)).toEqual(八);
    });
});

/*
 * `carryPage` —— 重建之后把翻页位置带过来。
 *
 * ⚠ 这一组钉的是一个**已经发生过的**问题（2026-08-08，Nous 实机）：
 *   在 1 环页点休息，盘弹回戏法页，症状被报成"ui 不更新"。
 *   实测双向绑定那条链全通（hook 放了、refresh 跑了、点阵数跟着变），
 *   坏的是**位置**。所以这里验的不是"数据对不对"，是"人还在不在原地"。
 */
const 环 = (...ls: string[]) => ls.map(label => ({ label }));

describe("carryPage 重建后带回翻页位置", () => {
    it("★ 回归：在 1 环页休息，重建后还在 1 环页（不是弹回戏法页）", () => {
        const 旧 = { page: 1, groups: 环("Cantrips", "1st Rank", "2nd Rank", "3rd Rank") };
        // rebuild 出来的一律是 page: 0 —— 这正是原来的病根
        const 新 = { page: 0, groups: 环("Cantrips", "1st Rank", "2nd Rank", "3rd Rank") };
        expect(carryPage(旧, 新, 4)).toBe(1);
    });

    it("★★ 按标签找回，不按下标：前面的环整页消失时不许指到别的环上", () => {
        // 戏法页恒在，1 环用光了整页消失（spell-slots：uses.value <= 0 整组跳过）
        const 旧 = { page: 2, groups: 环("Cantrips", "1st Rank", "2nd Rank") };  // 在 2 环
        const 新 = { page: 0, groups: 环("Cantrips", "2nd Rank") };
        // 按下标带会得到 2 → 越界回环到 0（戏法页）；按标签应该落在新的 1
        expect(carryPage(旧, 新, 2)).toBe(1);
        expect(新.groups[carryPage(旧, 新, 2)].label).toBe("2nd Rank");
    });

    it("★ 找不到同名（正看着的那一环刚被用光）→ 退回下标并收进合法范围", () => {
        const 旧 = { page: 2, groups: 环("Cantrips", "1st Rank", "2nd Rank") };
        const 新 = { page: 0, groups: 环("Cantrips", "1st Rank") };
        expect(carryPage(旧, 新, 2)).toBe(0);   // normalizePage(2, 2)
    });

    it("普通分页（没有分组）按页码带，且不越界", () => {
        expect(carryPage({ page: 1 }, { page: 0 }, 3)).toBe(1);
        expect(carryPage({ page: 2 }, { page: 0 }, 2)).toBe(0);   // 页数变少 → 回环
    });

    it("一侧没有分页状态时不硬带", () => {
        expect(carryPage(undefined, { page: 0 }, 3)).toBe(0);
        expect(carryPage({ page: 2 }, undefined, 3)).toBe(0);
    });

    it("旧页码本身越界也不会带出越界的结果", () => {
        const 旧 = { page: 99, groups: 环("Cantrips", "1st Rank") };
        const 新 = { page: 0, groups: 环("Cantrips", "1st Rank") };
        // 99 回环到 1 → 标签 "1st Rank" → 新表里也是 1
        expect(carryPage(旧, 新, 2)).toBe(1);
    });
});
