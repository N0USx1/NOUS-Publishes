import { describe, it, expect } from "vitest";
import {
    targetingOf, castSectorId, spellSectorIdOf, CAST_PREFIX,
    type SpellLike,
} from "../src/spell-target";

/**
 * 施法前要不要选目标。
 *
 * ⚠ 下面每一条的字段值都是 **2026-08-08 从 `pf2e.spells-srd` 实读的**，不是我编的形状。
 *   判据只看结构化字段，**不解析目标文本** —— 那是给人读的散文
 *   （`"1 or 2 creatures"`、`"1 willing living creature or 1 undead"`），
 *   还会跟着语言包变。
 */
const 法术 = (target: string, area: unknown, range: string): SpellLike => ({
    system: {
        target: { value: target },
        area: area as never,
        range: { value: range },
    },
});

describe("targetingOf：只看引擎字段", () => {
    it("★ 单体法术要选目标（Electric Arc / Haste / Slow / Heal）", () => {
        expect(targetingOf(法术("1 or 2 creatures", null, "30 feet"))).toBe("pick");
        expect(targetingOf(法术("1 creature", null, "30 feet"))).toBe("pick");
        expect(targetingOf(法术("1 willing living creature or 1 undead", null, "varies"))).toBe("pick");
    });

    it("★★ 范围法术不逐个点 —— 目标由模板圈定（Fireball）", () => {
        expect(targetingOf(法术("", { type: "burst", value: 20 }, "500 feet"))).toBe("area");
    });

    it("★★ area 优先于目标文本（Bless 写着 'you and allies' 却是光环）", () => {
        // ⚠ 判据顺序反过来的话，Bless（target 非空、range 空）会掉进 none，模板就不放了
        expect(targetingOf(法术("you and allies in the area", { type: "emanation", value: 15 }, "")))
            .toBe("area");
    });

    it("★ 没有射程 ⇒ 只作用于自己，不用选（Shield）", () => {
        expect(targetingOf(法术("", null, ""))).toBe("none");
        // 有目标描述但没射程 —— 靠 range 判比去目标文本里找 "you" 可靠
        expect(targetingOf(法术("you", null, ""))).toBe("none");
    });

    it("没有目标字段的一律 none，不猜", () => {
        expect(targetingOf(null)).toBe("none");
        expect(targetingOf(undefined)).toBe("none");
        expect(targetingOf({})).toBe("none");
        expect(targetingOf({ system: {} })).toBe("none");
    });

    it("⚠ 空白目标文本不算目标（实测 Fireball/Shield 给的就是空串）", () => {
        expect(targetingOf(法术("   ", null, "30 feet"))).toBe("none");
    });
});

describe("确认格 id ↔ 法术 id 往返", () => {
    const 原 = "spell:EntryId000000001:SpellId000000001:2:0";

    it("★ 只换前缀，后面几段原样保留 —— 施放时按同一套解析", () => {
        const c = castSectorId(原);
        expect(c).toBe(`${CAST_PREFIX}EntryId000000001:SpellId000000001:2:0`);
        expect(spellSectorIdOf(c)).toBe(原);
    });

    it("★ 三段那版（反应层里的法术）照样往返", () => {
        const 三段 = "spell:EntryId000000001:SpellId000000001";
        expect(spellSectorIdOf(castSectorId(三段))).toBe(三段);
    });

    it("不是确认格的一律返回 null，别拿半个 id 往下走", () => {
        expect(spellSectorIdOf("spell:a:b")).toBeNull();
        expect(spellSectorIdOf("tgt:token1")).toBeNull();
        expect(spellSectorIdOf(CAST_PREFIX)).toBeNull();
        expect(spellSectorIdOf("")).toBeNull();
    });

    it("★ 不另存「待施放的法术」状态 —— 一个 id 走完全程", () => {
        // 少一处状态就少一处会和界面不同步的东西
        // （2026-08-08 的装填 bug 正是 id 解析与真实数据对不上）
        for (const id of [
            "spell:E1:S1",
            "spell:E1:S1:1:0",
            "spell:E1:S1:9:3",
        ]) {
            expect(spellSectorIdOf(castSectorId(id))).toBe(id);
        }
    });
});
