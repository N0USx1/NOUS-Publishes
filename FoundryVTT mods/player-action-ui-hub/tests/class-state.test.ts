import { describe, it, expect } from "vitest";
import {
    classStateLines, readClassState, collectToggles, collectEffects,
    HIDDEN_RESOURCES, RESOURCE_LABELS, humanizeKey, resourceLines, MAX_STATE_LINES,
    type StateInput, type StateLine,
} from "../src/class-state";

const 空: StateInput = { resources: [], toggles: [], effects: [] };
const 行 = (key: string, label: string, value: string): StateLine => ({ key, label, value });

/**
 * 造 actor。字段名全部对着 2026-08-05 的实测：
 * `synthetics.toggles` 是 `{域: {选项: 开关}}`，开关带 option/label/enabled/suboptions/selection。
 */
function 角色(over: any = {}) {
    return {
        class: { slug: over.classSlug ?? "magus" },
        system: { resources: over.resources ?? { focus: { value: 1, max: 2 }, heroPoints: { value: 1, max: 3 } } },
        synthetics: { toggles: over.toggles ?? {} },
        itemTypes: { effect: over.effects ?? [] },
    } as any;
}

describe("资源：全推导，一条职业映射都不写", () => {
    it("★★ 会变的池子都收 —— 判据是 max > 0，不是「这条归哪个职业」", () => {
        const 出 = resourceLines(角色({ resources: {
            focus: { value: 1, max: 2 },
            heroPoints: { value: 1, max: 3 },
            versatileVials: { value: 2, max: 3 },   // 炼金术士（remaster 后的真名）
        } }));
        expect(出.map((r: any) => r.label)).toEqual(["Focus", "Hero Points", "Vials"]);
    });

    it("★★ 新职业的新资源自动出现 —— 这正是删掉登记表的理由", () => {
        // 旧表写死 crafting.infusedReagents，remaster 换成 versatileVials 之后
        // 那一行**永远不显示且不报错**。推导式的判据不会踩这个。
        const 出 = resourceLines(角色({ resources: { someNewPool: { value: 4, max: 9 } } }));
        expect(出).toHaveLength(1);
        expect(出[0].label).toBe("Some New Pool");
        expect(出[0].value).toBe("4/9");
    });

    it("★ investiture 不显示 —— 被动上限（人人 0/10），一场战斗里不会变", () => {
        expect(HIDDEN_RESOURCES.has("investiture")).toBe(true);
        expect(resourceLines(角色({ resources: { investiture: { value: 0, max: 10 } } }))).toEqual([]);
    });

    it("max 为 0 的不显示（这角色没有这项资源）", () => {
        const 出 = resourceLines(角色({ resources: { focus: { value: 0, max: 0 }, heroPoints: { value: 2, max: 3 } } }));
        expect(出.map((r: any) => r.label)).toEqual(["Hero Points"]);
    });

    it("值现读，格式是 值/上限", () => {
        expect(resourceLines(角色()).find((r: any) => r.label === "Focus")!.value).toBe("1/2");
    });

    it("★ 嵌套的池子不递归 —— 实测那一层是废弃的 crafting.infusedReagents", () => {
        expect(resourceLines(角色({ resources: { crafting: { infusedReagents: { value: 3, max: 8 } } } }))).toEqual([]);
    });

    it("显示名表只管好看，不管显不显示", () => {
        expect(RESOURCE_LABELS["versatileVials"]).toBe("Vials");
        expect(humanizeKey("versatileVials")).toBe("Versatile Vials");
        expect(humanizeKey("focus")).toBe("Focus");
    });

    it("readClassState 把它接进去了", () => {
        expect(readClassState(角色()).resources.map((r: any) => r.label)).toContain("Focus");
    });
});

