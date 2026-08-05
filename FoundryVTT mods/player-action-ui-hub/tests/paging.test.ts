import { describe, it, expect } from "vitest";
import { pageOf, pageCount, normalizePage, PAGE_SIZE } from "../src/paging";

const items = Array.from({ length: 17 }, (_, i) => `s${i}`);

describe("pageCount", () => {
    it("按每页上限算总页数", () => {
        expect(PAGE_SIZE).toBe(7);
        expect(pageCount(17)).toBe(3);
        expect(pageCount(14)).toBe(2);
        expect(pageCount(7)).toBe(1);
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
    it("取第 0 页是前 7 个", () => {
        expect(pageOf(items, 0)).toEqual(items.slice(0, 7));
    });

    it("最后一页可以不满", () => {
        expect(pageOf(items, 2)).toEqual(items.slice(14, 17));
    });

    it("★ 页码回环：最后一页再往后回到第 0 页", () => {
        expect(pageOf(items, 3)).toEqual(items.slice(0, 7));
    });

    it("★ 负页码回环到最后一页", () => {
        expect(pageOf(items, -1)).toEqual(items.slice(14, 17));
    });

    it("空列表返回空数组而不抛错", () => {
        expect(pageOf([], 0)).toEqual([]);
        expect(pageOf([], -1)).toEqual([]);
    });

    it("★ 所有页拼起来正好是原列表，不重不漏", () => {
        const all = [0, 1, 2].flatMap(p => pageOf(items, p));
        expect(all).toEqual(items);
    });
});
