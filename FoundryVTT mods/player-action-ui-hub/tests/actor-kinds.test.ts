import { describe, it, expect } from "vitest";
import { KIND_SPECS, kindOf, specOf, usesSheetAbilities, type ActorKind } from "../src/actor-kinds";

const 演员 = (type: string) => ({ type } as any);

describe("按 actor 类型分派（甲的顶层判定）", () => {
    it("★ 九种类型全部登记 —— 少一种就会静默走默认分支", () => {
        const 系统给的: ActorKind[] = ["character","npc","familiar","hazard","loot","party","vehicle","army","base"];
        expect(Object.keys(KIND_SPECS).sort()).toEqual([...系统给的].sort());
    });

    it("玩家角色走职业链，其余走卡上列", () => {
        expect(specOf(演员("character")).abilities).toBe("class");
        for (const t of ["npc", "familiar", "hazard", "vehicle", "army"]) {
            expect(usesSheetAbilities(演员(t))).toBe(true);
        }
    });

    it("★ 战利品堆与队伍容器没有可执行的东西，且写明原因", () => {
        for (const t of ["loot", "party"]) {
            expect(KIND_SPECS[t as ActorKind].usable).toBe(false);
            expect(KIND_SPECS[t as ActorKind].note?.length).toBeGreaterThan(10);
        }
    });

    it("没有职业的类型都给了标题 —— 留空会显示成 Class，对着陷阱读起来是错的", () => {
        for (const t of ["npc", "familiar", "hazard", "vehicle", "army"]) {
            expect(specOf(演员(t)).abilityTitle).toBeTruthy();
        }
        expect(specOf(演员("character")).abilityTitle).toBeNull();
    });

    it("认不出的类型归到 base，不抛错", () => {
        expect(kindOf(演员("某种未来类型"))).toBe("base");
        expect(kindOf(null)).toBe("base");
    });
});