describe("开关：按 option 归组，不按职业过滤", () => {
    /** 典范：多个圣像各声明一遍 divine-spark，神火在其中一个上 */
    const 典范开关 = {
        all: {
            "divine-spark": {
                option: "divine-spark", label: "Divine Spark", enabled: true,
                selection: "skin-hard-as-horn",
                suboptions: [
                    { value: "thousand-league-sandals", label: "Thousand-League Sandals" },
                    { value: "skin-hard-as-horn", label: "Skin Hard as Horn" },
                ],
            },
        },
        "strike-attack-roll": {
            // 同一个开关的另一个作用面，不是第二个状态
            "divine-spark": {
                option: "divine-spark", label: "Divine Spark", enabled: true,
                selection: "skin-hard-as-horn", suboptions: [],
            },
        },
    };

    it("★ 有子选项时，值是**选中的那个** —— 玩家要看的是神火在哪，不是开着没", () => {
        const 出 = collectToggles(角色({ toggles: 典范开关 }));
        expect(出).toEqual([{ key: "toggle:divine-spark", label: "Divine Spark", value: "Skin Hard as Horn" }]);
    });

    it("★ 同一 option 出现在多个 domain 只算一条", () => {
        expect(collectToggles(角色({ toggles: 典范开关 })).length).toBe(1);
    });

    it("★ 不按职业 trait 过滤 —— 神火挂在 traits 只有 ikon 的圣像上，过滤必然漏掉", () => {
        // 这条角色的 class 是 magus，而开关来自圣像；旧做法会把它全部滤掉
        expect(collectToggles(角色({ classSlug: "magus", toggles: 典范开关 })).length).toBe(1);
    });

    it("血统专长的开关照样显示 —— 那也是玩家自己在开关的状态", () => {
        const 出 = collectToggles(角色({
            toggles: { all: { "dragons-flight": { option: "dragons-flight", label: "Dragon's Flight", enabled: true } } },
        }));
        expect(出).toEqual([{ key: "toggle:dragons-flight", label: "Dragon's Flight", value: "on" }]);
    });

    it("没有子选项就显示开/关", () => {
        const 出 = collectToggles(角色({ toggles: { all: { x: { option: "x", label: "X", enabled: false } } } }));
        expect(出[0].value).toBe("off");
    });

    it("没有开关就是空", () => expect(collectToggles(角色())).toEqual([]));
});

describe("effect", () => {
    it("★ panache 的 badge 是 null（实测）—— 它是有没有，不是几层", () => {
        const 出 = collectEffects(角色({ effects: [{ name: "Effect: Panache", slug: "panache", system: {} }] }));
        expect(出).toEqual([{ key: "effect:panache", label: "Panache", value: "active" }]);
    });

    it("带 badge 的显示数字", () => {
        const 出 = collectEffects(角色({
            effects: [{ name: "Effect: Cursebound", slug: "cursebound", system: { badge: { value: 2 } } }],
        }));
        expect(出[0].value).toBe("2");
    });

    it("去掉名字里的 Effect: 前缀（毂里那是噪音）", () => {
        const 出 = collectEffects(角色({ effects: [{ name: "Effect: Panache", slug: "p", system: {} }] }));
        expect(出[0].label).toBe("Panache");
    });
});

describe("排版：一条一行", () => {
    it("没有内容就整格不出现", () => expect(classStateLines(空)).toEqual([]));

    it("★★ 一条一行 —— 两个数挤在一行，要找其中一个得先在串里定位它", () => {
        // Nous 2026-08-07："hero 和 focus 那个我们之前说按照类型换行"
        const 出 = classStateLines({ resources: [行("focus", "Focus", "1/2"), 行("hero", "Hero Points", "1/3")], toggles: [行("toggle:a", "Dragon's Flight", "on")],
            effects: [行("effect:p", "Panache", "active")],
        });
        expect(出).toEqual([
            "Focus ✦ 1/2",
            "Hero Points ✦ 1/3",
            "Dragon's Flight ✦ on",
        ]);
        // ⚠ Panache 被上限挤掉了 —— 这是"一条一行"的**代价**，写在这里免得下次当成 bug
        expect(出).toHaveLength(MAX_STATE_LINES);
    });

    it("⚠ 条数多了会顶到上限 —— 所以顺序（资源→开关→effect）是真实取舍不是偏好", () => {
        const 多资源 = { ...空, resources: Array.from({ length: 6 }, (_, i) => 行(`r${i}`, `R${i}`, "1/1")) };
        expect(classStateLines(多资源).length).toBe(MAX_STATE_LINES);
    });

    it("空类目不占行（空行比不显示更糟，玩家会以为漏加载）", () => {
        expect(classStateLines({ ...空, effects: [行("e", "Panache", "active")] }))
            .toEqual(["Panache ✦ active"]);
    });

    it("顺序按「多快会变」：资源 → 开关 → effect", () => {
        const 出 = classStateLines({ resources: [行("f", "Focus", "1/2")], toggles: [行("t", "T", "on")],
            effects: [行("e", "E", "active")],
        });
        expect(出.map(l => l[0])).toEqual(["F", "T", "E"]);
    });

    it("开关内部：有具体选择的排前面（神火在哪比开着没信息量大）", () => {
        const 出 = classStateLines({
            ...空,
            toggles: [行("a", "Plain", "on"), 行("b", "Divine Spark", "Skin Hard as Horn")],
        });
        expect(出[0]).toBe("Divine Spark ✦ Skin Hard as Horn");
        expect(出[1]).toBe("Plain ✦ on");
    });

    it("行数不会超过上限", () => {
        const 满 = { resources: [行("a","A","1")], toggles: [行("b","B","on")], effects: [行("c","C","active")] };
        expect(classStateLines(满).length).toBeLessThanOrEqual(MAX_STATE_LINES);
    });
});

describe("readClassState 出错不炸盘", () => {
    it("actor 是 null 时返回空的三段", () => {
        expect(readClassState(null)).toEqual(空);
    });
});

