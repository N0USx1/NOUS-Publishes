import { describe, it, expect } from "vitest";
import {
    actionRangeOf, castKindOf, needsWheelFlow,
    maxTargetsOf, planCast, gapBefore, totalDuration, CHAT_GAP_MS,
    type CastStep,
} from "../src/spell-cast";

/*
 * 施法编排框架。
 *
 * ★ 做成框架而不是给 Electric Arc 写特例（Nous 2026-08-08：
 *   "我希望你这个是做成一个 spellcasting 的框架，这样别的法术可以直接套用"）。
 * ⚠ 这一组只验**规划**：真正掷骰/发消息那一半要调 pf2e 的 API，那些必须实测过再写。
 */

describe("maxTargetsOf：只取数字上限，取不到就不限制", () => {
    it("★ 实测过的几种写法都要读得对", () => {
        // 这四条都是 pf2e.spells-srd 里的原文
        expect(maxTargetsOf("1 creature")).toBe(1);
        expect(maxTargetsOf("1 or 2 creatures")).toBe(2);          // ← Electric Arc
        expect(maxTargetsOf("1 to 3 willing creatures")).toBe(3);
        expect(maxTargetsOf("up to 5 willing living creatures")).toBe(5);
    });

    it("★★ 一个数字都没有 ⇒ 不限制（宁可不拦，也不要拦错）", () => {
        expect(maxTargetsOf("you and allies in the area")).toBeNull();
        expect(maxTargetsOf("enemies in the area")).toBeNull();
        expect(maxTargetsOf("")).toBeNull();
        expect(maxTargetsOf(null)).toBeNull();
        expect(maxTargetsOf(undefined)).toBeNull();
    });

    it("★ 取**最大**的那个数 —— 'X or Y' / 'X to Y' 的上限都在后面", () => {
        expect(maxTargetsOf("1 or 2 creatures")).toBe(2);
        expect(maxTargetsOf("2 to 4 creatures")).toBe(4);
    });

    it("⚠ 混进别的数字时宁可放宽，不要收紧", () => {
        // "1 willing living creature or 1 undead" —— 两个 1，上限仍是 1
        expect(maxTargetsOf("1 willing living creature or 1 undead")).toBe(1);
    });
});

describe("planCast：步骤顺序是规则决定的", () => {
    const 步 = (s: CastStep[]) => s.map(x => x.kind);

    it("★ 最简：只放个法术", () => {
        expect(步(planCast({ targetCount: 0, hasSave: false, hasDamage: false, hasEffect: false })))
            .toEqual(["cast"]);
    });

    it("★★ 豁免**每个目标一条** —— 合成一条会丢掉'谁过了谁没过'", () => {
        expect(步(planCast({ targetCount: 2, hasSave: true, hasDamage: true, hasEffect: false })))
            .toEqual(["cast", "save", "save", "damage"]);
    });

    it("★★ 伤害**只掷一次** —— 基础豁免是一份伤害按各人成功度打折", () => {
        const s = planCast({ targetCount: 3, hasSave: true, hasDamage: true, hasEffect: false });
        expect(s.filter(x => x.kind === "damage")).toHaveLength(1);
        expect(s.filter(x => x.kind === "save")).toHaveLength(3);
    });

    it("★★ 没目标就不排 save —— 豁免是目标掷的，没人可掷", () => {
        expect(步(planCast({ targetCount: 0, hasSave: true, hasDamage: true, hasEffect: false })))
            .toEqual(["cast", "damage"]);
    });

    it("★★ effect 排在最后 —— 贴在前的话法术被拦下就成了'没花代价却拿到收益'", () => {
        const s = planCast({ targetCount: 1, hasSave: true, hasDamage: true, hasEffect: true });
        expect(步(s)).toEqual(["cast", "save", "damage", "effect"]);
        expect(s[s.length - 1].kind).toBe("effect");
    });

    it("★ cast 永远第一 —— 后面几步都建立在'它真的放出去了'之上", () => {
        for (const n of [0, 1, 5]) {
            const s = planCast({ targetCount: n, hasSave: true, hasDamage: true, hasEffect: true });
            expect(s[0].kind).toBe("cast");
        }
    });

    it("save 步骤要标出是第几个目标", () => {
        const s = planCast({ targetCount: 3, hasSave: true, hasDamage: false, hasEffect: false });
        expect(s.filter(x => x.kind === "save").map(x => x.targetIndex)).toEqual([0, 1, 2]);
    });
});

