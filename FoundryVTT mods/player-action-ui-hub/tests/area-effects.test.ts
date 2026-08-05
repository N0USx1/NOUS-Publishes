import { describe, it, expect } from "vitest";
import { enemiesInRange, summarize, DEGREE_NAMES, DEFAULT_APPLY_ON,
         SAVE_SPECS, saveSpecFor, savePlanFor,
         type SaveOutcome } from "../src/area-effects";
import { auraSpecFor } from "../src/aura-effects";

/*
 * 断言对着 2026-08-05 的实测：
 *   npc.saves.will.roll({dc}) → CheckRoll，degreeOfSuccess 0-3，
 *   聊天卡片 flags.pf2e.context.outcome 与之一致（实测 0 = criticalFailure）
 *   施法 DC 取自 entry.statistic.dc.value（实测 21）
 */
/** 施法者替身：敌我看 `__enemy`，距离看 `__dist`，与真 pf2e 的 API 同名 */
const caster = () => ({
    id: "caster",
    actor: { name: "Caster", isEnemyOf: (a: any) => a.__enemy === true },
    distanceTo: (t: any) => t.__dist,
});

/** 造一个假的 canvas.tokens.placeables */
function withTokens(list: any[], fn: () => void) {
    (globalThis as any).canvas = { tokens: { placeables: list } };
    try { fn(); } finally { delete (globalThis as any).canvas; }
}

describe("DEGREE_NAMES", () => {
    it("★ 下标顺序与 pf2e 的 degreeOfSuccess 对齐（实测 0 = criticalFailure）", () => {
        expect(DEGREE_NAMES[0]).toBe("criticalFailure");
        expect(DEGREE_NAMES[1]).toBe("failure");
        expect(DEGREE_NAMES[2]).toBe("success");
        expect(DEGREE_NAMES[3]).toBe("criticalSuccess");
    });

    it("默认只有失败与大失败算中招 —— 成功就是没事", () => {
        expect(DEFAULT_APPLY_ON).toEqual(["criticalFailure", "failure"]);
        expect(DEFAULT_APPLY_ON).not.toContain("success");
    });
});

describe("enemiesInRange", () => {
    const 造 = (name: string, enemy: boolean, dist: number) =>
        ({ id: name, actor: { name, __enemy: enemy }, __dist: dist });

    it("只收敌人，盟友不收", () => {
        const a = 造("敌A", true, 10), b = 造("友B", false, 10);
        withTokens([a, b], () => {
            const out = enemiesInRange(caster() as any, 30);
            expect(out.map(x => (x.actor as any).name)).toEqual(["敌A"]);
        });
    });

    it("超出半径的不收", () => {
        const 近 = 造("近", true, 10), 远 = 造("远", true, 40);
        withTokens([近, 远], () => {
            expect(enemiesInRange(caster() as any, 30).map(x => (x.actor as any).name)).toEqual(["近"]);
        });
    });

    it("★ 正好等于半径算在内（边界含在范围里）", () => {
        withTokens([造("边界", true, 30)], () => {
            expect(enemiesInRange(caster() as any, 30)).toHaveLength(1);
        });
    });

    it("施法者自己不算目标", () => {
        const self = { id: "caster", actor: { name: "Caster", __enemy: true }, __dist: 0 };
        withTokens([self], () => {
            expect(enemiesInRange(caster() as any, 30)).toEqual([]);
        });
    });

    it("没有 actor 的 token 跳过（灯光/装饰之类）", () => {
        withTokens([{ id: "x", actor: null, __dist: 5 }], () => {
            expect(enemiesInRange(caster() as any, 30)).toEqual([]);
        });
    });

    it("canvas 不存在时返回空数组而不抛错", () => {
        expect(enemiesInRange(caster() as any, 30)).toEqual([]);
    });
});

