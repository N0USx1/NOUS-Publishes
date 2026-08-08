import { describe, it, expect, beforeEach, vi } from "vitest";
import { targetOptions, applyTargetPick, TARGET_PREFIX, TARGET_DONE } from "../src/macros";

/**
 * 造一份画布。字段名对着 2026-08-05 实测：
 * token 有 `id` / `name` / `actor` / `document.texture.src` / `distanceTo()`；
 * 敌我走 `actor.isEnemyOf`；目标是 `game.user.targets`（Set）。
 */
function 布景(over: any = {}) {
    const 设为目标 = vi.fn();
    const tok = (id: string, name: string, actorId: string, type = "npc") => ({
        id, name, isVisible: true,
        actor: { id: actorId, type },
        document: { texture: { src: `t/${id}.webp` } },
        distanceTo: () => 10,
        setTarget: 设为目标,
    });
    const 全部 = over.tokens ?? [
        tok("t0", "Me", "me", "character"),
        tok("t1", "Goblin", "gob"),
        tok("t2", "Ally", "ally", "character"),
    ];
    (globalThis as any).canvas = {
        tokens: { placeables: 全部 },
        scene: { grid: { type: over.grid ?? 1 } },
    };
    (globalThis as any).game = { user: { targets: over.targets ?? new Set() } };
    const actor = { id: "me", isEnemyOf: (o: any) => o?.id === "gob" } as any;
    return { actor, 全部, 设为目标 };
}

/*
 * ⛔ 2026-08-08：敌我/距离从 `detail` 挪到了 `hubNotes`。
 *   `detail` 曾经画在毂里，但"说明区"整块拿掉之后它**根本不画** ——
 *   信息还在数据里，屏幕上却没有。
 *   ★ 那是最难发现的一种坏法：写的人以为给了，用的人从没见过。
 *     Nous 实机撞出来的症状是"还可以电疗友军" —— 目标格只有 token 图，
 *     谁是敌谁是友完全看不出来。
 *   ⇒ 这几条断言跟着改**字段**，验的东西没变：敌我一律给、距离只在算得准时给。
 */
describe("选目标：由轮盘问，不再要玩家事先手动选", () => {
    it("列出场上的其它 token", () => {
        const { actor } = 布景();
        expect(targetOptions(actor).map(s => s.label)).toEqual(["Goblin", "Ally"]);
    });

    it("★ 排除自己按 actor 比，不按 token 比（一个角色可能有多个 token）", () => {
        const { actor, 全部 } = 布景();
        // 再放一个属于同一个 actor 的 token
        (globalThis as any).canvas.tokens.placeables = [...全部, { ...全部[0], id: "t9", name: "我的分身" }];
        expect(targetOptions(actor).some(s => s.label === "我的分身")).toBe(false);
    });

    it("敌我用 pf2e 自己的判断，可以只列敌人", () => {
        const { actor } = 布景();
        expect(targetOptions(actor, "enemies").map(s => s.label)).toEqual(["Goblin"]);
        expect(targetOptions(actor, "allies").map(s => s.label)).toEqual(["Ally"]);
    });

    it("★ 有网格才显示距离 —— 无网格下 pf2e 的距离不可信", () => {
        const { actor } = 布景({ grid: 1 });
        expect(targetOptions(actor)[0].hubNotes?.[0]).toContain("ft");
        布景({ grid: 0 });
        expect(targetOptions(actor)[0].hubNotes?.[0]).not.toContain("ft");
    });

    it("敌我标识**无网格也给** —— 那是规则判断，与测距无关", () => {
        布景({ grid: 0 });
        const { actor } = 布景({ grid: 0 });
        expect(targetOptions(actor)[0].hubNotes?.[0]).toContain("Enemy");
    });

    it("★ 已经选中的带 ◎ —— 多数时候玩家早就选好了，一眼确认比重选快", () => {
        const 先造 = 布景();
        const 已选 = new Set([先造.全部[1]]);
        const { actor } = 布景({ tokens: 先造.全部, targets: 已选 });
        const 出 = targetOptions(actor);
        expect(出.find(s => s.label === "Goblin")!.badge).toBe("◎");
        expect(出.find(s => s.label === "Ally")!.badge).toBeUndefined();
    });

    it("看不见的 token 不列", () => {
        const 先 = 布景();
        (先.全部[1] as any).isVisible = false;
        const { actor } = 布景({ tokens: 先.全部 });
        expect(targetOptions(actor).map(s => s.label)).toEqual(["Ally"]);
    });
});

