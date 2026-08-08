import { describe, it, expect } from "vitest";
import { focusMissing, refocusSector, refocusedValue, REFOCUS_ID } from "../src/refocus";

describe("focusMissing", () => {
    it("满了就是 0", () => {
        expect(focusMissing({ value: 2, max: 2 })).toBe(0);
    });
    it("★ 没有焦点池的角色返回 0 —— 战士不该看到 Refocus", () => {
        expect(focusMissing(null)).toBe(0);
        expect(focusMissing({ max: 0 })).toBe(0);
        expect(focusMissing(undefined)).toBe(0);
    });
    it("缺几点算几点", () => {
        expect(focusMissing({ value: 0, max: 3 })).toBe(3);
        expect(focusMissing({ value: 1, max: 3 })).toBe(2);
    });
    it("⚠ 数据脏（value 超过 max）也不给负数", () => {
        expect(focusMissing({ value: 5, max: 3 })).toBe(0);
    });
});

describe("refocusSector", () => {
    it("★ 满了不摆这一格 —— 点了什么也不会发生的格子会被读成「坏了」", () => {
        expect(refocusSector({ value: 1, max: 1 })).toBeNull();
        expect(refocusSector(null)).toBeNull();
    });

    it("缺点数时给出格子，id 稳定（main.ts 靠它认）", () => {
        const s = refocusSector({ value: 0, max: 1 })!;
        expect(s.id).toBe(REFOCUS_ID);
        expect(s.state).toBe("normal");
    });

    it("★★ 不画动作记号 —— 它是 10 分钟的探索活动，不花遭遇战动作点", () => {
        // 画一个 ◆ 会让玩家以为战斗轮里点一下就好，那是把规则显示错了
        expect(refocusSector({ value: 0, max: 1 })!.cost).toBeNull();
    });

    it("★ 毂里**预告**它会改资源 —— 未经预告地改玩家的点数比不改更糟", () => {
        const s = refocusSector({ value: 0, max: 2 })!;
        expect(s.detail).toContain("Restores 1 Focus Point");
        expect(s.detail).toContain("0/2");
    });

    it("名字与图标照纲要给的用，不写死一个", () => {
        const s = refocusSector({ value: 0, max: 1 }, { name: "重新聚焦", img: "a.webp" })!;
        expect(s.label).toBe("重新聚焦");
        expect(s.img).toBe("a.webp");
    });
});

describe("refocusedValue", () => {
    it("加一点", () => {
        expect(refocusedValue({ value: 0, max: 3 })).toBe(1);
    });
    it("⚠ 不许超过上限", () => {
        expect(refocusedValue({ value: 3, max: 3 })).toBe(3);
        expect(refocusedValue({ value: 9, max: 2 })).toBe(2);
    });
});
