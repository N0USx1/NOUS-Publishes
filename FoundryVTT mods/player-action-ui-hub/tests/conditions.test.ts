import { describe, it, expect } from "vitest";
import { pickConditions, TURN_HINTS, baseName, type ConditionLike } from "../src/conditions";

const c = (over: Partial<ConditionLike>): ConditionLike =>
    ({ slug: "x", name: "X", value: 1, ...over });

describe("pickConditions：只列减得动的", () => {
    it("★ 没有层数的不列 —— 点一下什么也不发生比不列更糟", () => {
        expect(pickConditions([c({ slug: "off-guard", name: "Off-Guard", value: null })])).toEqual([]);
    });

    it("层数为 0 的不列", () => {
        expect(pickConditions([c({ value: 0 })])).toEqual([]);
    });

    it("有层数的列出来", () => {
        expect(pickConditions([c({ slug: "frightened", name: "Frightened", value: 2 })]).map(x => x.slug))
            .toEqual(["frightened"]);
    });
});

describe("pickConditions：排序", () => {
    it("★ 有回合提示的排前面 —— 那是玩家真的会忘记减的几条", () => {
        const 出 = pickConditions([
            c({ slug: "clumsy", name: "Clumsy", value: 1 }),
            c({ slug: "frightened", name: "Frightened", value: 2 }),
            c({ slug: "drained", name: "Drained", value: 1 }),
            c({ slug: "stunned", name: "Stunned", value: 3 }),
        ]).map(x => x.slug);
        expect(出.slice(0, 2).sort()).toEqual(["frightened", "stunned"]);
        expect(出.slice(2)).toEqual(["Clumsy", "Drained"].map(n => n.toLowerCase()));
    });

    it("其余按名字，顺序稳定", () => {
        const 单 = [c({ slug: "b", name: "Bbb", value: 1 }), c({ slug: "a", name: "Aaa", value: 1 })];
        expect(pickConditions(单).map(x => x.slug)).toEqual(["a", "b"]);
        expect(pickConditions([...单].reverse()).map(x => x.slug)).toEqual(["a", "b"]);
    });
});

describe("TURN_HINTS 是提示不是过滤器", () => {
    it("★ 表里没有的条件照样列得出来 —— 让它决定能不能点就变成规则书副本了", () => {
        expect(TURN_HINTS["drained"]).toBeUndefined();
        expect(pickConditions([c({ slug: "drained", name: "Drained", value: 2 })]).map(x => x.slug))
            .toEqual(["drained"]);
    });

    it("实测缺口点名的那两条都在表里", () => {
        // frightened 2 跨完整一轮仍是 2；stunned 3 纹丝不动（2026-08-07 实测）
        expect(TURN_HINTS["frightened"]).toBeTruthy();
        expect(TURN_HINTS["stunned"]).toBeTruthy();
    });
});

describe("baseName：名字里的层数要去掉", () => {
    it("★ pf2e 的条件名自带层数，不去掉就同一个数出现两次", () => {
        expect(baseName("Frightened 2")).toBe("Frightened");
        expect(baseName("Stunned 3")).toBe("Stunned");
    });

    it("没有层数的原样", () => {
        expect(baseName("Off-Guard")).toBe("Off-Guard");
        expect(baseName("Prone")).toBe("Prone");
    });

    it("名字里本来就有数字的不误伤", () => {
        // 只削**末尾**那一段，中间的数字留着
        expect(baseName("Curse of Recoil 2 Stage")).toBe("Curse of Recoil 2 Stage");
    });
});
