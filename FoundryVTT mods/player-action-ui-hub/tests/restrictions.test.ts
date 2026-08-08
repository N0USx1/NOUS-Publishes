import { describe, it, expect } from "vitest";
import { restrictionFor, isRaging, restrictionStateOf } from "../src/restrictions";

const 怒 = { raging: true };
const 平 = { raging: false };

describe("restrictionFor：怒中的 concentrate 动作", () => {
    it("★ 灰显而不是拿掉 —— 三态守则：提示不是锁", () => {
        const r = restrictionFor({ slug: "recall-knowledge", traits: ["concentrate", "secret"] }, 怒);
        expect(r?.state).toBe("gated");
        expect(r?.reason).toMatch(/rage trait/);
    });

    it("★ 说明写「为什么」，不写「不许」—— 我们不禁止任何事", () => {
        const r = restrictionFor({ slug: "demoralize", traits: ["concentrate"] }, 怒);
        expect(r?.reason).not.toMatch(/cannot|not allowed|forbidden/i);
    });

    it("不带 concentrate 的照常", () => {
        expect(restrictionFor({ slug: "stride", traits: ["move"] }, 怒)).toBeNull();
        expect(restrictionFor({ slug: "strike", traits: [] }, 怒)).toBeNull();
    });

    it("★ 同时带 rage 特性的放行 —— 实测通用包里 0 条，但招牌动作在职业特性上", () => {
        expect(restrictionFor({ slug: "x", traits: ["concentrate", "rage"] }, 怒)).toBeNull();
    });

    it("★ Seek 是规则明文的例外", () => {
        expect(restrictionFor({ slug: "seek", traits: ["concentrate", "secret"] }, 怒)).toBeNull();
    });

    it("没在怒中时什么都不限制", () => {
        expect(restrictionFor({ slug: "recall-knowledge", traits: ["concentrate"] }, 平)).toBeNull();
        expect(restrictionFor({ slug: "recall-knowledge", traits: ["concentrate"] }, {})).toBeNull();
    });

    it("条目没有特性时不炸", () => {
        expect(restrictionFor({}, 怒)).toBeNull();
    });
});

describe("isRaging：两个判据都认", () => {
    it("挂着 effect-rage 就算", () => {
        expect(isRaging({ itemTypes: { effect: [{ slug: "effect-rage" }] } })).toBe(true);
    });

    it("★ 掷骰选项里有 rage 也算 —— 那是系统自己发的信号", () => {
        expect(isRaging({ getRollOptions: () => ["all", "rage", "self:level:5"] })).toBe(true);
    });

    it("两样都没有就不是", () => {
        expect(isRaging({ itemTypes: { effect: [{ slug: "effect-panache" }] }, getRollOptions: () => [] })).toBe(false);
        expect(isRaging(null)).toBe(false);
        expect(isRaging({})).toBe(false);
    });

    it("getRollOptions 抛错时不炸盘", () => {
        expect(() => isRaging({ getRollOptions: () => { throw new Error("boom"); } })).not.toThrow();
    });

    it("restrictionStateOf 把它包成一份状态", () => {
        expect(restrictionStateOf({ itemTypes: { effect: [{ slug: "effect-rage" }] } })).toEqual({ raging: true });
    });
});
