import { describe, it, expect } from "vitest";
import { collectStrikes } from "../src/collector";

/**
 * 假 strike。字段形状照 findings-v0.1 §2 的实测输出裁剪：
 * label / slug / ready / item.id / variants[].label / auxiliaryActions[]。
 */
function fakeStrike(over: Record<string, unknown> = {}) {
    return {
        type: "strike",
        label: "Longsword",
        slug: "longsword",
        ready: true,
        item: { id: "item1" },
        // 实测 variants 的 label 自带 MAP 文案，这里照抄真实格式
        variants: [{ label: "+13" }, { label: "+9 (MAP -4)" }, { label: "+5 (MAP -8)" }],
        auxiliaryActions: [],
        ...over,
    };
}

describe("collectStrikes", () => {
    it("把 ready 的打击变成正常扇区", () => {
        const actor = { system: { actions: [fakeStrike()] } };
        const out = collectStrikes(actor);
        expect(out).toHaveLength(1);
        expect(out[0].label).toBe("Longsword");
        expect(out[0].state).toBe("normal");
        expect(out[0].cost).toBe("1");
        expect(out[0].id).toBe("strike:item1");
        expect(out[0].reason).toBeUndefined();
        expect(out[0].badge).toBeUndefined();
    });

    it("未拔出的打击是 gated（规则上此刻用不了）并标出拔出角标", () => {
        const actor = {
            system: {
                actions: [fakeStrike({
                    label: "Falaise",
                    ready: false,
                    // 实测 label 是英文 "Draw (1H)"
                    auxiliaryActions: [{ label: "Draw (1H)", action: "interact" }],
                })],
            },
        };
        const out = collectStrikes(actor);
        expect(out[0].state).toBe("gated");
        expect(out[0].reason).toContain("Not drawn");
        expect(out[0].badge).toBe("◆ Draw");
    });

    it("未拔出但没有辅助动作时不给角标（点了也没得拔）", () => {
        const actor = {
            system: { actions: [fakeStrike({ ready: false, auxiliaryActions: [] })] },
        };
        const out = collectStrikes(actor);
        expect(out[0].state).toBe("gated");
        expect(out[0].badge).toBeUndefined();
    });

    it("MAP 三段照抄 pf2e 的 label，不自己拼「第 N 击」", () => {
        const actor = { system: { actions: [fakeStrike()] } };
        const out = collectStrikes(actor);
        // findings-v0.1 §2：label 本身已带 MAP 文案，我们只在前面补动作消耗记号。
        // 若这里出现第二个 "MAP"，说明又拼了一遍（计划 Task 7 Step 3 的老错）。
        expect(out[0].variantLabels).toEqual(["◆ +13", "◆ +9 (MAP -4)", "◆ +5 (MAP -8)"]);
        for (const l of out[0].variantLabels!) {
            expect(l.match(/MAP/g)?.length ?? 0).toBeLessThan(2);
        }
    });

    it("不同武器各带各的变体文字（共用一份会显示假加值）", () => {
        const actor = {
            system: {
                actions: [
                    fakeStrike(),
                    fakeStrike({
                        label: "Dagger", item: { id: "item2" },
                        variants: [{ label: "+11" }, { label: "+7 (MAP -4)" }],
                    }),
                ],
            },
        };
        const out = collectStrikes(actor);
        expect(out[0].variantLabels).toHaveLength(3);
        expect(out[1].variantLabels).toEqual(["◆ +11", "◆ +7 (MAP -4)"]);
    });

    it("没有 variants 时给空数组而不是抛错（毂底就不画翻选条）", () => {
        const actor = { system: { actions: [fakeStrike({ variants: undefined })] } };
        expect(collectStrikes(actor)[0].variantLabels).toEqual([]);
    });

    it("忽略非 strike 条目", () => {
        const actor = { system: { actions: [{ type: "other" }, fakeStrike()] } };
        expect(collectStrikes(actor)).toHaveLength(1);
    });

    it("actor 缺 system.actions 时返回空数组而不抛错", () => {
        expect(collectStrikes({})).toEqual([]);
        expect(collectStrikes(null)).toEqual([]);
    });
});
