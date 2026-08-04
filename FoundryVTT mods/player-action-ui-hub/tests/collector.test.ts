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

    it("忽略非 strike 条目", () => {
        const actor = { system: { actions: [{ type: "other" }, fakeStrike()] } };
        expect(collectStrikes(actor)).toHaveLength(1);
    });

    it("actor 缺 system.actions 时返回空数组而不抛错", () => {
        expect(collectStrikes({})).toEqual([]);
        expect(collectStrikes(null)).toEqual([]);
    });
});
