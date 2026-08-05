import { describe, it, expect } from "vitest";
import { isSkillAction, rankSkills, type SkillEntry } from "../../src/collectors/skills";
import type { RawAction } from "../../src/collectors/actions";

/*
 * 分类拆成「动作 / 技能」两格（Nous 2026-08-05 定）。原因是实测 67 条挤成 10 页，
 * 而里面混着两种心智完全不同的东西：
 *   - "我要翻滚穿过"  → 战术动作，玩家直接想要它
 *   - "我要撬锁"      → 其实想的是"掷巧手"，玩家不会去找"撬锁"那一格
 */
const raw = (over: Partial<RawAction> = {}): RawAction => ({
    slug: "x", name: "N", cost: 1, traits: [], statistic: null, section: "basic", ...over,
});

describe("isSkillAction 判据", () => {
    it("section 是 skill 的算技能动作", () => {
        expect(isSkillAction(raw({ slug: "pick-a-lock", section: "skill", statistic: "thievery" }))).toBe(true);
    });

    it("★ basic 动作即使带检定也不算技能动作（玩家在动作里找 Seek/Escape）", () => {
        expect(isSkillAction(raw({ slug: "seek", section: "basic", statistic: "perception" }))).toBe(false);
        expect(isSkillAction(raw({ slug: "escape", section: "basic", statistic: ["unarmed", "acrobatics", "athletics"] }))).toBe(false);
    });

    it("specialty-basic 同理不算", () => {
        expect(isSkillAction(raw({ slug: "grab-an-edge", section: "specialty-basic", statistic: "reflex" }))).toBe(false);
    });

    /*
     * ★ 实测 section 为 undefined 的有 4 条：
     *   avoid-notice(stealth) / sense-direction(survival) / track(survival) / affix-a-talisman(无)
     *   前三条本质是技能应用，只有最后一条真没有检定。
     */
    it("★ 没有 section 但有检定的，算技能动作", () => {
        expect(isSkillAction(raw({ slug: "track", section: undefined, statistic: "survival" }))).toBe(true);
        expect(isSkillAction(raw({ slug: "avoid-notice", section: undefined, statistic: "stealth" }))).toBe(true);
    });

    it("★ 没有 section 也没有检定的，留在动作里", () => {
        expect(isSkillAction(raw({ slug: "affix-a-talisman", section: undefined, statistic: null }))).toBe(false);
    });
});

describe("rankSkills 技能排序", () => {
    const s = (slug: string, rank: number, actionCount = 0): SkillEntry =>
        ({ slug, label: slug, rank, mod: 0, actionCount });

    it("训练过的排在未训练之前", () => {
        expect(rankSkills([s("athletics", 0), s("stealth", 1)]).map(x => x.slug))
            .toEqual(["stealth", "athletics"]);
    });

    it("同为训练过时，熟练度高的在前", () => {
        expect(rankSkills([s("arcana", 1), s("acrobatics", 2)]).map(x => x.slug))
            .toEqual(["acrobatics", "arcana"]);
    });

    it("熟练度相同按名字排，保证顺序稳定", () => {
        expect(rankSkills([s("thievery", 1), s("arcana", 1)]).map(x => x.slug))
            .toEqual(["arcana", "thievery"]);
    });

    it("★ 未训练的技能仍然保留 —— 未训练也能掷，删掉就是替规则做决定", () => {
        expect(rankSkills([s("athletics", 0)]).map(x => x.slug)).toEqual(["athletics"]);
    });

    it("空列表不抛错", () => {
        expect(rankSkills([])).toEqual([]);
    });
});
