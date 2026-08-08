import { describe, it, expect } from "vitest";
import { readAttack, nextMapIndex, mapNote, MAP_TIERS } from "../src/attacks";

/** 实测形状：pf2e 攻击掷骰消息的 flags。 */
const 攻击消息 = (over: Record<string, unknown> = {}) => ({
    speaker: { actor: "spk" },
    flags: { pf2e: { context: { type: "attack-roll", actor: "a1", mapIncreases: 0, ...over } } },
});

describe("readAttack：判据是 context.type", () => {
    it("读得出 actor 与档位", () => {
        expect(readAttack(攻击消息({ mapIncreases: 1 }))).toEqual({ actorId: "a1", mapIncreases: 1 });
    });

    it("★ 只认 attack-roll —— 伤害/技能/豁免都带骰子，数进去 MAP 会乱跳", () => {
        expect(readAttack(攻击消息({ type: "damage-roll" }))).toBeNull();
        expect(readAttack(攻击消息({ type: "skill-check" }))).toBeNull();
        expect(readAttack(攻击消息({ type: "saving-throw" }))).toBeNull();
    });

    it("★ 重掷不算新的一击 —— 同一击再发一条消息，数进去等于凭空多一档", () => {
        expect(readAttack(攻击消息({ isReroll: true }))).toBeNull();
    });

    it("context 里没有 actor 时退回 speaker", () => {
        expect(readAttack(攻击消息({ actor: undefined }))?.actorId).toBe("spk");
    });

    it("mapIncreases 缺失或不是数字时按 0，不炸", () => {
        expect(readAttack(攻击消息({ mapIncreases: undefined }))?.mapIncreases).toBe(0);
        expect(readAttack(攻击消息({ mapIncreases: "x" }))?.mapIncreases).toBe(0);
    });

    it("不是聊天消息形状时返回 null", () => {
        expect(readAttack(null)).toBeNull();
        expect(readAttack({})).toBeNull();
        expect(readAttack({ flags: {} })).toBeNull();
    });
});

describe("nextMapIndex：三档封顶", () => {
    it("打了 0/1/2 次分别对应第 0/1/2 档", () => {
        expect(nextMapIndex(0)).toBe(0);
        expect(nextMapIndex(1)).toBe(1);
        expect(nextMapIndex(2)).toBe(2);
    });

    it("★ 第四击起仍按第三档 —— 变体只有三个，越界会让文字空掉且不报错", () => {
        expect(nextMapIndex(3)).toBe(MAP_TIERS - 1);
        expect(nextMapIndex(99)).toBe(MAP_TIERS - 1);
    });

    it("负数与小数不越界", () => {
        expect(nextMapIndex(-5)).toBe(0);
        expect(nextMapIndex(1.9)).toBe(1);
    });
});

describe("mapNote：档位文字原样取自 pf2e", () => {
    // 实测 label 自带 MAP 文案，敏捷武器是 -4/-8 而不是 -5/-10
    const 普通 = ["+13", "+9 (MAP -4)", "+5 (MAP -8)"];

    it("★ 不自己拼「第 N 击 -5」—— label 本身就带着，拼一遍会显示两次", () => {
        expect(mapNote(普通, 1)).toBe("Attacked 1× ✦ next +9 (MAP -4)");
        expect(mapNote(普通, 2)).toBe("Attacked 2× ✦ next +5 (MAP -8)");
    });

    it("一次都没打时不显示 —— 没信息就别占地方", () => {
        expect(mapNote(普通, 0)).toBeNull();
    });

    it("拿不到档位文字时只报次数，不编一个数字", () => {
        expect(mapNote(undefined, 2)).toBe("Attacked 2×");
        expect(mapNote([], 1)).toBe("Attacked 1×");
    });
});
