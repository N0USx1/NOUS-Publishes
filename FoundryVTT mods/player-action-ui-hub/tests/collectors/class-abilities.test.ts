import { describe, it, expect } from "vitest";
import { pickClassItems, iconFromChain, type ClassItemLike } from "../../src/collectors/class-abilities";

/** 按 id 取该条目沿链解析出来的图标 */
const collectIconFor = (items: ClassItemLike[], id: string) =>
    iconFromChain(items.find(i => i.id === id)!, (x) => items.find(i => i.id === x));

/*
 * 断言全部对着 2026-08-05 的游戏内实测与 compendium 实读：
 *   - Magus 角色上四条职业条目横跨 action / feat / spell 三种 type；
 *   - `Reactive Strike` 本体 `traits: []`、`actionType: "reaction"`（compendium 实读）；
 *   - `Weapon Expertise` 的 traits 含 **16 个职业**；
 *   - `Assurance (Occultism)` 由 **background** 经 GrantItem 发出。
 */
function item(over: Partial<ClassItemLike> = {}): ClassItemLike {
    return {
        id: "i1", name: "Arcane Cascade", type: "action", img: "x.webp",
        traits: ["magus"], actionType: "action", actions: 1, category: "offensive",
        grantedById: null,
        ...over,
    };
}

/** 造一个 id → item 的回查函数，模拟 actor.items.get */
const resolver = (items: ClassItemLike[]) => (id: string) => items.find(i => i.id === id);

describe("pickClassItems · 按 trait 直接命中", () => {
    it("★ 跨 item type 采集：action / feat / spell 都要收", () => {
        const items = [
            item({ id: "a", type: "action", name: "Arcane Cascade" }),
            item({ id: "b", type: "feat", name: "Spell Parry", category: "class" }),
            item({ id: "c", type: "spell", name: "Dimensional Assault", actionType: undefined, actions: null }),
        ];
        expect(pickClassItems(items, "magus", resolver(items)).map(i => i.name))
            .toEqual(["Arcane Cascade", "Spell Parry", "Dimensional Assault"]);
    });

    it("不带本职业 trait 的不收", () => {
        const items = [item({ id: "a" }), item({ id: "b", name: "Rage", traits: ["barbarian"] })];
        expect(pickClassItems(items, "magus", resolver(items)).map(i => i.name)).toEqual(["Arcane Cascade"]);
    });

    it("被动条目不收（职业扇区装的是每回合在做的事）", () => {
        const items = [
            item({ id: "a" }),
            item({ id: "b", name: "Psychometric Assessment", actionType: "passive", actions: null }),
        ];
        expect(pickClassItems(items, "magus", resolver(items)).map(i => i.name)).toEqual(["Arcane Cascade"]);
    });

    it("★ 法术没有 actionType，不许被当成被动删掉", () => {
        const items = [item({ id: "c", type: "spell", name: "Dimensional Assault", actionType: undefined, actions: null })];
        expect(pickClassItems(items, "magus", resolver(items)).map(i => i.name)).toEqual(["Dimensional Assault"]);
    });

    it("职业 slug 为空时返回空（没职业就没有职业扇区）", () => {
        const items = [item()];
        expect(pickClassItems(items, null, resolver(items))).toEqual([]);
    });

    it("多职业共用的 trait 里含本职业时照收（那确实是本职业也有的能力）", () => {
        const items = [item({ id: "a", name: "Weapon Expertise", traits: ["champion", "druid", "magus", "witch"] })];
        expect(pickClassItems(items, "magus", resolver(items)).map(i => i.name)).toEqual(["Weapon Expertise"]);
    });
});

/*
 * ★★★ GrantItem 回溯 —— 这一组钉的是「战士的职业扇区不许是空的」。
 *
 * compendium 实读：`Reactive Strike` 本体 **traits 为空数组**。
 * 只按 trait 采集的话，战士打开职业扇区会什么都没有，
 * 而反击正是战士每回合都在等的那个操作。
 * 归属只能靠回溯它的 grantedBy 链——发它的是带 `fighter` trait 的职业特性。
 */
