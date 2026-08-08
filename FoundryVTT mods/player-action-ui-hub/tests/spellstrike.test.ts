import { describe, it, expect } from "vitest";
import {
    SPELLSTRIKE, macroFor, spellstrikeSpells, meleeStrikes, levelForStep, DEGREE, MACROS,
} from "../src/macros";

/** 造一个带施法条目的角色。字段名对着 2026-08-05 实测。 */
function 角色(over: any = {}) {
    const 法 = (name: string, time: string, opts: any = {}) => ({
        id: name, name, img: `i/${name}.webp`, rank: 3,
        isAttack: opts.isAttack ?? false,
        system: { time: { value: time }, defense: opts.save ? { save: { statistic: opts.save } } : {} },
    });
    const 击 = (name: string, isMelee: boolean) => ({
        type: "strike", label: name, ready: true,
        item: { id: name.toLowerCase(), name, isMelee, img: `w/${name}.webp` },
        variants: [{ label: "+14" }, { label: "+9 (MAP -5)" }, { label: "+4 (MAP -10)" }],
    });
    return {
        spellcasting: { contents: over.entries ?? [{
            id: "e1", statistic: {}, spells: { contents: over.spells ?? [
                法("Phase Bolt", "2", { isAttack: true }),
                法("Glass Shield", "1", { save: "reflex" }),
                法("Shield", "1"),                        // 既不要攻击也不要豁免
                法("Long Ritual", "3", { isAttack: true }), // 3 个动作
            ] } }] },
        system: { actions: over.actions ?? [击("Falaise", true), 击("Longbow", false)] },
    } as any;
}

describe("Spellstrike 的法术筛选（判据逐条出自规则原文）", () => {
    const 名 = (a: any) => spellstrikeSpells(a).map(x => x.spell.name);

    it("★ 收「要攻击骰」的", () => expect(名(角色())).toContain("Phase Bolt"));
    it("★ 也收「要豁免」的 —— 规则是 attack roll **或** saving throw", () =>
        expect(名(角色())).toContain("Glass Shield"));
    it("★ 两者都不要的不收（Shield）", () => expect(名(角色())).not.toContain("Shield"));
    it("★ 3 个动作的不收 —— 规则写明 takes 1 or 2 actions", () =>
        expect(名(角色())).not.toContain("Long Ritual"));
    it("没有施法数值的条目整个跳过（物品那种）", () => {
        const a = 角色({ entries: [{ id: "x", statistic: null, spells: { contents: [] } }] });
        expect(spellstrikeSpells(a)).toEqual([]);
    });
});

describe("Spellstrike 的打击筛选", () => {
    it("★ 只收近战 —— 规则写明 melee Strike", () => {
        expect(meleeStrikes(角色()).map(x => x.strike.label)).toEqual(["Falaise"]);
    });
});

describe("Spellstrike 的步骤", () => {
    it("登记进了宏表", () => {
        expect(macroFor("spellstrike")).toBe(SPELLSTRIKE);
        expect(MACROS).toContain(SPELLSTRIKE);
    });

    it("★ 三步：先问打谁，再选法术，再选打击", () => {
        // Nous 2026-08-05："轮盘 ui 应该会询问玩家要用那个" ——
        // 之前依赖玩家事先手动选目标，那一步在轮盘外面
        const a = 角色();
        expect(SPELLSTRIKE.steps.length).toBe(3);
        expect(SPELLSTRIKE.steps[0].title(a, { picks: [], variantIndex: 0 })).toContain("Target");
        expect(levelForStep(a, SPELLSTRIKE, 1, { picks: ["t"], variantIndex: 0 })!.title).toContain("Spell");
        expect(levelForStep(a, SPELLSTRIKE, 2, { picks: ["t","s"], variantIndex: 0 })!.title).toContain("Strike");
    });

    it("★ 翻选条在**打击**那一步（这里只有一击，档位是给它选的）", () => {
        const a = 角色();
        expect(levelForStep(a, SPELLSTRIKE, 1, { picks: ["t"], variantIndex: 0 })!.variant).toBeUndefined();
        expect(levelForStep(a, SPELLSTRIKE, 2, { picks: ["t","s"], variantIndex: 0 })!.variant).toBeTruthy();
    });

    it("★ 法术那一格标出走哪条分支 —— 两条分支的结算完全不同", () => {
        const 格 = levelForStep(角色(), SPELLSTRIKE, 1, { picks: ["t"], variantIndex: 0 })!.sectors;
        expect(格.find(s => s.label === "Phase Bolt")!.detail).toMatch(/Strike/);
        expect(格.find(s => s.label === "Glass Shield")!.detail).toMatch(/reflex/);
    });

    it("没有可用法术时那一步走不下去（返回 null，不是空盘）", () => {
        const a = 角色({ spells: [] });
        expect(levelForStep(a, SPELLSTRIKE, 1, { picks: ["t"], variantIndex: 0 })).toBeNull();
    });

    it("没有近战武器时打击那一步走不下去", () => {
        const a = 角色({ actions: [{ type: "strike", label: "Bow", item: { id: "b", isMelee: false }, variants: [] }] });
        expect(levelForStep(a, SPELLSTRIKE, 2, { picks: ["t","s"], variantIndex: 0 })).toBeNull();
    });
});

describe("成功度对照表", () => {
    it("0-3 对应四档（pf2e 的 degreeOfSuccess）", () => {
        expect(DEGREE[0]).toBe("criticalFailure");
        expect(DEGREE[3]).toBe("criticalSuccess");
    });
});
