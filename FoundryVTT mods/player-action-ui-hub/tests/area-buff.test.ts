import { describe, it, expect } from "vitest";
import {
    spellEffectUuidOf, areaBuffOf, effectApplyOf, SPELL_EFFECT_APPLY, type SpellDescLike,
} from "../src/area-buff";

/*
 * 范围法术贴效果的判据层。
 *
 * ⚠ 这一组存在的理由，全写在 area-buff.ts 顶部那张表里：
 *   扫完 1993 个法术，**没有任何结构化字段**能判"该贴给友军还是敌军"。
 *   所以这里验的不是"我们判得准不准"，而是
 *   **"不确定的时候有没有老老实实返回 null"** —— 那才是这层的正确行为。
 */

const 法术 = (slug: string, desc: string): SpellDescLike => ({
    system: { slug, description: { value: desc } },
});

/** 实测形状：pf2e 的法术描述里嵌着 @UUID[...] */
const 描述带效果 = (id: string) =>
    `<p>Blessings favor you...</p><p>@UUID[Compendium.pf2e.spell-effects.Item.${id}]{Spell Effect}</p>`;

describe("spellEffectUuidOf：只认 spell-effects 那个包", () => {
    it("★ 取得出唯一的那个效果 UUID", () => {
        expect(spellEffectUuidOf(法术("bless", 描述带效果("Gqy7K6FnbLtwGpud"))))
            .toBe("Compendium.pf2e.spell-effects.Item.Gqy7K6FnbLtwGpud");
    });

    it("★★ 描述里引用别的包（条件/装备/其它法术）一律不算", () => {
        const d = `<p>@UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Frightened}</p>`;
        expect(spellEffectUuidOf(法术("fear", d))).toBeNull();
    });

    it("★★ 同一个 UUID 出现多次算一个（描述里常重复引用）", () => {
        const u = "Gqy7K6FnbLtwGpud";
        const d = 描述带效果(u) + 描述带效果(u);
        expect(spellEffectUuidOf(法术("bless", d)))
            .toBe(`Compendium.pf2e.spell-effects.Item.${u}`);
    });

    it("★★ 出现两个**不同**的效果就返回 null —— 该由人消歧，不许挑一个", () => {
        const d = 描述带效果("AAAAAAAAAAAAAAAA") + 描述带效果("BBBBBBBBBBBBBBBB");
        expect(spellEffectUuidOf(法术("x", d))).toBeNull();
    });

    it("没有描述 / 没有效果就是 null", () => {
        expect(spellEffectUuidOf(法术("x", ""))).toBeNull();
        expect(spellEffectUuidOf(法术("x", "<p>plain text</p>"))).toBeNull();
        expect(spellEffectUuidOf(null)).toBeNull();
        expect(spellEffectUuidOf({})).toBeNull();
    });
});

describe("areaBuffOf：不确定就返回 null，退回手选", () => {
    it("★ 登记过且描述里有唯一效果 → 给出贴附方向", () => {
        expect(areaBuffOf(法术("bless", 描述带效果("Gqy7K6FnbLtwGpud")))).toEqual({
            effectUuid: "Compendium.pf2e.spell-effects.Item.Gqy7K6FnbLtwGpud",
            side: "allies",
        });
        expect(areaBuffOf(法术("bane", 描述带效果("UTLp7omqsiC36bso")))?.side).toBe("enemies");
    });

    it("★★ **没登记的一律不猜** —— 哪怕它有效果 UUID", () => {
        // 这正是那张表存在的意义：扫完 1993 个法术也没有可靠判据，
        // 所以"有 effect"绝不等于"知道该贴给谁"
        expect(areaBuffOf(法术("black-tentacles", 描述带效果("Gqy7K6FnbLtwGpud")))).toBeNull();
    });

    it("★ 登记了但描述里找不到唯一效果 → 也返回 null", () => {
        expect(areaBuffOf(法术("bless", "<p>no uuid here</p>"))).toBeNull();
        const 俩 = 描述带效果("AAAAAAAAAAAAAAAA") + 描述带效果("BBBBBBBBBBBBBBBB");
        expect(areaBuffOf(法术("bless", 俩))).toBeNull();
    });

    it("没有 slug 就不查表（名字跟着语言包变，slug 才是键）", () => {
        expect(areaBuffOf({ system: { description: { value: 描述带效果("Gqy7K6FnbLtwGpud") } } }))
            .toBeNull();
    });

    it("⚠ 表里每一条都必须是 allies / enemies 之一（防手滑写错字符串）", () => {
        for (const [slug, side] of Object.entries(SPELL_EFFECT_APPLY)) {
            expect(slug).toMatch(/^[a-z0-9-]+$/);          // slug 不是名字
            expect(["allies", "enemies", "targets", "self"]).toContain(side);
        }
    });
});

describe("effectApplyOf：范围与单体合一张表", () => {
    const 法术2 = (slug: string, id: string): SpellDescLike => ({
        system: { slug, description: {
            value: `<p>@UUID[Compendium.pf2e.spell-effects.Item.${id}]{Spell Effect}</p>` } },
    });

    it("★ 范围类给出 allies/enemies", () => {
        expect(effectApplyOf(法术2("bless", "AAAAAAAAAAAAAAAA"))?.applyTo).toBe("allies");
        expect(effectApplyOf(法术2("bane", "BBBBBBBBBBBBBBBB"))?.applyTo).toBe("enemies");
    });

    it("★★ 单体类给出 targets —— 这一支原来整条是断的", () => {
        // 选完目标、法术放出去了，effect 却从来没挂上，而且不报错
        expect(effectApplyOf(法术2("haste", "CCCCCCCCCCCCCCCC"))?.applyTo).toBe("targets");
        expect(effectApplyOf(法术2("heroism", "DDDDDDDDDDDDDDDD"))?.applyTo).toBe("targets");
    });

    it("★ areaBuffOf 只收范围那一类，单体的不归它管", () => {
        expect(areaBuffOf(法术2("haste", "CCCCCCCCCCCCCCCC"))).toBeNull();
        expect(areaBuffOf(法术2("bless", "AAAAAAAAAAAAAAAA"))?.side).toBe("allies");
    });

    it("★ 自身法术给出 self —— 它不经过确认层（没有目标可选）", () => {
        expect(effectApplyOf(法术2("sure-strike", "FFFFFFFFFFFFFFFF"))?.applyTo).toBe("self");
        // ⚠ 它也不归 areaBuffOf 管
        expect(areaBuffOf(法术2("sure-strike", "FFFFFFFFFFFFFFFF"))).toBeNull();
    });

    it("没登记的照旧不猜", () => {
        expect(effectApplyOf(法术2("fireball", "EEEEEEEEEEEEEEEE"))).toBeNull();
    });

    it("★★ 考察过但故意没登记的，必须仍然返回 null", () => {
        // 这几条实测**效果数 0**（pf2e 用 condition 不用 effect），
        // 走「选目标 + 确认」就够了 —— 登记了反而会去找一个不存在的 effect
        for (const slug of ["electric-arc", "fear", "slow", "enfeeble", "invisibility"]) {
            expect(SPELL_EFFECT_APPLY[slug]).toBeUndefined();
        }
        // tailwind 有两个 effect（Tailwind / Tailwind (8 hours)）⇒ 该由人选，
        // 靠 spellEffectUuidOf 自动挡住，**不用特判**
        expect(SPELL_EFFECT_APPLY["tailwind"]).toBeUndefined();
    });
});
