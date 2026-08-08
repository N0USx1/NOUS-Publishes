import { describe, it, expect } from "vitest";
import { spellPages } from "../src/spell-slots";

/*
 * 用掉的位**置灰保留**，不再抽走（Nous 2026-08-08）。
 *
 * ⛔ 这一组钉的是一次**方向改变**：原来 `spellPages` 把 `expended` 的位
 *   和用完的整环都 `continue` 掉了，于是轮盘上"用掉的就直接消失"。
 *   而角色卡的做法是**划线保留**（截图里的 Force Barrage / Acid Grip）。
 * ★ 抽走的代价是**格数随用量变化** —— 玩家每施一次法就要重新找位置，
 *   而且"少了一格"和"我记错了"分不出来（playbook 一：格数不变、宽度可变）。
 */
describe("用掉的位：保留 + 标记", () => {
    const 位 = (id: string, expended = false) => ({
        spell: { id, name: id, rank: 1 }, castRank: 1, expended,
    });

    it("★★ 用掉的位照样列出来，只是标 expended", () => {
        const 页 = spellPages([{ id: 1, label: "1st Rank", uses: { value: 2, max: 3 },
            active: [位("a"), 位("b", true), 位("c")] } as never]);
        expect(页).toHaveLength(1);
        expect(页[0].entries.map(e => `${e.spellId}:${e.expended}`))
            .toEqual(["a:false", "b:true", "c:false"]);
    });

    it("★★ 整环用完时那一页**照样出现**，里面的位全算用掉", () => {
        const 页 = spellPages([{ id: 1, label: "1st Rank", uses: { value: 0, max: 3 },
            active: [位("a"), 位("b")] } as never]);
        expect(页).toHaveLength(1);
        expect(页[0].entries.every(e => e.expended)).toBe(true);
    });

    it("★ 戏法没有 uses ⇒ 一律当能用（缺字段不能判成用完）", () => {
        const 页 = spellPages([{ id: "cantrips", label: "Cantrips",
            active: [位("x"), 位("y")] } as never]);
        expect(页[0].entries.every(e => e.expended)).toBe(false);
    });

    it("空位（没有 spell）照旧跳过 —— 那不是'用掉了'，是根本没准备", () => {
        const 页 = spellPages([{ id: 1, label: "1st Rank", uses: { value: 1, max: 2 },
            active: [null, 位("a")] } as never]);
        expect(页[0].entries.map(e => e.spellId)).toEqual(["a"]);
    });
});
