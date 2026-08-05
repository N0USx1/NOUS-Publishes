import { describe, it, expect } from "vitest";
import { classStateLines, MAX_STATE_LINES, type StateInput } from "../src/class-state";

const base = (over: Partial<StateInput> = {}): StateInput => ({
    focus: null, toggles: [], ...over,
});

describe("classStateLines", () => {
    it("有专注池就显示余量", () => {
        expect(classStateLines(base({ focus: { value: 1, max: 2 } }))).toContain("✦ Focus 1/2");
    });

    it("规则开关按开/关显示", () => {
        expect(classStateLines(base({ toggles: [{ label: "Panache", enabled: true }] })))
            .toContain("Panache ✦ on");
        expect(classStateLines(base({ toggles: [{ label: "Panache", enabled: false }] })))
            .toContain("Panache ✦ off");
    });

    /*
     * ★ 没有内容时**整格不出现**（设计定档 §7：只在有内容时出现）。
     *   占一个空位比不显示更糟 —— 玩家会以为是加载失败或自己漏看了什么。
     */
    it("★ 什么状态都没有时返回空数组", () => {
        expect(classStateLines(base())).toEqual([]);
    });

    it("专注池上限为 0 不算有状态（没有专注池的职业）", () => {
        expect(classStateLines(base({ focus: { value: 0, max: 0 } }))).toEqual([]);
    });

    it(`最多 ${MAX_STATE_LINES} 行，超出截断（毂里放不下）`, () => {
        const out = classStateLines(base({
            focus: { value: 1, max: 1 },
            toggles: [{ label: "A", enabled: true }, { label: "B", enabled: false }, { label: "C", enabled: true }],
        }));
        expect(out.length).toBeLessThanOrEqual(MAX_STATE_LINES);
    });

    it("专注池排在开关之前（资源比开关更常看）", () => {
        const out = classStateLines(base({
            focus: { value: 2, max: 3 },
            toggles: [{ label: "Panache", enabled: true }],
        }));
        expect(out[0]).toBe("✦ Focus 2/3");
    });

    it("多个开关按给定顺序保留", () => {
        const out = classStateLines(base({
            toggles: [{ label: "A", enabled: true }, { label: "B", enabled: false }],
        }));
        expect(out).toEqual(["A ✦ on", "B ✦ off"]);
    });
});