describe("节流：两条消息之间隔开", () => {
    it("★ 第一步不等 —— 玩家刚点完，等待感是纯粹的卡顿", () => {
        const s = planCast({ targetCount: 2, hasSave: true, hasDamage: true, hasEffect: false });
        expect(gapBefore(s, 0)).toBe(0);
    });

    it("★★ 发消息的步骤之间才等", () => {
        const s = planCast({ targetCount: 2, hasSave: true, hasDamage: true, hasEffect: false });
        // cast, save, save, damage —— 后三步各等一次
        expect([1, 2, 3].map(i => gapBefore(s, i))).toEqual([CHAT_GAP_MS, CHAT_GAP_MS, CHAT_GAP_MS]);
    });

    it("★★ 不发消息的步骤**不占**间隔 —— 贴 effect 不该白等 2 秒", () => {
        const s = planCast({ targetCount: 1, hasSave: true, hasDamage: true, hasEffect: true });
        const i = s.findIndex(x => x.kind === "effect");
        expect(s[i].emitsMessage).toBe(false);
        expect(gapBefore(s, i)).toBe(0);
    });

    it("★ 总时长算得出来 —— 好告诉玩家别以为卡住了", () => {
        // cast + 2×save + damage = 4 条消息 ⇒ 3 个间隔
        const s = planCast({ targetCount: 2, hasSave: true, hasDamage: true, hasEffect: false });
        expect(totalDuration(s)).toBe(3 * CHAT_GAP_MS);
    });

    it("只有一条消息时完全不等", () => {
        const s = planCast({ targetCount: 0, hasSave: false, hasDamage: false, hasEffect: false });
        expect(totalDuration(s)).toBe(0);
    });

    it("间隔可调（测试里用小值，免得跑得慢）", () => {
        const s = planCast({ targetCount: 1, hasSave: true, hasDamage: false, hasEffect: false });
        expect(totalDuration(s, 10)).toBe(10);
    });

    it("越界的下标不抛错", () => {
        const s = planCast({ targetCount: 0, hasSave: false, hasDamage: false, hasEffect: false });
        expect(gapBefore(s, -1)).toBe(0);
        expect(gapBefore(s, 99)).toBe(0);
    });
});

/*
 * 多动作型（Force Barrage = remaster 之前的 Magic Missile）。
 * ★ 判据是结构化字段 `system.time.value`，实测就是 `"1 to 3"` ——
 *   全库里这种只有 30 条，其余是 "1"/"2"/"3"/"reaction"。
 */
describe("actionRangeOf：可投入几个动作", () => {
    it("★ Force Barrage 实测就是 '1 to 3'", () => {
        expect(actionRangeOf("1 to 3")).toEqual({ min: 1, max: 3 });
    });

    it("★★ 固定动作数的一律不是这一类", () => {
        for (const v of ["1", "2", "3", "reaction", "free"]) {
            expect(actionRangeOf(v)).toBeNull();
        }
    });

    it("★★ 时长类的绝不能误判成动作范围", () => {
        // 全库里这些都真实存在：1 minute / 10 minutes / 1 hour / 8 hours / 1 day
        for (const v of ["1 minute", "10 minutes", "1 hour", "8 hours", "1 day", "4 hours"]) {
            expect(actionRangeOf(v)).toBeNull();
        }
    });

    it("空值不猜", () => {
        expect(actionRangeOf("")).toBeNull();
        expect(actionRangeOf(null)).toBeNull();
        expect(actionRangeOf(undefined)).toBeNull();
    });

    it("⚠ 反着写的范围不收（max < min 是坏数据，不是'倒着来'）", () => {
        expect(actionRangeOf("3 to 1")).toBeNull();
        expect(actionRangeOf("0 to 2")).toBeNull();
    });
});

describe("攻击型 vs 豁免型：二选一", () => {
    const 步 = (s: CastStep[]) => s.map(x => x.kind);

    it("★★ 攻击型排 attack 不排 save（Phase Bolt）", () => {
        expect(步(planCast({ targetCount: 1, hasSave: false, isAttack: true,
                             hasDamage: true, hasEffect: false })))
            .toEqual(["cast", "attack", "damage"]);
    });

    it("★★ 豁免型排 save 不排 attack（Electric Arc）", () => {
        expect(步(planCast({ targetCount: 2, hasSave: true, isAttack: false,
                             hasDamage: true, hasEffect: false })))
            .toEqual(["cast", "save", "save", "damage"]);
    });

    it("★★ 万一两者都为真 ⇒ **攻击优先**，绝不同时排（会多掷一次骰）", () => {
        const s = planCast({ targetCount: 2, hasSave: true, isAttack: true,
                             hasDamage: true, hasEffect: false });
        expect(s.filter(x => x.kind === "attack")).toHaveLength(2);
        expect(s.filter(x => x.kind === "save")).toHaveLength(0);
    });

    it("★ 攻击型也是每个目标一条", () => {
        const s = planCast({ targetCount: 3, hasSave: false, isAttack: true,
                             hasDamage: true, hasEffect: false });
        expect(s.filter(x => x.kind === "attack").map(x => x.targetIndex)).toEqual([0, 1, 2]);
    });

    it("★ 攻击型的伤害仍然只掷一次", () => {
        const s = planCast({ targetCount: 3, hasSave: false, isAttack: true,
                             hasDamage: true, hasEffect: false });
        expect(s.filter(x => x.kind === "damage")).toHaveLength(1);
    });

    it("没目标时攻击型也不排 attack", () => {
        expect(步(planCast({ targetCount: 0, hasSave: false, isAttack: true,
                             hasDamage: true, hasEffect: false })))
            .toEqual(["cast", "damage"]);
    });

    it("★ attack 也发消息 ⇒ 照样占节流间隔", () => {
        const s = planCast({ targetCount: 2, hasSave: false, isAttack: true,
                             hasDamage: true, hasEffect: false });
        expect(s.filter(x => x.kind === "attack").every(x => x.emitsMessage)).toBe(true);
        expect(totalDuration(s, 10)).toBe(3 * 10);   // attack,attack,damage 各等一次
    });
});