describe("★ 沿 grantedBy 链回溯归属", () => {
    it("★ traits 为空但由本职业特性发出的，要收（战士的反击）", () => {
        const items = [
            item({ id: "act", name: "Reactive Strike", type: "action", traits: [],
                   actionType: "reaction", actions: null, category: "defensive", grantedById: "feat" }),
            item({ id: "feat", name: "Reactive Strike", type: "feat", traits: ["fighter"],
                   category: "classfeature", actionType: "passive" }),
        ];
        expect(pickClassItems(items, "fighter", resolver(items)).map(i => i.name)).toEqual(["Reactive Strike"]);
    });

    it("链上隔了一环也要能回溯到（特性 → 特性 → 动作）", () => {
        const items = [
            item({ id: "act", name: "Taunt", traits: [], grantedById: "mid" }),
            item({ id: "mid", name: "中间特性", traits: [], category: "classfeature",
                   actionType: "passive", grantedById: "root" }),
            item({ id: "root", name: "职业根特性", traits: ["guardian"],
                   category: "classfeature", actionType: "passive" }),
        ];
        expect(pickClassItems(items, "guardian", resolver(items)).map(i => i.name)).toEqual(["Taunt"]);
    });

    it("⚠ 由**背景**发出的不算职业能力（实测 Assurance ← Scholar 是 background）", () => {
        const items = [
            item({ id: "act", name: "Assurance (Occultism)", traits: ["fortune", "general", "skill"],
                   grantedById: "bg" }),
            item({ id: "bg", name: "Scholar (Occultism)", type: "background", traits: [],
                   actionType: "passive" }),
        ];
        expect(pickClassItems(items, "magus", resolver(items))).toEqual([]);
    });

    it("链断了（来源 item 已不在角色身上）不抛错，按不属于处理", () => {
        const items = [item({ id: "act", name: "孤儿动作", traits: [], grantedById: "不存在" })];
        expect(pickClassItems(items, "magus", resolver(items))).toEqual([]);
    });

    it("★ grantedBy 成环时不死循环", () => {
        const items = [
            item({ id: "a", name: "A", traits: [], grantedById: "b" }),
            item({ id: "b", name: "B", traits: [], actionType: "passive", grantedById: "a" }),
        ];
        expect(() => pickClassItems(items, "magus", resolver(items))).not.toThrow();
        expect(pickClassItems(items, "magus", resolver(items))).toEqual([]);
    });

    /*
     * ★★ 图标也走同一条链（2026-08-05 Nous 质疑后查出来的）。
     *   pf2e 的设计：**能执行的动作条目一律用消耗图标，真图标挂在发出它的 feat 上**。
     *   pack 索引实证：actionspf2e 574 条专属图标 **0** 条，
     *   classfeatures 880 条里 **874 条**有专属图标。
     *   所以图标不用映射，顺着 grantedBy 取就行。
     */
    it("★ 自己是通用消耗图标时，取发出它的那一环的专属图标", () => {
        const items = [
            item({ id: "act", name: "Arcane Cascade", traits: ["magus"],
                   img: "systems/pf2e/icons/actions/OneAction.webp", grantedById: "feat" }),
            item({ id: "feat", name: "Arcane Cascade", type: "feat", traits: ["magus"],
                   category: "classfeature", actionType: "passive",
                   img: "systems/pf2e/icons/features/classes/arcane-cascade.webp" }),
        ];
        expect(pickClassItems(items, "magus", resolver(items))).toHaveLength(1);
        // 采集结果里那一条应当拿到 feat 上的专属图标，而不是自己的消耗图标
        const chain = collectIconFor(items, "act");
        expect(chain).toBe("systems/pf2e/icons/features/classes/arcane-cascade.webp");
    });

    it("自己就有专属图标时不去上一环拿", () => {
        const items = [
            item({ id: "act", img: "icons/magic/movement/trail.webp", grantedById: "feat" }),
            item({ id: "feat", img: "systems/pf2e/icons/features/classes/other.webp", actionType: "passive" }),
        ];
        expect(collectIconFor(items, "act")).toBe("icons/magic/movement/trail.webp");
    });

    it("整条链都是通用图标时返回 undefined（退回文字，不硬塞）", () => {
        const items = [
            item({ id: "act", img: "systems/pf2e/icons/actions/OneAction.webp", grantedById: "feat" }),
            item({ id: "feat", img: "systems/pf2e/icons/actions/Passive.webp", actionType: "passive" }),
        ];
        expect(collectIconFor(items, "act")).toBe(undefined);
    });

    it("★ 图标回溯同样要防成环", () => {
        const items = [
            item({ id: "a", img: "systems/pf2e/icons/actions/OneAction.webp", grantedById: "b" }),
            item({ id: "b", img: "systems/pf2e/icons/actions/OneAction.webp", grantedById: "a", actionType: "passive" }),
        ];
        expect(() => collectIconFor(items, "a")).not.toThrow();
        expect(collectIconFor(items, "a")).toBe(undefined);
    });

    it("被动条目即使归属本职业也不收（回溯不改变被动过滤）", () => {
        const items = [
            item({ id: "act", name: "某被动", traits: [], actionType: "passive", grantedById: "feat" }),
            item({ id: "feat", name: "职业特性", traits: ["magus"], actionType: "passive" }),
        ];
        expect(pickClassItems(items, "magus", resolver(items))).toEqual([]);
    });
});
