import { describe, it, expect } from "vitest";
import { spellstrikeItemOf, isSpent, spentNote, rechargeSector, RECHARGE_ID, MODULE_ID, SPENT_FLAG }
    from "../src/spellstrike-charge";

/** 造一个带/不带 Spellstrike 的假 actor；`spent` 决定 flag。 */
function fake(有: boolean, spent = false) {
    return {
        items: { contents: 有 ? [{ id: "ss1", type: "action", slug: "spellstrike", uuid: "Actor.a.Item.ss1" }] : [] },
        getFlag: (m: string, k: string) => (m === MODULE_ID && k === SPENT_FLAG ? spent : undefined),
    };
}

describe("★ 只在真有 Spellstrike 的角色身上出现", () => {
    it("判据是**身上有没有这条能力**，不是职业名", () => {
        // ⚠ 按 class.slug === "magus" 写死会漏掉多职业档/专长档拿到它的人，
        //   而且不报错 —— 他们只会觉得"这功能对我没做"。
        expect(spellstrikeItemOf(fake(true))?.id).toBe("ss1");
        expect(spellstrikeItemOf(fake(false))).toBeNull();
    });

    it("没有 Spellstrike 的角色永远不算「用掉了」", () => {
        // 不是"没用过"，是"没有这回事" —— 战士不该看到充能键
        expect(isSpent(fake(false, true))).toBe(false);
        expect(rechargeSector(fake(false, true))).toBeNull();
        expect(spentNote(fake(false, true))).toBeNull();
    });
});

describe("用掉之后", () => {
    it("Spellstrike 那一格灰显，但仍可点（三态守则）", () => {
        const n = spentNote(fake(true, true))!;
        expect(n.state).toBe("gated");
    });

    it("★★ 理由只说事实，**不冒充任何人的断言**", () => {
        /*
         * ⛔ 上一轮的病：给灰显编了一句"卡上说这条现在不可用"，而卡从来没说过，
         *   Nous 照它推理出一个不存在的机制。
         * ★ 但**药不是"报出处"** —— 那半句实现细节 2026-08-07 被 Nous 否掉了。
         *   守住的是这一条：**不许出现一个不成立的出处**。
         */
        const r = spentNote(fake(true, true))!.reason;
        expect(r).toMatch(/recharge/i);
        expect(r).not.toMatch(/sheet|pf2e|module/i);
    });

    it("多出一颗充能键，花一个动作（规则原文：as a single action）", () => {
        const s = rechargeSector(fake(true, true))!;
        expect(s.id).toBe(RECHARGE_ID);
        expect(s.cost).toBe("1");
        expect(s.state).toBe("normal");
    });
});

describe("没用掉的时候", () => {
    it("★ 不摆充能键，也不灰显 —— 点了没反应的格子会被读成「坏了」", () => {
        expect(rechargeSector(fake(true, false))).toBeNull();
        expect(spentNote(fake(true, false))).toBeNull();
    });
});

describe("坏输入", () => {
    it("actor 是 null 也不抛", () => {
        expect(spellstrikeItemOf(null)).toBeNull();
        expect(isSpent(null)).toBe(false);
        expect(rechargeSector(null)).toBeNull();
    });
});
