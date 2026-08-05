import { describe, it, expect } from "vitest";
import { usableEntries, focusBadge, slotBadge, spellCost, type EntryLike } from "../../src/collectors/spells";

/*
 * 断言对着 2026-08-05 的游戏内实测（findings-v0.3-v0.5 / v0.4）：
 *   Magus                  prepared  8 个法术
 *   Arcane Focus Tradition focus     1 个   isFocusPool
 *   Rituals                ritual    0 个   ← 空，必须过滤
 *   focus 池 { value: 1, max: 1, cap: 3 }
 *   slots.slot1 = { max: 2, value: 2 }
 */
const entry = (over: Partial<EntryLike> = {}): EntryLike => ({
    id: "e1", name: "Magus", category: "prepared", isFocusPool: false, spellCount: 8, ...over,
});

describe("usableEntries", () => {
    it("★ 空条目要过滤掉（实测 Rituals 的 spellCount 是 0）", () => {
        const out = usableEntries([entry(), entry({ id: "e2", name: "Rituals", category: "ritual", spellCount: 0 })]);
        expect(out.map(e => e.name)).toEqual(["Magus"]);
    });

    it("专注条目要保留", () => {
        const out = usableEntries([entry({ id: "e3", name: "Arcane Focus Tradition", category: "focus", isFocusPool: true, spellCount: 1 })]);
        expect(out.map(e => e.name)).toEqual(["Arcane Focus Tradition"]);
    });

    it("一个角色可以有多个施法条目，都要收", () => {
        expect(usableEntries([entry(), entry({ id: "e3", isFocusPool: true, spellCount: 1 })])).toHaveLength(2);
    });

    /*
     * ★★ 防回归：executor 的 findStrike 当年就是"先 filter 再按下标回查原数组"错的。
     *   这里钉死 id 必须跟着条目走。
     */
    it("★ 过滤之后 id 仍与条目对应（不许按下标回查原数组）", () => {
        const out = usableEntries([
            entry({ id: "e1", name: "Rituals", spellCount: 0 }),   // 被滤掉
            entry({ id: "e2", name: "Magus", spellCount: 8 }),
        ]);
        expect(out.map(e => e.id)).toEqual(["e2"]);
    });

    it("空列表不抛错", () => {
        expect(usableEntries([])).toEqual([]);
    });
});

describe("focusBadge", () => {
    it("按余量画徽章", () => {
        expect(focusBadge({ value: 1, max: 1 })).toBe("✦ 1/1");
        expect(focusBadge({ value: 0, max: 3 })).toBe("✦ 0/3");
    });

    it("没有专注池就不画", () => {
        expect(focusBadge(null)).toBe(undefined);
        expect(focusBadge({ value: 0, max: 0 })).toBe(undefined);
    });
});

describe("slotBadge 法术位余量", () => {
    it("按该环位的剩余画", () => {
        expect(slotBadge({ max: 2, value: 2 })).toBe("◈ 2/2");
        expect(slotBadge({ max: 2, value: 0 })).toBe("◈ 0/2");
    });

    it("没有该环位的位（如戏法/专注法术）就不画", () => {
        expect(slotBadge(null)).toBe(undefined);
        expect(slotBadge({ max: 0, value: 0 })).toBe(undefined);
    });
});

describe("spellCost", () => {
    it("★ 用 actionGlyph（实测它直接就是 '1' / '2'）", () => {
        expect(spellCost({ actionGlyph: "1" })).toBe("1");
        expect(spellCost({ actionGlyph: "2" })).toBe("2");
        expect(spellCost({ actionGlyph: "3" })).toBe("3");
    });

    it("反应与自由动作照常识别", () => {
        expect(spellCost({ actionGlyph: "R" })).toBe("reaction");
        expect(spellCost({ actionGlyph: "F" })).toBe("free");
    });

    it("认不出来就不画记号（施法时间是分钟/小时的仪式类）", () => {
        expect(spellCost({ actionGlyph: undefined })).toBe(null);
        expect(spellCost({ actionGlyph: "" })).toBe(null);
        expect(spellCost({ actionGlyph: "10 minutes" })).toBe(null);
    });
});
