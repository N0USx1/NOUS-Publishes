import { describe, it, expect, beforeEach } from "vitest";
import { noteSpell, spellTypesThisTurn, clearSpells } from "../src/last-spell";

describe("last-spell", () => {
    beforeEach(() => clearSpells());

    it("同一回合内读得回来", () => {
        noteSpell("a1", 3, ["fire"]);
        expect(spellTypesThisTurn("a1", 3)).toEqual(["fire"]);
    });

    it("★★ 换了回合就当没有 —— 规则限定「同一个回合」", () => {
        noteSpell("a1", 3, ["fire"]);
        // 不这样做的话，上一回合的火属性会被填进这一回合的架势里，
        // 而它长得和"填对了"一模一样：玩家不会发现。
        expect(spellTypesThisTurn("a1", 4)).toEqual([]);
    });

    it("⚠ 战斗外（round 为 null）一律没有：没有回合就没有「同一个回合」", () => {
        noteSpell("a1", 3, ["fire"]);
        expect(spellTypesThisTurn("a1", null)).toEqual([]);
    });

    it("各角色各记各的", () => {
        noteSpell("a1", 3, ["fire"]);
        noteSpell("a2", 3, ["cold"]);
        expect(spellTypesThisTurn("a1", 3)).toEqual(["fire"]);
        expect(spellTypesThisTurn("a2", 3)).toEqual(["cold"]);
    });

    it("后一个法术盖掉前一个（要的是「最后一个」）", () => {
        noteSpell("a1", 3, ["fire"]);
        noteSpell("a1", 3, ["cold"]);
        expect(spellTypesThisTurn("a1", 3)).toEqual(["cold"]);
    });

    it("★ 没有伤害的法术也照记 —— 「施了个没伤害的法术」也是事实", () => {
        noteSpell("a1", 3, ["fire"]);
        noteSpell("a1", 3, []);
        // 记成空，于是候选退到武器伤害；而不是把上一条火属性留着
        expect(spellTypesThisTurn("a1", 3)).toEqual([]);
    });

    it("战斗结束清账", () => {
        noteSpell("a1", 3, ["fire"]);
        clearSpells();
        expect(spellTypesThisTurn("a1", 3)).toEqual([]);
    });

    it("返回的是副本，外面改不动内部记录", () => {
        noteSpell("a1", 3, ["fire"]);
        spellTypesThisTurn("a1", 3).push("cold");
        expect(spellTypesThisTurn("a1", 3)).toEqual(["fire"]);
    });
});
