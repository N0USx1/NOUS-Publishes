import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { costToSectorCost } from "./actions";
import { isGenericIcon } from "../icons";

/**
 * 按动作消耗给的记号图 —— 职业能力里通用图标条目的兜底。
 * 不求"这个能力是什么"，只求"这一格与旁边那格不一样"。
 */
const COST_ICONS: Record<string, string> = {
    "1": "icons/svg/upgrade.svg",
    "2": "icons/svg/up.svg",
    "3": "icons/svg/explosion.svg",
    reaction: "icons/svg/combat.svg",
    free: "icons/svg/circle.svg",
};

/**
 * 采集需要的最小 item 形状。抽出来才能不依赖 Foundry 做单测。
 * 字段名全部出自 2026-08-05 的游戏内实测。
 */
export interface ClassItemLike {
    id: string;
    name: string;
    type: string;
    img?: string;
    /** `item.system.traits.value` */
    traits: string[];
    /** `item.system.actionType.value`。⚠ **法术没有这个字段**（实测 undefined） */
    actionType?: string;
    /** `item.system.actions.value` */
    actions?: number | null;
    /** `item.system.category`。实测取值：`class` / `classfeature` / `ancestry` / `offensive` / `defensive` */
    category?: string;
    /** `item.flags.pf2e.grantedBy.id` —— 发出它的那个 item */
    grantedById?: string | null;
}

/**
 * 这个条目属不属于本职业。
 *
 * ★★ **光看 trait 是不够的**（2026-08-05 compendium 实读推翻了原方案）：
 *   战士的招牌反应 `Reactive Strike` 本体 **`traits: []`**，
 *   只按 trait 采集，**战士的职业扇区会是空的** —— 而反击正是他每回合在等的操作。
 *   它的归属只存在于 GrantItem 关系里：发它的是带 `fighter` trait 的职业特性。
 *
 *   所以判定要**沿 `grantedBy` 链往上回溯**，链上任何一环带本职业 trait 就算。
 *   文档实读显示这是 pf2e 的**主流做法**：狂暴、勇者反应、战术牌、变形、嘲讽、
 *   反击全都是职业特性用 GrantItem 发出来的。
 *
 * ⚠ **不按 pack 路径推归属**（§6.2 守则）：仓库已知两处归档错误
 *   （`commander/shift-immanence.json` 实为典范动作）。读 actor 上的 item 天然规避。
 *
 * ⚠ 回溯要防成环：`seen` 不是可选的洁癖，grantedBy 理论上可以互指。
 */
function belongsToClass(
    item: ClassItemLike,
    classSlug: string,
    resolve: (id: string) => ClassItemLike | undefined,
): boolean {
    const seen = new Set<string>();
    let cur: ClassItemLike | undefined = item;
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.traits?.includes(classSlug)) return true;
        cur = cur.grantedById ? resolve(cur.grantedById) : undefined;
    }
    return false;
}

/**
 * 按 §6.2 采集职业能力：属于本职业的**非被动**条目，**跨 item type**。
 *
 * ★ 实测（Magus）四条横跨 action / feat / spell 三种 type：
 *   只扫 `type === "action"` 会漏掉 Spell Parry 与 Dimensional Assault，
 *   而后者恰恰是 Magus 每回合真在做的事之一。
 */
export function pickClassItems(
    items: ClassItemLike[],
    classSlug: string | null,
    resolve: (id: string) => ClassItemLike | undefined,
): ClassItemLike[] {
    if (!classSlug) return [];
    return items.filter(i => {
        // ⚠ 法术没有 actionType（实测 undefined）。用 `=== "passive"` 而不是
        //    `!== "action"`，否则法术会被当成被动一并删掉。
        if (i.actionType === "passive") return false;
        return belongsToClass(i, classSlug, resolve);
    });
}

/**
 * 角色的职业名，没有职业返回 null。
 *
 * ⚠ 局部豁免收在这一处：`class` 只在 `CharacterPF2e` 上，
 *   而 `resolveActor()` 标的是基类 `ActorPF2e`（NPC 也可能被选中）。
 *   **别在别处各写一遍 `as any`** —— 那样豁免就散开了。
 */
export function className(actor: ActorPF2e | null): string | null {
    return (actor as any)?.class?.name ?? null;
}

/** 采集职业能力扇区。只读，绝不写 actor。 */
export function collectClassAbilities(actor: ActorPF2e | null): SectorData[] {
    try {
        const classSlug = (actor as any)?.class?.slug ?? null;
        if (!classSlug) return [];

        const items: ClassItemLike[] = ((actor as any)?.items?.contents ?? []).map((i: any) => ({
            id: i.id,
            name: i.name,
            type: i.type,
            img: i.img,
            traits: i.system?.traits?.value ?? [],
            actionType: i.system?.actionType?.value,
            actions: i.system?.actions?.value ?? null,
            category: i.system?.category,
            grantedById: i.flags?.pf2e?.grantedBy?.id ?? null,
        }));
        const byId = new Map(items.map(i => [i.id, i]));
        const resolve = (id: string) => byId.get(id);

        return pickClassItems(items, classSlug, resolve).map((i): SectorData => {
            // ⚠ 法术的动作消耗不在 `system.actions` 上，这里读不到就按不显示处理，
            //   宁可不画记号也不画错一个（同 costToSectorCost 的立场）。
            const cost = i.actionType === "reaction" ? "reaction"
                       : i.actionType === "free" ? "free"
                       : costToSectorCost(i.actions ?? null);
            return {
                id: `class:${i.id}`,
                label: i.name,
                /*
                 * ⚠ 实测 actor 自带的动作条目**多数是通用消耗图标**
                 *   （`systems/pf2e/icons/actions/OneAction.webp` 之流），一圈全长一样。
                 *
                 * ★ 职业能力**不做逐条映射** —— 29 个职业上千个条目，按名字配图标
                 *   既做不完也必然在多职业/原型/模组内容上出错。
                 *   通用图标的一律按消耗给一个"这是几个动作"的记号图，
                 *   至少比一圈完全相同的图标有区分度，名字仍由中心毂显示。
                 */
                img: isGenericIcon(i.img)
                    ? (COST_ICONS[String(cost ?? "")] ?? undefined)
                    : i.img,
                cost,
                // ★ 反应在扇区上直接标出来（Nous 2026-08-05 定"用记号区分"）：
                //   它与主动动作混在同一圈里，不标的话玩家会以为它花掉一个动作。
                badge: cost === "reaction" ? "⟳" : undefined,
                state: "normal",
            };
        });
    } catch (err) {
        console.error("player-action-ui-hub | collectClassAbilities 失败", err);
        return [];
    }
}
