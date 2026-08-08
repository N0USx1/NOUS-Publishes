import { describe, it, expect } from "vitest";
import { pickBodies, HINT_TRAITS, type BodyLike } from "../src/companions";

const 身 = (over: Partial<BodyLike>): BodyLike => ({
    id: "x", name: "X", type: "npc", ownedByMe: true, hasPlayerOwner: true, ...over,
});

describe("pickBodies：判据是归属，不是标签", () => {
    it("★ 只要显式归属就算 —— 不要求它带 eidolon 之类的特性", () => {
        // 实测：pf2e 没有 eidolon actor 类型，图鉴里也没有现成幻灵卡，
        // 幻灵是玩家自建的 —— 按特性过滤会在他没打标签时静默失效
        const 出 = pickBodies([身({ id: "e", name: "Eidolon", traits: [] })], "me");
        expect(出.map(b => b.id)).toEqual(["e"]);
    });

    it("★ 没有显式归属的不算 —— GM 对全世界都 isOwner，用它会列出整个世界", () => {
        expect(pickBodies([身({ id: "n", ownedByMe: false })], "me")).toEqual([]);
    });

    it("★★ 不归任何玩家账号的不算 —— 光有归属不够，Foundry 会给创建者自动加", () => {
        // GM 导入的整本怪物图鉴每一条都"我显式拥有"，只有这一条能滤掉它们
        expect(pickBodies([身({ id: "mob", ownedByMe: true, hasPlayerOwner: false })], "me")).toEqual([]);
    });

    it("两条都满足才入选", () => {
        expect(pickBodies([身({ id: "pet", ownedByMe: true, hasPlayerOwner: true })], "me").map(b => b.id))
            .toEqual(["pet"]);
    });

    it("★ 当前这具身体自己要排除掉", () => {
        expect(pickBodies([身({ id: "me" }), 身({ id: "other" })], "me").map(b => b.id))
            .toEqual(["other"]);
    });

    it("★ 不能行动的类型剔掉（判据复用 actor-kinds，别另写一份清单）", () => {
        const 出 = pickBodies([
            身({ id: "loot", type: "loot" }),
            身({ id: "party", type: "party" }),
            身({ id: "fam", type: "familiar" }),
        ], "me");
        expect(出.map(b => b.id)).toEqual(["fam"]);
    });
});

describe("pickBodies：排序按推导强度", () => {
    const 清单 = [
        身({ id: "z", name: "Zeta", type: "npc" }),
        身({ id: "t", name: "Thrall", type: "npc", traits: ["minion"] }),
        身({ id: "f", name: "Familiar", type: "familiar", masterId: "me" }),
        身({ id: "a", name: "Alpha", type: "npc" }),
    ];

    it("★ master.id 指着我的排最前 —— 那是唯一一条硬链接", () => {
        expect(pickBodies(清单, "me")[0].id).toBe("f");
    });

    it("带提示特性的排第二档", () => {
        expect(pickBodies(清单, "me")[1].id).toBe("t");
    });

    it("其余按名字，顺序稳定", () => {
        expect(pickBodies(清单, "me").map(b => b.id)).toEqual(["f", "t", "a", "z"]);
        expect(pickBodies([...清单].reverse(), "me").map(b => b.id)).toEqual(["f", "t", "a", "z"]);
    });

    it("★ 别人的魔宠不享受第一档（master 指的不是我）", () => {
        const 别人的 = [身({ id: "f2", name: "Someone else's pet", type: "familiar", masterId: "notme" })];
        // 仍然入选（我拥有它），只是不该被当成"我的"排到最前
        const 出 = pickBodies([...别人的, 身({ id: "mine", name: "A", type: "familiar", masterId: "me" })], "me");
        expect(出[0].id).toBe("mine");
    });

    it("提示特性表里的每一个都真的抬档", () => {
        for (const t of HINT_TRAITS) {
            const 出 = pickBodies([身({ id: "b", name: "Zzz", traits: [t] }), 身({ id: "a", name: "Aaa" })], "me");
            expect(出[0].id).toBe("b");
        }
    });
});
