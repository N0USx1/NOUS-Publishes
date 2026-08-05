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
    const slugs = (list: RawAction[]) => rankActions(list, rankOf).map(a => a.slug);

    it("attack 特性的排最前（战斗优先）", () => {
        expect(slugs([
            raw({ slug: "balance", traits: [], statistic: "acrobatics" }),
            raw({ slug: "trip", traits: ["attack"], statistic: "athletics" }),
        ])).toEqual(["trip", "balance"]);
    });

    it("★ 未训练的 attack 动作不许被删掉（PF2e 里绊摔未训练也能做）", () => {
        expect(slugs([raw({ slug: "trip", traits: ["attack"], statistic: "athletics" })]))
            .toContain("trip");
    });

    it("无检定的通用动作排在技能动作之前", () => {
        expect(slugs([
            raw({ slug: "balance", traits: [], statistic: "acrobatics" }),
            raw({ slug: "stride", traits: ["move"], statistic: undefined }),
        ])).toEqual(["stride", "balance"]);
    });

    it("训练过的技能动作排在未训练的之前", () => {
        expect(slugs([
            raw({ slug: "climb", traits: [], statistic: "athletics" }),   // rank 0
            raw({ slug: "hide", traits: [], statistic: "stealth" }),      // rank 1
        ])).toEqual(["hide", "climb"]);
    });

    it("多检定动作按其中最高的那个算（任一训练过就算训练过）", () => {
        expect(slugs([
            raw({ slug: "climb", traits: [], statistic: "athletics" }),                  // 0
            raw({ slug: "escape", traits: [], statistic: ["athletics", "acrobatics"] }), // 取 2
        ])).toEqual(["escape", "climb"]);
    });

    it("downtime 动作直接不收（明确不是遭遇战动作）", () => {
        expect(slugs([
            raw({ slug: "treat-disease", traits: ["downtime", "manipulate"], statistic: "medicine" }),
            raw({ slug: "trip", traits: ["attack"], statistic: "athletics" }),
        ])).toEqual(["trip"]);
    });

    it("exploration 动作收但排最后", () => {
        expect(slugs([
            raw({ slug: "avoid-notice", traits: ["exploration"], statistic: "stealth" }),
            raw({ slug: "climb", traits: [], statistic: "athletics" }),
        ])).toEqual(["climb", "avoid-notice"]);
    });

    it("★ attack 压过 exploration：两个特性都有时仍算战斗动作", () => {
        expect(slugs([
            raw({ slug: "zzz-plain", traits: [], statistic: "athletics" }),
            raw({ slug: "aaa-both", traits: ["attack", "exploration"], statistic: "athletics" }),
        ])).toEqual(["aaa-both", "zzz-plain"]);
    });

    it("同档内按 slug 稳定排序（避免每次打开顺序都不一样）", () => {
        expect(slugs([
            raw({ slug: "shove", traits: ["attack"], statistic: "athletics" }),
            raw({ slug: "grapple", traits: ["attack"], statistic: "athletics" }),
        ])).toEqual(["grapple", "shove"]);
    });

    it("空列表不抛错", () => {
        expect(slugs([])).toEqual([]);
    });
});
