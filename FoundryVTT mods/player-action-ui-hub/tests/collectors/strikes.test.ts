import { describe, it, expect } from "vitest";
import type { ActorPF2e } from "foundry-pf2e";
import { collectStrikeAuxiliaries, collectStrikes } from "../../src/collectors/strikes";

/**
 * 造一个测试替身 actor。
 *
 * ★ 这一处强转是**测试替身**，不是给产品代码开的类型豁免（Task 9）：
 *   真的 `ActorPF2e` 有近 200 个成员，为了测 `collectStrikes` 只读的那几个字段
 *   去造一个完整实例既不可能也没意义。整个测试文件只在这一个函数里转一次，
 *   别处一律走它 —— 产品代码那边照旧全程受类型闸管。
 */
function fakeActor(shape: unknown): ActorPF2e {
    return shape as ActorPF2e;
}

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
        const actor = fakeActor({ system: { actions: [fakeStrike()] } });
        const out = collectStrikes(actor);
        expect(out).toHaveLength(1);
        expect(out[0].label).toBe("Longsword");
        expect(out[0].state).toBe("normal");
        expect(out[0].cost).toBe("1");
        expect(out[0].id).toBe("strike:item1");
        expect(out[0].reason).toBeUndefined();
        /*
         * ⛔ **扇区上不再印任何字**（Nous 2026-08-08 第二轮改口，理由是一致性）：
         *
         *   > "这个又是一致性的下盘，icon 下面应该什么都不说，
         *   >  信息都应该在圆盘里面，伤害数值、map（已经有了）、伤害减值等等。"
         *
         *   ★ 这条断言原来钉的是**上一版**的规矩（"关键数字必须印在格子上"）。
         *     那一版为了 12.6 的一致性选了"每格都给"，结果扇区上出现了三种长度
         *     （`+13` / `+13 ◈1/1` / 空）—— 一格宽 46 单位，**在扇区上追求
         *     "每格都有"必然失败**。正解是走另一头：都不给，毂里给全。
         *   ⚠ 所以这里改的是**期望**，不是把断言删掉：规矩变了，它要跟着钉新的那条。
         */
        expect(out[0].badge).toBeUndefined();
        /*
         * ★ 而加值**一个都没丢** —— 它在毂里的 MAP 那一行（`variantLabels[0]`）。
         *   ⚠ 取 pf2e 给的 label，不自己算：加值由力量/熟练/符文/增益共同决定。
         */
        expect(out[0].variantLabels?.[0]).toContain("+13");
    });

    it("★★ 未拔出的武器**根本不列**（Nous 2026-08-07）", () => {
        // 原来是"灰显但仍可点"。那是三态守则的用法，但用错了地方：
        // 守则挡的是**我们算不准的规则判断**；而"武器在不在手上"是 pf2e 给的**事实**。
        // 拿事实去做"提示不是锁"，结果就是让玩家掷出一次收在鞘里的攻击。
        const actor = fakeActor({ system: { actions: [fakeStrike({
            ready: false, auxiliaryActions: [{ label: "Draw (1H)", actions: 1 }],
        })] } });
        expect(collectStrikes(actor)).toEqual([]);
    });

    it("★ 但拔刀的入口没消失 —— 它在辅助动作那一批里", () => {
        const actor = fakeActor({ system: { actions: [fakeStrike({
            ready: false, auxiliaryActions: [{ label: "Draw (1H)", actions: 1 }],
        })] } });
        expect(collectStrikeAuxiliaries(actor).map(x => x.label)).toContain("Longsword · Draw (1H)");
    });

    
    
    it("MAP 三段照抄 pf2e 的 label，不自己拼「第 N 击」", () => {
        const actor = fakeActor({ system: { actions: [fakeStrike()] } });
        const out = collectStrikes(actor);
        // findings-v0.1 §2：label 本身已带 MAP 文案，我们只在前面补动作消耗记号。
        // 若这里出现第二个 "MAP"，说明又拼了一遍（计划 Task 7 Step 3 的老错）。
        expect(out[0].variantLabels).toEqual(["◆ +13", "◆ +9 (MAP -4)", "◆ +5 (MAP -8)"]);
        for (const l of out[0].variantLabels!) {
            expect(l.match(/MAP/g)?.length ?? 0).toBeLessThan(2);
        }
    });

    it("不同武器各带各的变体文字（共用一份会显示假加值）", () => {
        const actor = fakeActor({
            system: {
                actions: [
                    fakeStrike(),
                    fakeStrike({
                        label: "Dagger", item: { id: "item2" },
                        variants: [{ label: "+11" }, { label: "+7 (MAP -4)" }],
                    }),
                ],
            },
        });
        const out = collectStrikes(actor);
        expect(out[0].variantLabels).toHaveLength(3);
        expect(out[1].variantLabels).toEqual(["◆ +11", "◆ +7 (MAP -4)"]);
    });

    it("没有 variants 时给空数组而不是抛错（毂底就不画翻选条）", () => {
        const actor = fakeActor({ system: { actions: [fakeStrike({ variants: undefined })] } });
        expect(collectStrikes(actor)[0].variantLabels).toEqual([]);
    });

    it("忽略非 strike 条目", () => {
        const actor = fakeActor({ system: { actions: [{ type: "other" }, fakeStrike()] } });
        expect(collectStrikes(actor)).toHaveLength(1);
    });

    it("actor 缺 system.actions 时返回空数组而不抛错", () => {
        expect(collectStrikes(fakeActor({}))).toEqual([]);
        expect(collectStrikes(null)).toEqual([]);
    });
});
