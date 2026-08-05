import { describe, it, expect } from "vitest";
import { rankActions, costToSectorCost, statisticList, type RawAction } from "../../src/collectors/actions";

/*
 * ★ 这里的每一条断言都对着 2026-08-05 的游戏内实测
 * （docs/findings-v0.3-v0.5-data-shapes.md），不是照抄设计假设。
 */
function raw(over: Partial<RawAction> = {}): RawAction {
    return {
        slug: "tumble-through",
        name: "PF2E.Actions.TumbleThrough.Title",
        cost: 1,
        traits: ["move"],
        img: "icons/skills/movement/figure-running-gray.webp",
        statistic: "acrobatics",
        section: "skill",
        ...over,
    };
}

describe("costToSectorCost", () => {
    it("数字消耗转成字符串（实测 cost 是 number，SectorData 要 string）", () => {
        expect(costToSectorCost(1)).toBe("1");
        expect(costToSectorCost(2)).toBe("2");
        expect(costToSectorCost(3)).toBe("3");
    });

    it("反应与自由动作原样保留", () => {
        expect(costToSectorCost("reaction")).toBe("reaction");
        expect(costToSectorCost("free")).toBe("free");
    });

    it("null 就是不显示消耗记号", () => {
        expect(costToSectorCost(null)).toBe(null);
    });

    it("认不出来的值当作不显示，而不是硬塞进去", () => {
        expect(costToSectorCost(9)).toBe(null);
        expect(costToSectorCost("whatever")).toBe(null);
    });
});

describe("statisticList", () => {
    it("单个 slug 包成数组", () => {
        expect(statisticList("athletics")).toEqual(["athletics"]);
    });

    it("★ 数组原样返回（identify-magic 实测就是数组）", () => {
        expect(statisticList(["arcana", "nature"])).toEqual(["arcana", "nature"]);
    });

    it("没有检定的动作返回空数组", () => {
        expect(statisticList(undefined)).toEqual([]);
        expect(statisticList(null)).toEqual([]);
    });
});

describe("rankActions 排序", () => {
    // 模拟实测角色：运动**未训练**、匿踪与杂技训练过
    const ranks: Record<string, number> = { acrobatics: 2, stealth: 1, athletics: 0 };
    const rankOf = (slug: string) => ranks[slug] ?? 0;
    const slugs = (list: RawAction[], used: Record<string, number> = {}) =>
        rankActions(list, rankOf, (s) => used[s] ?? 0).map(a => a.slug);

    it("downtime 动作直接不收（明确不是遭遇战动作）", () => {
        expect(slugs([
            raw({ slug: "treat-disease", traits: ["downtime", "manipulate"], statistic: "medicine" }),
            raw({ slug: "hide", traits: [], statistic: "stealth" }),
        ])).toEqual(["hide"]);
    });

    it("exploration 动作收但排最后", () => {
        expect(slugs([
            raw({ slug: "avoid-notice", traits: ["exploration"], statistic: "stealth" }),
            raw({ slug: "climb", traits: [], statistic: "athletics" }),
        ])).toEqual(["climb", "avoid-notice"]);
    });

    it("★ 未训练的动作不许被删掉（PF2e 里绊摔未训练也能做）", () => {
        expect(slugs([raw({ slug: "trip", statistic: "athletics" })])).toContain("trip");
    });

    /*
     * ★★ 这一组钉的是 2026-08-05 修掉的判据错误。
     *
     * 原来拿 `attack` 特性当"战斗动作"的判据，但那个特性的真实语义是
     * **"会吃多重攻击减值"**，与"战斗里常不常用"是两回事：
     *   - Force Open（破门，探索向）**带** attack → 被顶到第 1 页
     *   - Take Cover 的 traits 是**空数组** → 用 trait 永远筛不到它
     *   - Demoralize / Seek / Feint 都不带 attack → 全被压到后面
     * 改用 pf2e 自己标的 `section`（basic / specialty-basic / skill）。
     */
    it("★ basic 动作排在技能动作之前（section 才是 pf2e 自己的分类）", () => {
        expect(slugs([
            raw({ slug: "zzz-skill", section: "skill", statistic: "acrobatics" }),
            raw({ slug: "aaa-basic", section: "basic", statistic: undefined }),
        ])).toEqual(["aaa-basic", "zzz-skill"]);
    });

    it("★ attack 特性不再是判据：带 attack 的技能动作不会因此插队到 basic 前面", () => {
        expect(slugs([
            raw({ slug: "force-open", section: "skill", traits: ["attack"], statistic: "athletics" }),
            raw({ slug: "zzz-basic", section: "basic", statistic: undefined }),
        ])).toEqual(["zzz-basic", "force-open"]);
    });

    it("basic 排在 specialty-basic 之前", () => {
        expect(slugs([
            raw({ slug: "zzz-fly", section: "specialty-basic", statistic: undefined }),
            raw({ slug: "aaa-step", section: "basic", statistic: undefined }),
        ])).toEqual(["aaa-step", "zzz-fly"]);
    });

    it("训练过的技能动作排在未训练的之前", () => {
        expect(slugs([
            raw({ slug: "climb", statistic: "athletics" }),   // rank 0
            raw({ slug: "hide", statistic: "stealth" }),      // rank 1
        ])).toEqual(["hide", "climb"]);
    });

    it("多检定动作按其中最高的那个算（任一训练过就算训练过）", () => {
        expect(slugs([
            raw({ slug: "climb", statistic: "athletics" }),                  // 0
            raw({ slug: "escape", statistic: ["athletics", "acrobatics"] }), // 取 2
        ])).toEqual(["escape", "climb"]);
    });

    it("同档内按 slug 稳定排序（避免每次打开顺序都不一样）", () => {
        expect(slugs([
            raw({ slug: "shove", statistic: "athletics" }),
            raw({ slug: "grapple", statistic: "athletics" }),
        ])).toEqual(["grapple", "shove"]);
    });

    it("空列表不抛错", () => {
        expect(slugs([])).toEqual([]);
    });
});

