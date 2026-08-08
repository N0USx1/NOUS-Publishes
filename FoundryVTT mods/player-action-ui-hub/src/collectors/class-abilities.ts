import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { costToSectorCost } from "./actions";
import { isGenericIcon } from "../icons";
import { specOf, usesSheetAbilities } from "../actor-kinds";
import { detailLine, HUB_CLAUSE_MAX } from "../triggers";
import { restrictionFor, restrictionStateOf } from "../restrictions";
import { sheetActionsOf } from "../sheet-actions";
import { sheetSector } from "./sheet-sectors";

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
    /** `item.system.description.value`。只用来取反应的 Trigger 段（见 triggers.ts） */
    description?: string;
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
 * 沿 `grantedBy` 链往上找第一个**专属**图标。
 *
 * ★★ **图标不需要我们映射，pf2e 早就有了，只是不在我们取的那一环**
 *   （2026-08-05 Nous 质疑后查出来的，我原先的"上千条目做不完映射"是伪问题）。
 *
 *   pack 索引统计说明了系统的设计意图：
 *     `pf2e.actionspf2e`   574 条 → 专属图标 **0 条**（一律用消耗图标）
 *     `pf2e.classfeatures` 880 条 → 专属图标 **874 条（99%）**
 *     `pf2e.feats-srd`    6283 条 → **100%**
 *
 *   即：**能执行的那条动作用消耗图标，真图标挂在发出它的 feat / classfeature 上**。
 *   实测同一个角色身上：
 *     `Arcane Cascade(action)` → `actions/OneAction.webp`（通用）
 *     `Arcane Cascade(feat)`   → `features/classes/arcane-cascade.webp`（专属）
 *
 *   而这两条正是 `grantedBy` 连着的 —— 与归属判定**走同一条链**，
 *   顺手把图标带回来即可，一条映射都不用写。
 */
export function iconFromChain(
    item: ClassItemLike,
    resolve: (id: string) => ClassItemLike | undefined,
): string | undefined {
    const seen = new Set<string>();
    let cur: ClassItemLike | undefined = item;
    while (cur && !seen.has(cur.id)) {     // 防成环，同 belongsToClass
        seen.add(cur.id);
        if (!isGenericIcon(cur.img)) return cur.img;
        cur = cur.grantedById ? resolve(cur.grantedById) : undefined;
    }
    return undefined;
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
    /** 照卡上列（没有职业概念的 actor）；由 actor 类型决定，见 actor-kinds.ts */
    sheetAbilities = false,
): ClassItemLike[] {
    return items.filter(i => {
        // ⚠ 法术没有 actionType（实测 undefined）。用 `=== "passive"` 而不是
        //    `!== "action"`，否则法术会被当成被动一并删掉。
        if (i.actionType === "passive") return false;
        return isOwnAbility(i, classSlug, resolve, sheetAbilities);
    });
}

/**
 * 这个条目算不算"**这个角色自己的招牌能力**"。
 *
 * ★★ **判据从"归不归本职业"改成"它现在能不能用"**（2026-08-05，alpha 反馈推动）。
 *   旧判据要求条目沿 grantedBy 链带上本职业 trait，于是三类东西全被滤掉：
 *
 *   | 被滤掉的 | 实测原因 |
 *   |---|---|
 *   | **专长档动作**（Archer/Pirate/Assassin Dedication…） | traits 是 `["archetype","dedication"]`，永远不含 classSlug |
 *   | **NPC 的招牌动作** | NPC **没有 class**，旧代码第一行就 `return []`，整个分类是空的 |
 *   | 血统/传承给的主动能力 | 同理 |
 *
 *   这与状态区那次是**同一个错误**：过滤问的是"这归不归我的职业"，
 *   而玩家/GM 要的是"**我现在能不能用它**"。两个问题的主语不同。
 *
 * ⚠ 职业链回溯**没有删**，它仍是唯一能捞出战士 `Reactive Strike`（traits 为空）的办法；
 *   现在它只是"算数的理由之一"，不再是唯一理由。
 *
 * ⚠ **判据在 actor 身上（它是哪种类型），不是条目的 category**（第一版写错，被单测抓出来）：
 *   `offensive` / `defensive` 这些 category **在 PC 身上也有**，
 *   拿它认 NPC 会把 PC 的一堆东西一并放进职业分类。
 *   而 NPC 根本没有职业，**它卡上的每一条非被动动作都是它自己的招牌** —— 判据在 actor 身上。
 */
export function isOwnAbility(
    item: ClassItemLike,
    classSlug: string | null,
    resolve: (id: string) => ClassItemLike | undefined,
    sheetAbilities = false,
): boolean {
    // ① 没有职业概念的 actor（npc / familiar / hazard / vehicle …）：
    //    卡上的非被动 action 条目就是它会的（实测 Zaramuun 有 7 条）
    if (sheetAbilities) return item.type === "action";
    // ② 本职业的（含 traits 为空、只能靠 grantedBy 链认出来的那些）
    if (classSlug && belongsToClass(item, classSlug, resolve)) return true;
    // ③ 专长档 —— 角色特地选进来的，按定义就是他要用的
    return !!item.traits?.includes("archetype");
}

