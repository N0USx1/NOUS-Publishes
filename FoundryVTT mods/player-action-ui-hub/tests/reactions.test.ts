import { describe, it, expect } from "vitest";
import { isReaction, pickReactions, type ReactionItemLike } from "../src/collectors/reactions";

const 条目 = (over: Partial<ReactionItemLike>): ReactionItemLike => {
    const 底 = { id: "x", name: "X", type: "action", traits: [] as string[], description: "" };
    // ⚠ 展开写在后面，但 traits 单独兜底 —— Partial 里没给它时展开不会补上默认值
    return { ...底, ...over, traits: over.traits ?? 底.traits };
};

describe("isReaction：两个字段都要看", () => {
    it("动作/专长走 actionType", () => {
        expect(isReaction(条目({ actionType: "reaction" }))).toBe(true);
        expect(isReaction(条目({ type: "feat", actionType: "reaction" }))).toBe(true);
    });

    it("★ 法术走 time —— 法术根本没有 actionType 字段（实测 undefined）", () => {
        // 只看 actionType 会静默漏掉整类反应法术，而且不报错
        expect(isReaction(条目({ type: "spell", time: "reaction" }))).toBe(true);
        expect(isReaction(条目({ type: "spell", actionType: undefined, time: "reaction" }))).toBe(true);
    });

    it("主动动作与被动都不算", () => {
        expect(isReaction(条目({ actionType: "action" }))).toBe(false);
        expect(isReaction(条目({ actionType: "passive" }))).toBe(false);
        expect(isReaction(条目({ actionType: "free" }))).toBe(false);
        expect(isReaction(条目({ type: "spell", time: "2" }))).toBe(false);
        expect(isReaction(条目({}))).toBe(false);
    });
});

describe("pickReactions", () => {
    const 清单 = [
        条目({ id: "c", name: "Reactive Strike", actionType: "reaction" }),
        条目({ id: "a", name: "Arcane Cascade", actionType: "action" }),
        条目({ id: "b", name: "Aid", actionType: "reaction" }),
        条目({ id: "d", name: "Feather Fall", type: "spell", time: "reaction" }),
        条目({ id: "e", name: "Assurance", type: "feat", actionType: "passive" }),
    ];

    it("只留反应，跨 item type", () => {
        expect(pickReactions(清单).map(i => i.name))
            .toEqual(["Aid", "Feather Fall", "Reactive Strike"]);
    });

    it("★ 按名字排 —— 位置每场战斗都在动的话，肌肉记忆就没了", () => {
        const 乱序 = [...清单].reverse();
        expect(pickReactions(乱序).map(i => i.id)).toEqual(pickReactions(清单).map(i => i.id));
    });

    it("一条反应都没有时给空数组，不炸（实测 5 级 Magus 就是零反应）", () => {
        expect(pickReactions([条目({ actionType: "action" })])).toEqual([]);
        expect(pickReactions([])).toEqual([]);
    });
});