describe("castKindOf：默认不管，只有认得出的才接线", () => {
    it("★★ 绝大多数法术是 default —— UI 一概不管", () => {
        // Nous 2026-08-08："基本上所有的 spell，我们不管"
        expect(castKindOf({})).toBe("default");
        expect(castKindOf({ targeting: "pick" })).toBe("default");        // 光有目标不够
        expect(castKindOf({ targeting: "none", timeValue: "2" })).toBe("default");
    });

    it("★ 范围豁免法术（Fireball）归 default —— 目标由模板圈定，不逐个点", () => {
        expect(castKindOf({ saveStatistic: "reflex", targeting: "area" })).toBe("default");
    });

    it("★ 豁免型要**同时**有豁免和可选目标（Electric Arc）", () => {
        expect(castKindOf({ saveStatistic: "reflex", targeting: "pick" })).toBe("save");
        // 有豁免但没目标可选 ⇒ 不插手
        expect(castKindOf({ saveStatistic: "reflex", targeting: "none" })).toBe("default");
    });

    it("★ 攻击型（Phase Bolt）", () => {
        expect(castKindOf({ isAttack: true, targeting: "pick" })).toBe("attack");
    });

    it("★★ 多动作型优先级最高 —— 它改变法术本身的效果", () => {
        expect(castKindOf({ timeValue: "1 to 3", isAttack: true,
                            saveStatistic: "reflex", targeting: "pick" })).toBe("multi-action");
    });

    it("★ 范围贴附 vs 单体贴附", () => {
        expect(castKindOf({ effectApplyTo: "allies", targeting: "area" })).toBe("area-buff");
        expect(castKindOf({ effectApplyTo: "enemies", targeting: "area" })).toBe("area-buff");
        expect(castKindOf({ effectApplyTo: "targets", targeting: "pick" })).toBe("effect");
        expect(castKindOf({ effectApplyTo: "self", targeting: "none" })).toBe("effect");
    });

    it("★ needsWheelFlow：只有 default 不插手", () => {
        expect(needsWheelFlow("default")).toBe(false);
        for (const k of ["attack", "save", "area-buff", "effect", "multi-action"] as const) {
            expect(needsWheelFlow(k)).toBe(true);
        }
    });
});

describe("多发伤害：只在玩家显式选过之后", () => {
    it("★★ 默认只掷一次 —— 绝不从'能投 1-3 个动作'推断该射几发", () => {
        // pf2e 对 Force Barrage 的多发**没有任何自动化**（rules 空、只给一发 1d4+1）
        const s = planCast({ targetCount: 1, hasSave: false, hasDamage: true, hasEffect: false });
        expect(s.filter(x => x.kind === "damage")).toHaveLength(1);
    });

    it("★ 玩家选了 3 个动作 ⇒ 掷 3 次", () => {
        const s = planCast({ targetCount: 1, hasSave: false, hasDamage: true,
                             hasEffect: false, damageCount: 3 });
        expect(s.filter(x => x.kind === "damage")).toHaveLength(3);
    });

    it("⚠ 坏值一律退回 1 发，不抛错也不掷 0 次", () => {
        for (const n of [0, -1, NaN, undefined as never]) {
            const s = planCast({ targetCount: 1, hasSave: false, hasDamage: true,
                                 hasEffect: false, damageCount: n });
            expect(s.filter(x => x.kind === "damage")).toHaveLength(1);
        }
    });

    it("★ 多发之间照样隔开（每发都是一条消息）", () => {
        const s = planCast({ targetCount: 0, hasSave: false, hasDamage: true,
                             hasEffect: false, damageCount: 3 });
        // cast + 3×damage ⇒ 3 个间隔
        expect(totalDuration(s, 10)).toBe(3 * 10);
    });
});
