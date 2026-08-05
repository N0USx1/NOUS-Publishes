import { describe, it, expect } from "vitest";
import {
    classStateLines, readClassState, collectToggles, collectEffects,
    COMMON_RESOURCES, CLASS_RESOURCES, MAX_STATE_LINES,
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

describe("资源：只收会变的", () => {
    it("★ investiture 不在共通表里 —— 它是被动上限（人人 0/10），不是每回合看的状态", () => {
        expect(COMMON_RESOURCES.map(r => r.path)).not.toContain("investiture");
    });

    it("max 为 0 的不显示（这角色没有这项资源）", () => {
        const s = readClassState(角色({ resources: { focus: { value: 0, max: 0 }, heroPoints: { value: 2, max: 3 } } }));
        expect(s.resources.map(r => r.key)).toEqual(["hero"]);
    });

    it("值现读，格式是 值/上限", () => {
        const s = readClassState(角色());
        expect(s.resources.find(r => r.key === "focus")!.value).toBe("1/2");
    });
});

describe("职业资源登记表（内圆按 class 可变）", () => {
    it("★ 只登记推不出来的：哪条资源归哪个职业。值从 actor 读", () => {
        for (const 组 of Object.values(CLASS_RESOURCES)) {
            for (const r of 组) {
                expect(r).not.toHaveProperty("value");
                expect(r).not.toHaveProperty("max");
            }
        }
    });

    it("炼金术士能读到嵌套路径的试剂", () => {
        const s = readClassState(角色({
            classSlug: "alchemist",
            resources: { crafting: { infusedReagents: { value: 3, max: 8 } } },
        }));
        expect(s.resources.find(r => r.key === "reagents")!.value).toBe("3/8");
    });

    it("不是那个职业就不读它的资源", () => {
        const s = readClassState(角色({
            classSlug: "magus",
            resources: { crafting: { infusedReagents: { value: 3, max: 8 } } },
        }));
        expect(s.resources.find(r => r.key === "reagents")).toBeUndefined();
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

describe("排版", () => {
    it("没有内容就整格不出现", () => expect(classStateLines(空)).toEqual([]));

    it("★ 排序按'多快会变'：资源 → 有具体选择的开关 → effect → 纯开/关", () => {
        const 出 = classStateLines({
            resources: [行("focus", "Focus", "1/2")],
            toggles: [行("toggle:a", "Plain", "on"), 行("toggle:b", "Divine Spark", "Skin Hard as Horn")],
            effects: [行("effect:p", "Panache", "active")],
        });
        expect(出[0]).toBe("Focus ✦ 1/2");
        expect(出[1]).toBe("Divine Spark ✦ Skin Hard as Horn");
        expect(出[2]).toBe("Panache ✦ active");
    });

    it("截断只发生在排版这一步，采集不截", () => {
        const 多 = { ...空, resources: Array.from({ length: 6 }, (_, i) => 行(`r${i}`, `R${i}`, "1/1")) };
        expect(classStateLines(多).length).toBe(MAX_STATE_LINES);
    });
});

describe("readClassState 出错不炸盘", () => {
    it("actor 是 null 时返回空的三段", () => {
        expect(readClassState(null)).toEqual(空);
    });
});
