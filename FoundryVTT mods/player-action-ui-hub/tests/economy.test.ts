import { describe, it, expect, beforeEach } from "vitest";
import {
    ACTIONS_PER_TURN, costToPoints, remaining, spend, refund, resetTurn, clearAll, glyphs, undoLast, canUndo,
} from "../src/economy";

const A = "actor-1";

beforeEach(() => clearAll());

describe("costToPoints", () => {
    it("1/2/3 动作按面值算", () => {
        expect(costToPoints("1")).toBe(1);
        expect(costToPoints("2")).toBe(2);
        expect(costToPoints("3")).toBe(3);
    });

    it("反应与自由动作不占常规动作", () => {
        expect(costToPoints("reaction")).toBe(0);
        expect(costToPoints("free")).toBe(0);
        expect(costToPoints(null)).toBe(0);
    });
});

describe("记账", () => {
    it("新回合从满额开始", () => {
        expect(remaining(A, 1)).toBe(ACTIONS_PER_TURN);
    });

    it("花掉会扣，退还会加回", () => {
        spend(A, 1, 2);
        expect(remaining(A, 1)).toBe(1);
        refund(A, 1, 1);
        expect(remaining(A, 1)).toBe(2);
    });

    it("退还不会把花费退成负数", () => {
        spend(A, 1, 1);
        refund(A, 1, 5);
        expect(remaining(A, 1)).toBe(ACTIONS_PER_TURN);
    });

    it("★★ 换一轮**不**自动清零 —— 规则是「你自己的回合开始时」重置", () => {
        // 2026-08-07 实测：round 变的那一刻通常**不是**你的回合。
        // 按 round 清的话，我在自己回合打的那几下会在下一个人行动时被抹掉，
        // MAP 当场偏一档，而且不报错。
        spend("a", 1, 2);
        expect(remaining("a", 2)).toBe(1);
        expect(remaining("a", 2)).toBe(1);   // 读第二轮不该把账清掉
    });

    it("★ 唯一的清零点是 resetTurn（由 pf2e.startTurn 钩子调）", () => {
        spend("b", 1, 2);
        expect(remaining("b", 1)).toBe(1);
        resetTurn("b", 2);
        expect(remaining("b", 2)).toBe(3);
    });

    it("resetTurn 当场清零", () => {
        spend(A, 1, 2);
        resetTurn(A, 1);
        expect(remaining(A, 1)).toBe(ACTIONS_PER_TURN);
    });

    it("★ 允许超支：我们只记不拦，余额可以为负", () => {
        spend(A, 1, 5);
        expect(remaining(A, 1)).toBe(-2);
    });

    it("不同角色各记各的", () => {
        spend(A, 1, 3);
        expect(remaining("actor-2", 1)).toBe(ACTIONS_PER_TURN);
    });
});

describe("glyphs", () => {
    it("按剩余画满/空记号", () => {
        expect(glyphs(3)).toBe("◆◆◆");
        expect(glyphs(2)).toBe("◆◆◇");
        expect(glyphs(0)).toBe("◇◇◇");
    });

    it("超支时补 ✕", () => {
        expect(glyphs(-1)).toBe("◇◇◇✕");
        expect(glyphs(-2)).toBe("◇◇◇✕✕");
    });

    it("剩余多于上限时不会画出超过三个 ◆", () => {
        expect(glyphs(9)).toBe("◆◆◆");
    });
});

describe("撤回上一步", () => {
    it("退回上一笔花费的点数", () => {
        spend(A, 1, 1);
        spend(A, 1, 2);
        expect(remaining(A, 1)).toBe(0);
        expect(undoLast(A, 1)).toBe(2);
        expect(remaining(A, 1)).toBe(2);
    });

    it("连续撤回按后进先出", () => {
        spend(A, 1, 1);
        spend(A, 1, 2);
        undoLast(A, 1);
        expect(undoLast(A, 1)).toBe(1);
        expect(remaining(A, 1)).toBe(ACTIONS_PER_TURN);
    });

    it("没得撤时返回 0 且不改余额", () => {
        expect(undoLast(A, 1)).toBe(0);
        expect(remaining(A, 1)).toBe(ACTIONS_PER_TURN);
    });

    it("canUndo 反映有没有可撤的", () => {
        expect(canUndo(A, 1)).toBe(false);
        spend(A, 1, 1);
        expect(canUndo(A, 1)).toBe(true);
        undoLast(A, 1);
        expect(canUndo(A, 1)).toBe(false);
    });

    it("★ 清零之后不能再撤回清零前的花费", () => {
        spend("u2", 1, 1);
        expect(canUndo("u2", 1)).toBe(true);
        resetTurn("u2", 2);
        expect(canUndo("u2", 2)).toBe(false);
    });
});