describe("summarize", () => {
    const r = (name: string, applied: boolean, reason: string | null = null): SaveOutcome =>
        ({ actorName: name, degree: applied ? "failure" : "success", applied, reason });

    it("没有目标时说清楚", () => {
        expect(summarize([])).toBe("No enemies in range.");
    });

    it("列出中招的", () => {
        expect(summarize([r("哥布林", true), r("兽人", true)])).toContain("Affected: 哥布林, 兽人");
    });

    /*
     * ★ 这条是诚实条款：部分失败必须说出来。
     *   只报成功的会让玩家以为全中了 —— 那比不自动化更糟，
     *   因为他不会再去检查。
     */
    it("★ 没中的逐个说明原因，不只报成功的", () => {
        const s = summarize([r("哥布林", true), r("兽人", false, "豁免成功"), r("巨魔", false, "无权限修改该角色")]);
        expect(s).toContain("哥布林");
        expect(s).toContain("兽人: 豁免成功");
        expect(s).toContain("巨魔: 无权限修改该角色");
    });

    it("全部没中时也不谎报", () => {
        const s = summarize([r("兽人", false, "豁免成功")]);
        expect(s).not.toContain("Affected");
        expect(s).toContain("兽人: 豁免成功");
    });
});

/* ────────────────────────────────────────────────────────────
 * 路径 B 的登记表（2026-08-05 接线）
 * ──────────────────────────────────────────────────────────── */

/**
 * ⚠ `...over` 必须在 `system` **之前**展开，否则它会把合并好的 system 整个盖掉，
 *   夹具就只剩下调用方写的那一两个字段 —— 断言看着通过，其实测的是别的东西。
 */
function 减益法术(over: Record<string, any> = {}) {
    return {
        slug: "bane",
        rank: 1,
        ...over,
        system: {
            area: { type: "emanation", value: 10 },
            defense: { save: { basic: false, statistic: "will" } },
            description: {
                value: '@UUID[Compendium.pf2e.spell-effects.Item.UTLp7omqsiC36bso]{Spell Effect: Bane}',
            },
            ...over.system,
        },
    };
}

describe("SAVE_SPECS：只登记推不出来的东西", () => {
    it("不带 save / radius / effectUuid —— 全部从法术读", () => {
        for (const s of SAVE_SPECS) {
            expect(s).not.toHaveProperty("save");
            expect(s).not.toHaveProperty("radius");
            expect(s).not.toHaveProperty("effectUuid");
        }
    });

    it("★ Roar of the Dragon 不在表里", () => {
        // 它的 Spell Effect 里只有 FlatModifier:diplomacy —— 那是**施法者自己**对龙的加值，
        // 套给敌人正好反了。敌人那头是按四档给 frightened（condition 不是 effect），
        // 还带一句"GM 判定谁算与龙有渊源"，目标集合不可推导。
        expect(saveSpecFor("roar-of-the-dragon")).toBeNull();
    });

    it("aura 表里的法术不许同时出现在这里", () => {
        for (const s of SAVE_SPECS) expect(auraSpecFor(s.slug)).toBeNull();
    });
});

describe("savePlanFor", () => {
    it("豁免项来自 system.defense.save.statistic，不是写死的 Will", () => {
        expect(savePlanFor(减益法术())!.save).toBe("will");
        const 改 = 减益法术({ system: { defense: { save: { statistic: "reflex" } } } });
        expect(savePlanFor(改)!.save).toBe("reflex");
    });

    it("默认只有失败与大失败算中招", () => {
        expect(savePlanFor(减益法术())!.applyOn).toEqual(["criticalFailure", "failure"]);
    });

    it("半径与效果 UUID 来自法术", () => {
        const p = savePlanFor(减益法术())!;
        expect(p.radius).toBe(10);
        expect(p.effectUuid).toContain("spell-effects");
    });

    it("没登记的法术不接管", () => {
        expect(savePlanFor(减益法术({ slug: "fireball" }))).toBeNull();
    });

    it("豁免项读不出来 → null，不猜一个 Will", () => {
        expect(savePlanFor(减益法术({ system: { defense: null } }))).toBeNull();
    });

    it("没有自带效果 → null", () => {
        expect(savePlanFor(减益法术({ system: { description: { value: "" } } }))).toBeNull();
    });
});

describe("summarize：部分失败要逐个说清楚", () => {
    it("套上的和没套上的都报", () => {
        const 话 = summarize([
            { actorName: "Goblin", degree: "failure", applied: true, reason: null },
            { actorName: "Orc", degree: "success", applied: false, reason: "豁免成功" },
            { actorName: "Ogre", degree: "failure", applied: false, reason: "无权限修改该角色" },
        ]);
        expect(话).toContain("Goblin");
        expect(话).toContain("Orc: 豁免成功");
        // ★ 没权限这条必须出现 —— 玩家改不动敌人时，GM 要看得见并接手
        expect(话).toContain("Ogre: 无权限修改该角色");
    });
});