/**
 * 角色的职业名，没有职业返回 null。
 *
 * ⚠ 局部豁免收在这一处：`class` 只在 `CharacterPF2e` 上，
 *   而 `resolveActor()` 标的是基类 `ActorPF2e`（NPC 也可能被选中）。
 *   **别在别处各写一遍 `as any`** —— 那样豁免就散开了。
 */
export function className(actor: ActorPF2e | null): string | null {
    // 没有职业的 actor 也要有个标题：标题按**类型**给（见 actor-kinds.ts），
    // 留空会让毂里显示成 "Class"，对着一只怪物或一个陷阱读起来是错的。
    return (actor as any)?.class?.name ?? specOf(actor).abilityTitle;
}

/** 采集职业能力扇区。只读，绝不写 actor。 */
export function collectClassAbilities(actor: ActorPF2e | null): SectorData[] {
    try {
        // ⚠ **不再因为没有 class 就返回空** —— NPC 没有 class，但它的招牌动作
        //   正是 GM 每回合要点的东西（alpha 反馈："NPC special actions do not show up at all"）。
        const classSlug = (actor as any)?.class?.slug ?? null;

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
            description: i.system?.description?.value ?? "",
        }));
        const byId = new Map(items.map(i => [i.id, i]));
        const resolve = (id: string) => byId.get(id);

        // ⚠ 每层只算一次，别放进逐条目判定里
        const 限制态 = restrictionStateOf(actor);

        /*
         * ★★ **优先照角色卡搬**（Nous 2026-08-07："他们有什么我们就把那些搬过来"）。
         *   卡上那份清单比我们自己的判据全 —— `isOwnAbility` 改过两次，
         *   每次都是因为又漏了一类（专长档 / NPC 招牌动作 / 血统能力）。
         * ⚠ 拿不到卡数据才走下面的退化路径（魔宠/载具/危害这些卡形状不同）。
         */
        const 卡 = sheetActionsOf(actor);
        if (卡) {
            const byId = new Map(((actor as any)?.items?.contents ?? []).map((i: any) => [i.id, i]));
            // ⚠ 转换只此一份（`sheetSector`）—— Actions / Free / Reactions / Class 共用
            return 卡.map(s => sheetSector(s, "class:", byId.get(s.id), 限制态));
        }
        // ★ 顶层判据是 **actor 类型**（Nous 2026-08-05），不是"有没有 class"这种补丁
        return pickClassItems(items, classSlug, resolve, usesSheetAbilities(actor)).map((i): SectorData => {
            const 限 = restrictionFor({ slug: (i as any).slug ?? null, traits: i.traits }, 限制态);
            // ⚠ 法术的动作消耗不在 `system.actions` 上，这里读不到就按不显示处理，
            //   宁可不画记号也不画错一个（同 costToSectorCost 的立场）。
            const cost = i.actionType === "reaction" ? "reaction"
                       : i.actionType === "free" ? "free"
                       : costToSectorCost(i.actions ?? null);
            return {
                id: `class:${i.id}`,
                label: i.name,
                // 自己是通用消耗图标时，沿 grantedBy 链去上一环取专属图标（见 iconFromChain）
                img: iconFromChain(i, resolve),
                cost,
                // ★ 反应在扇区上直接标出来（Nous 2026-08-05 定"用记号区分"）：
                //   它与主动动作混在同一圈里，不标的话玩家会以为它花掉一个动作。
                badge: cost === "reaction" ? "⟳" : undefined,
                /*
                 * ★ **反应显示它的触发条件**（丙类第一件能做的事，2026-08-05）。
                 *   实测 105 个反应里 99 个（94%）描述里带 Trigger 段，
                 *   而**没有一个**用规则元素表达时机 —— 所以"自动开反应窗口"做不到，
                 *   但"把那句话摆到眼前"做得到，且对全职业通用、零映射。
                 *   玩家真正卡住的是"我现在到底能不能反击"，答案本来就写在条目里。
                 * ⚠ 只给反应。主动动作的触发段（如果有）不是玩家等的那件事。
                 */
                //   ⚠ 必须把 localize 传进去：NPC 的能力描述常常整段是 @Localize 引用，
                //     不展开的话**每一个 NPC 反应都读不到触发条件**，而且不报错。
                detail: detailLine(i.description, cost === "reaction", HUB_CLAUSE_MAX,
                                   (k) => game.i18n.localize(k)) ?? undefined,
                // ★ 灰显不是禁止：变暗 + ⛔ + 毂里说明为什么，点下去照样执行
                state: 限?.state ?? "normal",
                reason: 限?.reason,
            };
        });
    } catch (err) {
        console.error("player-action-ui-hub | collectClassAbilities 失败", err);
        return [];
    }
}
