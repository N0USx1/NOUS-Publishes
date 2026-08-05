import { describe, it, expect } from "vitest";
import { withUse, promotedRank, PROMOTE_AT, type UsageRecord } from "../src/usage";

const empty = (): UsageRecord => ({ counts: {}, promoted: [] });
const useN = (slug: string, n: number, from: UsageRecord = empty()): UsageRecord => {
    let rec = from;
    for (let i = 0; i < n; i++) rec = withUse(rec, slug);
    return rec;
};

describe("withUse 计数", () => {
    it("每次调用加一", () => {
        expect(useN("trip", 3).counts.trip).toBe(3);
    });

    it("不同动作各记各的", () => {
        const rec = withUse(withUse(empty(), "trip"), "seek");
        expect(rec.counts).toEqual({ trip: 1, seek: 1 });
    });

    it("是纯函数，不改原记录", () => {
        const before = empty();
        withUse(before, "trip");
        expect(before.counts).toEqual({});
    });
});

describe("升进常用区的阈值", () => {
    it(`不到 ${PROMOTE_AT} 次不升 —— 顺手点一次不该改变盘面`, () => {
        expect(useN("trip", PROMOTE_AT - 1).promoted).toEqual([]);
    });

    it(`满 ${PROMOTE_AT} 次才升`, () => {
        expect(useN("trip", PROMOTE_AT).promoted).toEqual(["trip"]);
    });

    it("升过之后再用也不会重复登记", () => {
        expect(useN("trip", PROMOTE_AT + 10).promoted).toEqual(["trip"]);
    });
});

/*
 * ★★★ 这一组是本模组的位置稳定性铁律。
 *   谁把 promoted 改成"按次数排序"，下面立刻红。
 */
describe("★ promoted 只在末尾追加，已有位置永不变", () => {
    it("先达标的排在前面，与后来谁用得更多无关", () => {
        let rec = useN("aaa", PROMOTE_AT);            // aaa 先达标
        rec = useN("bbb", PROMOTE_AT, rec);           // bbb 后达标
        rec = useN("bbb", 50, rec);                   // bbb 之后狂用
        expect(rec.promoted).toEqual(["aaa", "bbb"]); // ★ 顺序不变
        expect(rec.counts.bbb).toBeGreaterThan(rec.counts.aaa);
    });

    it("新成员一律追加到末尾", () => {
        let rec = useN("aaa", PROMOTE_AT);
        rec = useN("bbb", PROMOTE_AT, rec);
        rec = useN("ccc", PROMOTE_AT, rec);
        expect(rec.promoted).toEqual(["aaa", "bbb", "ccc"]);
    });

    it("★ 已有成员的下标在新成员加入后原样不动", () => {
        let rec = useN("aaa", PROMOTE_AT);
        const rankBefore = promotedRank(rec);
        const aaaBefore = rankBefore("aaa");
        rec = useN("zzz", PROMOTE_AT, rec);
        expect(promotedRank(rec)("aaa")).toBe(aaaBefore);
    });
});

describe("promotedRank", () => {
    it("按升入先后给下标", () => {
        const rank = promotedRank({ counts: {}, promoted: ["a", "b", "c"] });
        expect([rank("a"), rank("b"), rank("c")]).toEqual([0, 1, 2]);
    });

    it("不在常用区的返回 Infinity（排在所有常用项之后）", () => {
        const rank = promotedRank({ counts: {}, promoted: ["a"] });
        expect(rank("nope")).toBe(Number.POSITIVE_INFINITY);
        expect(rank("a")).toBeLessThan(rank("nope"));
    });

    it("空常用区时人人都是 Infinity", () => {
        const rank = promotedRank(empty());
        expect(rank("anything")).toBe(Number.POSITIVE_INFINITY);
    });
});