describe("applyTargetPick：认前缀，任何宏都能用", () => {
    beforeEach(() => 布景());

    it("选中就设为目标", () => {
        const { actor, 设为目标 } = 布景();
        const id = targetOptions(actor)[0].id;
        expect(id.startsWith(TARGET_PREFIX)).toBe(true);
        expect(applyTargetPick(id)).toBe(true);
        expect(设为目标).toHaveBeenCalledWith(true, { releaseOthers: true });
    });

    it("★ 不是目标步骤的 id 一概不管（别的步骤照常走）", () => {
        expect(applyTargetPick("strike:0")).toBe(false);
        expect(applyTargetPick("ss:e1:s1")).toBe(false);
    });

    it("token 已经不在场上时不炸", () => {
        expect(applyTargetPick(`${TARGET_PREFIX}不存在`)).toBe(false);
    });
});

describe("多选：累加 + 确认格（Nous 选的 A 方案）", () => {
    it("★ 多选时点一个不清掉别的 —— 多选的全部意义就在这", () => {
        const { actor, 设为目标 } = 布景();
        applyTargetPick(targetOptions(actor)[0].id, true);
        expect(设为目标).toHaveBeenCalledWith(true, { releaseOthers: false });
    });

    it("★ 再点一次取消 —— 没有取消的多选是个陷阱，点错只能退出重来", () => {
        // ⚠ 复用上一份布景的 token 时，它们带的是**那一份**的 mock —— 断言要对着它，
        //   不然会看到"一次都没调用"，误以为取消没实现。
        const 先 = 布景();
        布景({ tokens: 先.全部, targets: new Set([先.全部[1]]) });
        applyTargetPick(`${TARGET_PREFIX}t1`, true);
        expect(先.设为目标).toHaveBeenCalledWith(false, { releaseOthers: false });
    });

    it("单选仍然是替换", () => {
        const { actor, 设为目标 } = 布景();
        applyTargetPick(targetOptions(actor)[0].id, false);
        expect(设为目标).toHaveBeenCalledWith(true, { releaseOthers: true });
    });

    it("多选时多出一个确认格", () => {
        const { actor } = 布景();
        const 单 = targetOptions(actor, "any", false);
        const 多 = targetOptions(actor, "any", true);
        expect(多.length).toBe(单.length + 1);
        expect(多.at(-1)!.id).toBe(TARGET_DONE);
    });

    it("★ 确认格印出选了几个 —— 玩家不该只能凭记忆数", () => {
        const 先 = 布景();
        const { actor } = 布景({ tokens: 先.全部, targets: new Set([先.全部[1], 先.全部[2]]) });
        const 完成 = targetOptions(actor, "any", true).at(-1)!;
        expect(完成.badge).toBe("2");
        expect(完成.detail).toContain("2 targets");
    });

    it("★ 一个都没选时确认格灰显但仍可点（提示不是锁），且写明原因", () => {
        const { actor } = 布景();
        const 完成 = targetOptions(actor, "any", true).at(-1)!;
        expect(完成.state).toBe("gated");
        expect(完成.reason).toBeTruthy();
    });

    it("确认格本身不会被当成一个目标去设置", () => {
        expect(applyTargetPick(TARGET_DONE, true)).toBe(false);
    });
});
