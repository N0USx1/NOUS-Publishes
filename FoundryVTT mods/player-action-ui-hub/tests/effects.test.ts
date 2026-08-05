import { describe, it, expect } from "vitest";
import { selfEffectUuid, isSelfTargeted, type SpellShape } from "../src/effects";

/*
 * 断言全部对着 2026-08-05 的 compendium 实读：
 *   spell-effects 包 523 条 —— `Spell Effect:` 512、`Effect:` 5、`Aura:` 等 6
 *   Shield 链接 2 个：Spell Effect: Shield（该套）+ Effect: Shield Immunity（冷却，不该套）
 *   Bless / Courageous Anthem / Heroism / Haste / Enlarge 各只链接 1 个 Spell Effect
 */
const link = (uuid: string, label: string) => `@UUID[${uuid}]{${label}}`;
const SE = "Compendium.pf2e.spell-effects.Item.abc123";
const IMM = "Compendium.pf2e.spell-effects.Item.imm999";

describe("selfEffectUuid", () => {
    it("取出 Spell Effect 那一条", () => {
        expect(selfEffectUuid(`blah ${link(SE, "Spell Effect: Shield")} blah`)).toBe(SE);
    });

    /*
     * ★ 这条是本模块存在的理由之一：Shield 链接了两个 effect，
     *   第二个是**冷却标记**（用了 Shield Block 之后 10 分钟不能再施放）。
     *   "取描述里第一个 effect 链接"这种写法在别的法术上碰巧对，在这里就会
     *   把冷却当成增益套上去 —— 玩家会以为自己被禁用了。
     */
    it("★ 只取 Spell Effect 前缀，不碰 Effect:（冷却/免疫标记）", () => {
        const desc = `${link(IMM, "Effect: Shield Immunity")} 与 ${link(SE, "Spell Effect: Shield")}`;
        expect(selfEffectUuid(desc)).toBe(SE);
    });

    it("只有 Effect: 前缀时返回 null，不退而求其次", () => {
        expect(selfEffectUuid(link(IMM, "Effect: Guidance Immunity"))).toBe(null);
    });

    it("Aura: 前缀不算（那是持续光环，不是施放即得的效果）", () => {
        expect(selfEffectUuid(link(SE, "Aura: Protector's Sphere"))).toBe(null);
    });

    it("没有 effect 链接时返回 null（如 Fear，靠 condition 不靠 effect）", () => {
        expect(selfEffectUuid("<p>没有任何链接</p>")).toBe(null);
    });

    it("⚠ 指向别的包的链接不算（只认 spell-effects）", () => {
        const other = "Compendium.pf2e.feats-srd.Item.xyz";
        expect(selfEffectUuid(link(other, "Spell Effect: 假的"))).toBe(null);
    });

    it("有多个 Spell Effect 时取第一个", () => {
        const b = "Compendium.pf2e.spell-effects.Item.second";
        expect(selfEffectUuid(`${link(SE, "Spell Effect: A")} ${link(b, "Spell Effect: B")}`)).toBe(SE);
    });

    it("空串不抛错", () => {
        expect(selfEffectUuid("")).toBe(null);
    });
});

describe("isSelfTargeted", () => {
    const spell = (over: Partial<SpellShape> = {}): SpellShape => ({ target: null, area: null, ...over });

    it("★ 无目标无区域 = 施法者自己（Shield 实测就是这样）", () => {
        expect(isSelfTargeted(spell())).toBe(true);
    });

    it("⚠ 指定目标的不算自身（Heroism/Haste 是 '1 creature'）", () => {
        expect(isSelfTargeted(spell({ target: "1 creature" }))).toBe(false);
        expect(isSelfTargeted(spell({ target: "1 willing creature" }))).toBe(false);
    });

    it("⚠ 有区域的不算自身（Bless 15 尺、Courageous Anthem 60 尺光环）", () => {
        expect(isSelfTargeted(spell({ area: { type: "emanation", value: 15 } }))).toBe(false);
    });

    it("空字符串的 target 当作没有（实测 pf2e 用空串表示无目标）", () => {
        expect(isSelfTargeted(spell({ target: "" }))).toBe(true);
    });
});
