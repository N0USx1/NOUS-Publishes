import { describe, it, expect } from "vitest";
import { kindsForTrigger, classify, matchReactions, TRIGGER_PATTERNS } from "../src/reaction-watch";

/** 实测取自 pf2e 的勇者七条誓约反应。 */
const 勇者 = {
    "Retributive Strike": "An enemy damages your ally, and both are in your champion's aura",
    "Glimpse of Redemption": "An enemy damages your ally, and both are in your champion's aura",
    "Liberating Step": "An enemy damages, grabs, or restrains your ally, and both are in your champion's aura",
    "Flash of Grandeur": "An enemy damages your ally, and both are in your champion's aura",
    "Iron Command": "An enemy in your champion's aura damages you",
    "Selfish Shield": "An enemy in your champion's aura damages you",
    "Destructive Vengeance": "An enemy in your champion's aura damages you",
};

describe("kindsForTrigger：词法匹配，不解析语义", () => {
    it("★ 盟友那四条归 allyDamaged", () => {
        for (const n of ["Retributive Strike", "Glimpse of Redemption", "Liberating Step", "Flash of Grandeur"]) {
            expect(kindsForTrigger(勇者[n as keyof typeof 勇者])).toContain("allyDamaged");
        }
    });

    it("★★ 而且**不**同时归成「我受伤」—— your ally 里也含 you", () => {
        // 第一版少了 (?!r)，四条盟友反应全被判成 meDamaged，
        // 于是盟友一挨打就弹一堆用不上的东西
        expect(kindsForTrigger(勇者["Retributive Strike"])).not.toContain("meDamaged");
    });

    it("自己挨打那三条归 meDamaged", () => {
        for (const n of ["Iron Command", "Selfish Shield", "Destructive Vengeance"]) {
            expect(kindsForTrigger(勇者[n as keyof typeof 勇者])).toEqual(["meDamaged"]);
        }
    });

    it("被击中 / 施法 / 豁免失败各归各的", () => {
        expect(kindsForTrigger("An opponent hits you with a melee Strike.")).toContain("meHit");
        expect(kindsForTrigger("A creature within 30 feet Casts a Spell")).toContain("spellCast");
        expect(kindsForTrigger("You fail a saving throw against an enchantment effect")).toContain("myCheckFailed");
    });

    it("★ 对不上就是空 —— 对不上的那批由反应分类交回玩家，不在这里硬凑", () => {
        expect(kindsForTrigger("A creature within your reach uses a manipulate action")).toEqual([]);
        expect(kindsForTrigger("Your turn begins")).toEqual([]);
        expect(kindsForTrigger(null)).toEqual([]);
        expect(kindsForTrigger("")).toEqual([]);
    });

    it("七类模式一条不少", () => {
        expect(Object.keys(TRIGGER_PATTERNS)).toHaveLength(7);
    });
});

const ctx = { meId: "me", isAlly: (id: string) => id === "friend" };

describe("classify：自己掷的不该弹自己", () => {
    it("★ 我打出去的攻击不算「我被击中」—— 否则每打一下都弹一次窗", () => {
        expect(classify({ type: "attack-roll", rollerId: "me", targetId: "foe", outcome: "success" }, ctx))
            .toEqual([]);
    });

    it("敌人打中我 → meHit", () => {
        expect(classify({ type: "attack-roll", rollerId: "foe", targetId: "me", outcome: "success" }, ctx))
            .toEqual(["meHit"]);
    });

    it("★ 敌人落空不算打中 —— 那会在他失手时弹出挨打才能用的反应", () => {
        const k = classify({ type: "attack-roll", rollerId: "foe", targetId: "me", outcome: "failure" }, ctx);
        expect(k).not.toContain("meHit");
        expect(k).toContain("foeAttackFailed");
    });

    it("我自己落空 → myAttackMissed", () => {
        expect(classify({ type: "attack-roll", rollerId: "me", targetId: "foe", outcome: "failure" }, ctx))
            .toEqual(["myAttackMissed"]);
    });

    it("伤害落在我身上 → meDamaged", () => {
        expect(classify({ type: "damage-roll", rollerId: "foe", targetId: "me" }, ctx)).toContain("meDamaged");
    });

    it("★ 伤害落在盟友身上 → allyDamaged（敌我由外部注入，本模块不碰 Foundry）", () => {
        expect(classify({ type: "damage-roll", rollerId: "foe", targetId: "friend" }, ctx))
            .toEqual(["allyDamaged"]);
    });

    it("伤害落在别的敌人身上，与我无关", () => {
        expect(classify({ type: "damage-roll", rollerId: "foe", targetId: "otherfoe" }, ctx)).toEqual([]);
    });

    it("别人施法 → spellCast；我自己施法不算", () => {
        expect(classify({ type: "spell-cast", rollerId: "foe" }, ctx)).toEqual(["spellCast"]);
        expect(classify({ type: "spell-cast", rollerId: "me" }, ctx)).toEqual([]);
    });

    it("我的豁免失败 → myCheckFailed", () => {
        expect(classify({ type: "saving-throw", rollerId: "me", outcome: "criticalFailure" }, ctx))
            .toEqual(["myCheckFailed"]);
    });

    it("★ 没有目标的消息不硬猜（实测四成攻击消息没有 target）", () => {
        expect(classify({ type: "attack-roll", rollerId: "foe", outcome: "success" }, ctx)).toEqual([]);
    });

    it("不认识的消息类型给空", () => {
        expect(classify({ type: "damage-taken" }, ctx)).toEqual([]);
        expect(classify({}, ctx)).toEqual([]);
    });
});

describe("matchReactions", () => {
    const 手上的 = [
        { id: "a", label: "Retributive Strike", trigger: 勇者["Retributive Strike"] },
        { id: "b", label: "Selfish Shield", trigger: 勇者["Selfish Shield"] },
        { id: "c", label: "Reactive Strike", trigger: "A creature within your reach uses a manipulate action" },
        { id: "d", label: "无触发的", trigger: null },
    ];

    it("盟友挨打只摆盟友那条", () => {
        expect(matchReactions(手上的, ["allyDamaged"]).map(r => r.id)).toEqual(["a"]);
    });

    it("我挨打只摆我那条", () => {
        expect(matchReactions(手上的, ["meDamaged"]).map(r => r.id)).toEqual(["b"]);
    });

    it("★ 没有触发条件的一律不摆 —— 无从判断它在等什么，摆出来只是噪音", () => {
        expect(matchReactions(手上的, ["allyDamaged", "meDamaged", "meHit"]).map(r => r.id))
            .not.toContain("d");
    });

    it("没有事件时不摆任何东西", () => {
        expect(matchReactions(手上的, [])).toEqual([]);
    });
});
