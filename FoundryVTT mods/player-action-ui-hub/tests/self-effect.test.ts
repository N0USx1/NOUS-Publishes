import { describe, it, expect } from "vitest";
import { answerChoices, damageTypesOf, selfEffectUuid } from "../src/self-effect";

/**
 * 选项清单照 2026-08-07 实读的 `Stance: Arcane Cascade` 裁剪
 * （`Compendium.pf2e.feat-effects.Item.fsjO5oTKttsbpaKl`）。
 * ⚠ 第一项 `weapon-damage` 是真的存在的一个选项，不是我编来当兜底的 ——
 *   Nous 说的"如果都没有就是武器类型的"正好对上它。
 */
const CASCADE_CHOICES = [
    { label: "PF2E.SpecificRule.Magus.ArcaneCascade.WeaponDamage", value: "weapon-damage" },
    { label: "PF2E.TraitFire", value: "fire" },
    { label: "PF2E.TraitCold", value: "cold" },
    { label: "PF2E.TraitForce", value: "force" },
];

const choiceSet = (over: Record<string, unknown> = {}) => ({
    key: "ChoiceSet", flag: "stanceArcaneCascade", choices: CASCADE_CHOICES, ...over,
});

describe("answerChoices", () => {
    it("★ 最后一个法术是火 → 直接填 fire，玩家不用再点一次弹窗", () => {
        const out = answerChoices([choiceSet()], ["fire", "weapon-damage"]) as any[];
        expect(out[0].selection).toBe("fire");
    });

    it("★ 没施过法术 → 退到候选里的下一个（武器伤害）", () => {
        const out = answerChoices([choiceSet()], ["weapon-damage"]) as any[];
        expect(out[0].selection).toBe("weapon-damage");
    });

    it("⚠ 候选里没有一个是这道题的选项 → 不填，把弹窗留给玩家", () => {
        // 例：上一个法术是 piercing，而这个架势的选项里根本没有 piercing
        const out = answerChoices([choiceSet({ choices: [{ value: "fire" }] })], ["poison"]) as any[];
        expect(out[0].selection).toBeUndefined();
    });

    it("⚠ 源数据自己定死的选择不许覆盖", () => {
        const out = answerChoices([choiceSet({ selection: "cold" })], ["fire"]) as any[];
        expect(out[0].selection).toBe("cold");
    });

    it("⚠ 一个答案只填一道题 —— 拿同一个答案去填第二道多半是错的", () => {
        const out = answerChoices([choiceSet(), choiceSet({ flag: "另一题" })], ["fire"]) as any[];
        expect(out[0].selection).toBe("fire");
        expect(out[1].selection).toBeUndefined();
    });

    it("非 ChoiceSet 的规则原样放过（别把别的规则改坏了）", () => {
        const rules = [{ key: "FlatModifier", selector: "melee-strike-damage", value: 1 }];
        expect(answerChoices(rules, ["fire"])).toEqual(rules);
    });

    it("没有规则时不抛错", () => {
        expect(answerChoices([], ["fire"])).toEqual([]);
        expect(answerChoices(undefined as never, ["fire"])).toEqual([]);
    });
});

describe("damageTypesOf", () => {
    it("★ 类型字段叫 `type` 不是 `damageType`（实测 Ignition → fire）", () => {
        expect(damageTypesOf({ system: { damage: { a: { type: "fire", formula: "2d4" } } } }))
            .toEqual(["fire"]);
    });

    it("旧数据的 `damageType` 也认", () => {
        expect(damageTypesOf({ system: { damage: { a: { damageType: "cold" } } } })).toEqual(["cold"]);
    });

    it("没有伤害的法术给空数组（Shield / Detect Magic 实测就是空的）", () => {
        expect(damageTypesOf({ system: { damage: {} } })).toEqual([]);
        expect(damageTypesOf({ system: {} })).toEqual([]);
        expect(damageTypesOf(null)).toEqual([]);
    });
});

describe("selfEffectUuid", () => {
    it("★ 有自我效果的条目给出 uuid（实测 Arcane Cascade 就有）", () => {
        expect(selfEffectUuid({ system: { selfEffect: { uuid: "Compendium.x.Item.y" } } }))
            .toBe("Compendium.x.Item.y");
    });
    it("没有就是 null —— 调用方据此完全不走这条路", () => {
        expect(selfEffectUuid({ system: {} })).toBeNull();
        expect(selfEffectUuid(null)).toBeNull();
    });
});
