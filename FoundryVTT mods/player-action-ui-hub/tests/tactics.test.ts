import { describe, it, expect } from "vitest";
import { COMMANDER_TACTIC, macroFor, macroForItem, MACROS, FLURRY_OF_BLOWS } from "../src/macros";

describe("按特性认一整类（指挥官战术）", () => {
    it("★ 一条宏覆盖全部战术 —— 它们共享 tactic 特性，逐条登记要写几十条且随版本增加", () => {
        for (const slug of ["strike-hard", "buckle-cut-blitz", "pop-drop-and-lock", "wait-for-it"]) {
            expect(macroForItem({ slug, traits: ["commander", "tactic"] })).toBe(COMMANDER_TACTIC);
        }
    });

    it("不带 tactic 特性的不接管", () => {
        expect(macroForItem({ slug: "rage", traits: ["barbarian"] })).toBeNull();
    });

    it("★ slug 优先于特性 —— 将来某条战术要特调，登记一条 slug 宏就能盖过通用的", () => {
        // flurry-of-blows 同时给它一个 tactic 特性，仍应命中 slug 那条
        expect(macroForItem({ slug: "flurry-of-blows", traits: ["tactic"] })).toBe(FLURRY_OF_BLOWS);
    });

    it("按 slug 查不到通用战术宏（它没有 slug）", () => {
        expect(macroFor("tactic")).toBeNull();
        expect(COMMANDER_TACTIC.slug).toBeUndefined();
    });

    it("item 为空不炸", () => {
        expect(macroForItem(null)).toBeNull();
        expect(macroForItem({})).toBeNull();
    });

    it("登记表里有它", () => expect(MACROS).toContain(COMMANDER_TACTIC));

    it("★ 只有一步：选盟友，且是多选", () => {
        expect(COMMANDER_TACTIC.steps.length).toBe(1);
        expect(COMMANDER_TACTIC.steps[0].multiTarget).toBe(true);
    });
});
