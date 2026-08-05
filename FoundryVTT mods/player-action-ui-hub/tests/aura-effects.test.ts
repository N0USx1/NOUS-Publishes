import { describe, it, expect } from "vitest";
import {
    AURA_SPECS, auraSpecFor, auraEffectUuid, radiusAtRank, auraPlanFor, buildAuraEffect,
} from "../src/aura-effects";

/** 造一个最小法术形状，字段名与 pf2e 实测一致。 */
function 法术(over: Record<string, any> = {}) {
    return {
        slug: "courageous-anthem",
        rank: 1,
        system: {
            area: { type: "emanation", value: 60 },
            traits: { value: ["bard", "cantrip", "composition", "emotion", "mental"] },
            description: {
                value: '<p>…</p>@UUID[Compendium.pf2e.spell-effects.Item.beReeFroAx24hj83]{Spell Effect: Courageous Anthem}',
            },
            ...over.system,
        },
        ...over,
    };
}

describe("登记表只登记推不出来的东西", () => {
    it("不带 radius / traits / effectUuid —— 抄进来的副本会静默腐坏", () => {
        for (const s of AURA_SPECS) {
            expect(s).not.toHaveProperty("radius");
            expect(s).not.toHaveProperty("traits");
            expect(s).not.toHaveProperty("effectUuid");
        }
    });

    it("每条都写了受众依据的规则原文", () => {
        for (const s of AURA_SPECS) expect(s.rule.length).toBeGreaterThan(20);
    });

    it("没有重复 slug", () => {
        expect(new Set(AURA_SPECS.map(s => s.slug)).size).toBe(AURA_SPECS.length);
    });

    it("需要豁免的三条不在表里 —— 直接套等于跳过豁免", () => {
        for (const 禁 of ["bane", "malediction", "roar-of-the-dragon"]) {
            expect(auraSpecFor(禁)).toBeNull();
        }
    });
});

describe("radiusAtRank：升阶半径在覆盖表里，不在基础字段上", () => {
    const 狂欢 = 法术({
        slug: "frenzied-revelry",
        system: {
            area: { type: "emanation", value: 5 },
            heightening: { type: "fixed", levels: { 4: { area: { value: 10 } }, 7: { area: { value: 15 } } } },
        },
    });

    it("基础阶用基础值", () => expect(radiusAtRank(狂欢, 1)).toBe(5));
    it("到点的阶用覆盖值", () => expect(radiusAtRank(狂欢, 4)).toBe(10));
    it("★ 阶数在两档之间，取不超过它的最高一档（覆盖表不是每阶都有）", () => {
        expect(radiusAtRank(狂欢, 6)).toBe(10);
    });
    it("超过最高一档仍取最高", () => expect(radiusAtRank(狂欢, 9)).toBe(15));
    it("没有覆盖表就用基础值", () => expect(radiusAtRank(法术(), 5)).toBe(60));
    it("连 area 都没有 → null（不猜）", () => {
        expect(radiusAtRank({ system: {} }, 3)).toBeNull();
    });
});

describe("auraEffectUuid：判据是 Spell Effect: 前缀", () => {
    it("取得到自带的效果", () => {
        expect(auraEffectUuid(法术())).toBe("Compendium.pf2e.spell-effects.Item.beReeFroAx24hj83");
    });
    it("★ 不把冷却标记当增益（Shield 同时链接了 Effect: Shield Immunity）", () => {
        const s = 法术({ system: { description: { value:
            '@UUID[Compendium.pf2e.spell-effects.Item.XXXX]{Effect: Shield Immunity}' } } });
        expect(auraEffectUuid(s)).toBeNull();
    });
    it("没有链接就是 null", () => {
        expect(auraEffectUuid(法术({ system: { description: { value: "<p>纯文本</p>" } } }))).toBeNull();
    });
});

describe("auraPlanFor：取不齐一律放弃", () => {
    it("齐全时全部来自法术本体", () => {
        const p = auraPlanFor(法术())!;
        expect(p.spec.slug).toBe("courageous-anthem");
        expect(p.radius).toBe(60);
        // ★ 重制版 anthem 没有 auditory —— 抄字段时我给全部 8 条都填了 auditory，错了 7 条
        expect(p.traits).toContain("emotion");
        expect(p.traits).not.toContain("auditory");
    });
    it("没登记的法术不接管", () => {
        expect(auraPlanFor(法术({ slug: "fireball" }))).toBeNull();
    });
    it("登记了但没自带效果 → null，不兜底", () => {
        expect(auraPlanFor(法术({ system: { description: { value: "" } } }))).toBeNull();
    });
    it("登记了但没 area → null", () => {
        expect(auraPlanFor(法术({ system: { area: null } }))).toBeNull();
    });
});

describe("buildAuraEffect", () => {
    const 数据 = buildAuraEffect(auraPlanFor(法术())!, 5) as any;
    const 规则 = 数据.system.rules[0];

    it("规则元素是 Aura，半径与特性来自法术", () => {
        expect(规则.key).toBe("Aura");
        expect(规则.radius).toBe(60);
        expect(规则.traits).toContain("emotion");
    });
    it("★ 不带 predicate —— pf2e 自带 Bless 那条 predicate 实测 7 次都不扩散", () => {
        expect(规则).not.toHaveProperty("predicate");
    });
    it("受众照登记表", () => {
        expect(规则.effects[0].affects).toBe("allies");
    });
    it("打了来源标记，将来能撤销", () => {
        expect(数据.flags["player-action-ui-hub"].autoApplied).toBe(true);
    });
});
