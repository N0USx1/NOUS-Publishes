import { describe, it, expect } from "vitest";
import { costToSectorCost, statisticList, BASIC_ACTIONS, SHEET_HINT_ID } from "../../src/collectors/actions";

/*
 * ★ 这里的每一条断言都对着 2026-08-05 的游戏内实测
 * （docs/findings-v0.3-v0.5-data-shapes.md），不是照抄设计假设。
 */
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

describe("★ Actions 大类的取舍（Nous 2026-08-07 拍板）", () => {
    /*
     * ⛔ 这一组接替的是原来那三组 `rankActions` 排序测试。
     *   那套机器与它的测试一起删了 —— 测试全绿并不能说明它该存在：
     *   它排得完全正确，而正确地排列一堆没人点的东西仍然是没人点。
     */
    it("常驻的只有三条，且是 Nous 点名的那三条", () => {
        expect([...BASIC_ACTIONS]).toEqual(["aid", "take-cover", "tumble-through"]);
    });

    it("★ 没有一条来自我们自拟的「常用清单」—— 那份数据已经不存在了", () => {
        // 这条断言守的是"以后别人别再加一份自拟排序回来"。
        // 判据：常驻清单短到可以逐条对着 Nous 的原话念，长了就是又开始自己编了。
        expect(BASIC_ACTIONS.length).toBeLessThanOrEqual(4);
    });

    it("末位那一格有稳定 id —— main.ts 靠它认出「去开角色卡」", () => {
        expect(SHEET_HINT_ID).toBe("sheet:actions");
        // ⚠ 它不能长得像一条动作：`action:` 前缀会被动作执行分支接走，
        //   然后 useAction 拿 "sheet:actions" 当 slug 去查注册表 —— 查不到，静默什么也不发生。
        expect(SHEET_HINT_ID.startsWith("action:")).toBe(false);
    });
});