/*
 * ★★ 使用历史（Nous 2026-08-05 拍板："两者合起来"）。
 *
 * "哪个动作更常用"**不在游戏数据里** —— 和"是否必须训练"是同一类问题。
 * 所以：冷启动用一份人为的高频清单，之后由**玩家自己的真实使用记录**逐步接管。
 * 「我用过它」是比「它是 basic 动作」更强的现实信号，因此**用过的跨档优先**。
 */
describe("使用历史优先于一切分档", () => {
    const rankOf = () => 0;
    const slugs = (list: RawAction[], used: Record<string, number> = {}) =>
        rankActions(list, rankOf, (s) => used[s] ?? 0).map(a => a.slug);

    it("★ 用过的排在没用过的前面，哪怕它档位更低", () => {
        // trip 是未训练的技能动作（最低档），却用过 3 次
        expect(slugs(
            [raw({ slug: "aaa-basic", section: "basic" }), raw({ slug: "trip", section: "skill", statistic: "athletics" })],
            { trip: 3 },
        )).toEqual(["trip", "aaa-basic"]);
    });

    it("用得多的排在用得少的前面", () => {
        expect(slugs(
            [raw({ slug: "aaa", section: "skill" }), raw({ slug: "zzz", section: "skill" })],
            { aaa: 1, zzz: 5 },
        )).toEqual(["zzz", "aaa"]);
    });

    it("★ exploration 用过也能上来 —— 玩家真在用的东西不该被我们的分类压住", () => {
        expect(slugs(
            [raw({ slug: "aaa-basic", section: "basic" }),
             raw({ slug: "avoid-notice", traits: ["exploration"], statistic: "stealth" })],
            { "avoid-notice": 2 },
        )).toEqual(["avoid-notice", "aaa-basic"]);
    });

    it("⚠ 但 downtime 用过也不收 —— 它按规则就不是遭遇战动作", () => {
        expect(slugs(
            [raw({ slug: "treat-disease", traits: ["downtime"] }), raw({ slug: "hide", section: "skill" })],
            { "treat-disease": 9 },
        )).toEqual(["hide"]);
    });

    it("都没用过时退回冷启动顺序，不受历史影响", () => {
        expect(slugs([
            raw({ slug: "zzz-skill", section: "skill", statistic: "athletics" }),
            raw({ slug: "aaa-basic", section: "basic" }),
        ])).toEqual(["aaa-basic", "zzz-skill"]);
    });
});

describe("冷启动高频清单", () => {
    const rankOf = () => 0;
    const slugs = (list: RawAction[]) => rankActions(list, rankOf, () => 0).map(a => a.slug);

    it("★ 清单里的动作排在所有分档之前（第一次用就好用）", () => {
        // stride 是 basic，trip 是未训练技能 —— 但两个都在清单里，且 stride 更靠前
        expect(slugs([
            raw({ slug: "aaa-basic", section: "basic" }),
            raw({ slug: "trip", section: "skill", statistic: "athletics" }),
            raw({ slug: "stride", section: "basic" }),
        ])).toEqual(["stride", "trip", "aaa-basic"]);
    });

    it("★ Take Cover 必须能被排上来 —— 它的 traits 是空数组，靠特性永远筛不到", () => {
        expect(slugs([
            raw({ slug: "aaa-basic", section: "basic" }),
            raw({ slug: "take-cover", section: "basic", traits: [] }),
        ])).toEqual(["take-cover", "aaa-basic"]);
    });

    it("清单顺序本身被遵守（stride 先于 demoralize）", () => {
        expect(slugs([
            raw({ slug: "demoralize", section: "skill", statistic: "intimidation" }),
            raw({ slug: "stride", section: "basic" }),
        ])).toEqual(["stride", "demoralize"]);
    });

    it("⚠ 清单只是冷启动：用过的仍然压过它", () => {
        const out = rankActions(
            [raw({ slug: "stride", section: "basic" }), raw({ slug: "climb", section: "skill", statistic: "athletics" })],
            rankOf,
            (s) => (s === "climb" ? 4 : 0),
        ).map(a => a.slug);
        expect(out).toEqual(["climb", "stride"]);
    });
});
