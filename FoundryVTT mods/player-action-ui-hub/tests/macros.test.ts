import { describe, it, expect } from "vitest";
import {
    MACROS, macroFor, FLURRY_OF_BLOWS, unarmedStrikes, variantIndexFor, levelForStep,
} from "../src/macros";

/**
 * 造一个最小 actor。字段名与 pf2e 实测一致：
 * 徒手的判据是 `item.category === "unarmed"`，MAP 档位标签由 pf2e 给
 * （徒手带敏捷是 -4/-8，不是 -5/-10 —— 所以不能自己算）。
 */
function 角色(over: any = {}) {
    // ⚠ `type: "strike"` 不能少 —— collector 的 isStrike 认的就是它。
    //   夹具漏了它会让 strikesOf 返回空，看起来像"筛选逻辑坏了"，其实是尺子没造对。
    const 打击 = (name: string, category: string, labels: string[]) => ({
        type: "strike",
        label: name,
        ready: true,
        item: { id: name.toLowerCase(), name, category, img: `icons/${name}.webp` },
        variants: labels.map(l => ({ label: l })),
    });
    return {
        system: {
            actions: over.actions ?? [
                打击("Falaise", "martial", ["+14", "+9 (MAP -5)", "+4 (MAP -10)"]),
                打击("Fist", "unarmed", ["+13", "+9 (MAP -4)", "+5 (MAP -8)"]),
                打击("Crane Wing", "unarmed", ["+13", "+9 (MAP -4)", "+5 (MAP -8)"]),
            ],
        },
    } as any;
}

describe("unarmedStrikes：判据是 item.category", () => {
    it("只挑徒手，武器不算", () => {
        const 出 = unarmedStrikes(角色());
        expect(出.map(x => x.strike.label)).toEqual(["Fist", "Crane Wing"]);
    });

    it("★ 扇区 id 来自 collector 的同一份编号 —— 两边分叉过一次，不再各算各的", () => {
        const 出 = unarmedStrikes(角色());
        expect(new Set(出.map(x => x.id)).size).toBe(出.length);
    });

    it("没有徒手就是空", () => {
        const 无 = 角色({ actions: [{ type: "strike", label: "Bow", item: { id: "bow", category: "martial" }, variants: [] }] });
        expect(unarmedStrikes(无)).toEqual([]);
    });
});

describe("variantIndexFor：MAP 照常施加", () => {
    it("规则原文说不豁免 MAP —— 第一击起始档，第二击下一档", () => {
        expect(variantIndexFor(0, 0, 3)).toBe(0);
        expect(variantIndexFor(0, 1, 3)).toBe(1);
    });

    it("★ 起始档不是 0：连击前已经打过一次，起始就是第 2 档", () => {
        expect(variantIndexFor(1, 0, 3)).toBe(1);
        expect(variantIndexFor(1, 1, 3)).toBe(2);
    });

    it("★ 上限跟着 pf2e 给的档位数走，不写死 2", () => {
        expect(variantIndexFor(2, 1, 3)).toBe(2);
        expect(variantIndexFor(0, 1, 2)).toBe(1);
        expect(variantIndexFor(5, 1, 3)).toBe(2);
    });

    it("负的起始档当 0", () => expect(variantIndexFor(-1, 0, 3)).toBe(0));
});

describe("连击的步骤", () => {
    it("被登记的是 flurry-of-blows", () => {
        expect(macroFor("flurry-of-blows")).toBe(FLURRY_OF_BLOWS);
        expect(macroFor("power-attack")).toBeNull();
        expect(macroFor(null)).toBeNull();
    });

    it("两步：各选一击", () => expect(FLURRY_OF_BLOWS.steps.length).toBe(2));

    it("★ 翻选条只在第一步 —— 它选的是这次连击的起始 MAP，不是某一击的", () => {
        const a = 角色();
        expect(levelForStep(a, FLURRY_OF_BLOWS, 0, { picks: [], variantIndex: 0 })!.variant).toBeTruthy();
        expect(levelForStep(a, FLURRY_OF_BLOWS, 1, { picks: ["x"], variantIndex: 0 })!.variant).toBeUndefined();
    });

    it("★ 第二步照样列全部徒手 —— 规则没说两击必须不同，同一只拳头打两下合法", () => {
        const 二 = levelForStep(角色(), FLURRY_OF_BLOWS, 1, { picks: ["strike:1"], variantIndex: 0 })!;
        expect(二.sectors.length).toBe(2);
    });

    it("翻选条的当前档位跟着上下文走（退回来时不会跳回 0）", () => {
        const 层 = levelForStep(角色(), FLURRY_OF_BLOWS, 0, { picks: [], variantIndex: 2 })!;
        expect(层.variant!.index).toBe(2);
    });

    it("没有徒手打击 → 这一步走不下去，返回 null 而不是空盘", () => {
        const 无 = 角色({ actions: [{ type: "strike", label: "Bow", item: { id: "bow", category: "martial" }, variants: [] }] });
        expect(levelForStep(无, FLURRY_OF_BLOWS, 0, { picks: [], variantIndex: 0 })).toBeNull();
    });

    it("步骤走完 → null，由调用方转去执行", () => {
        expect(levelForStep(角色(), FLURRY_OF_BLOWS, 2, { picks: ["a", "b"], variantIndex: 0 })).toBeNull();
    });

    it("每层都能返回 —— 编排走到一半必须退得出去", () => {
        for (const i of [0, 1]) {
            expect(levelForStep(角色(), FLURRY_OF_BLOWS, i, { picks: ["a"], variantIndex: 0 })!.canGoBack).toBe(true);
        }
    });
});

describe("登记表", () => {
    it("没有重复 slug", () => {
        expect(new Set(MACROS.map(m => m.slug)).size).toBe(MACROS.length);
    });
});
