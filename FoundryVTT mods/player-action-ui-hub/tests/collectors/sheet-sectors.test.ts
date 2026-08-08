import { describe, it, expect } from "vitest";
import { 用完了, frequencyBadge } from "../../src/collectors/sheet-sectors";

/**
 * ⛔⛔ **这一组守的是 2026-08-07 那个被 Nous 抓到的误判**。
 *
 *   我们原来拿卡上的 `usable` 当"这条现在能不能用"，还配了一句
 *   "The sheet lists this as not usable right now." —— 那句话是编的。
 *   读 pf2e 源码才知道它是：
 *     `usable: !!selfEffect || !!frequency || !!crafting`
 *   即"**这一行要不要画 USE 按钮**"，一个纯排版判据。
 *   Spellstrike 两样都没有 ⇒ 永远 false ⇒ 我们永远把它画成灰的，
 *   看着像"用过了所以禁用"，其实开局就是灰的。
 *
 *   ★ 教训：**字段名不是语义**。要拿它当判据，就得去看它是怎么算出来的。
 *   现在真正的判据是 `frequency` —— 系统真的在记的那一个。
 */
describe("次数才是可用性判据", () => {
    it("没有次数限制的条目永远不算用完（绝大多数条目都没有）", () => {
        expect(用完了(null)).toBe(false);
        expect(用完了(undefined as never)).toBe(false);
    });

    it("★ Spellstrike 这类「系统没建模次数」的条目不许被灰掉", () => {
        // 实测：Spellstrike 的 system.frequency === null，
        // 规则里的"until recharged"pf2e 一个字段都没记。
        expect(用完了(null)).toBe(false);
    });

    it("剩余为 0 才灰", () => {
        expect(用完了({ value: 0, max: 1, per: "day" })).toBe(true);
        expect(用完了({ value: 1, max: 1, per: "day" })).toBe(false);
    });

    it("角标印的是「剩余/上限」——次数是不看就会点错的信息", () => {
        expect(frequencyBadge({ value: 2, max: 3, per: "day" })).toBe("2/3");
        expect(frequencyBadge({ value: 0, max: 1, per: "day" })).toBe("0/1");
    });

    it("剩余缺失时按 0 显示，而不是画一个假的满格", () => {
        expect(frequencyBadge({ max: 2, per: "day" })).toBe("0/2");
    });

    it("没有次数限制就不画角标（画个空格子是噪音）", () => {
        expect(frequencyBadge(null)).toBeUndefined();
        expect(frequencyBadge({ per: "day" } as never)).toBeUndefined();
    });
});
