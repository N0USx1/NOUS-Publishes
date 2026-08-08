import type { ActorPF2e } from "foundry-pf2e";

/**
 * **按 actor 类型分派**（Nous 2026-08-05：「这个可以变成甲的顶层判定」）。
 *
 * ★ **为什么这是顶层而不是一堆 if**：
 *   轮盘一开始只按"玩家角色"造，于是每碰到一种别的 actor 就补一个布尔
 *   （`isNpc`、`hasClass`…）。补到第二个就该停 —— pf2e **自己就把这件事分好了类**，
 *   `game.documentTypes.Actor` 实测九种：
 *     `character` `npc` `familiar` `hazard` `loot` `party` `vehicle` `army` `base`
 *   顺着它分派，比我们自己发明判据可靠：**分类是系统给的，不是我推的**。
 *
 * ★ 下面每一栏都是**实测**（各造一个空 actor 读出来的），不是照文档抄：
 *
 *   | 类型 | class | system.actions(打击) | resources | saves | skills | 施法 |
 *   |---|---|---|---|---|---|---|
 *   | character | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
 *   | npc       | ❌ | ✅ | — | ✅ | ✅ | ✅ |
 *   | familiar  | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
 *   | hazard    | ❌ | **✅** | ❌ | ✅ | ✅ | ❌ |
 *   | vehicle   | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
 *   | army      | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
 *   | loot/party| ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
 *
 *   ⚠ 注意 `hazard` **有打击** —— 陷阱会攻击。想当然地"只有 character/npc 能打"是错的。
 *
 * ⚠ 这张表只登记**推不出来的那一样**：这种 actor 值不值得开轮盘、
 *   它的"招牌能力"该怎么认。数值形状一律现读（同 aura / CLASS_RESOURCES 那两张表）。
 */

/** pf2e 的 actor 类型 id。 */
export type ActorKind =
    | "character" | "npc" | "familiar" | "hazard" | "loot" | "party" | "vehicle" | "army" | "base";

export interface KindSpec {
    kind: ActorKind;
    /** 值不值得为它开轮盘。`loot`/`party` 没有任何可执行的东西 */
    usable: boolean;
    /** 「招牌能力」那一层的标题；null = 用职业名 */
    abilityTitle: string | null;
    /**
     * 招牌能力怎么认：
     *  - `class`：沿 grantedBy 链找本职业 + 专长档（玩家角色）
     *  - `sheet`：卡上所有非被动 action 条目（没有职业的东西，卡上写的就是它会的）
     *  - `none`：没有这一类
     */
    abilities: "class" | "sheet" | "none";
    /** 一句话说明，用于灰显时告诉用户为什么 */
    note?: string;
}

/**
 * ⚠ **默认 `sheet` 而不是 `none`**：遇到没登记的类型（将来 pf2e 加的），
 *   宁可把卡上的动作列出来让人自己挑，也不要给一个空盘。
 *   宁可多显示，不要静默什么都没有 —— 空盘和"坏了"长得一模一样。
 */
export const KIND_SPECS: Record<ActorKind, KindSpec> = {
    character: { kind: "character", usable: true,  abilityTitle: null,        abilities: "class" },
    npc:       { kind: "npc",       usable: true,  abilityTitle: "Abilities", abilities: "sheet" },
    familiar:  { kind: "familiar",  usable: true,  abilityTitle: "Abilities", abilities: "sheet" },
    // 陷阱实测**有打击**，GM 要靠它掷攻击
    hazard:    { kind: "hazard",    usable: true,  abilityTitle: "Abilities", abilities: "sheet" },
    vehicle:   { kind: "vehicle",   usable: true,  abilityTitle: "Abilities", abilities: "sheet" },
    army:      { kind: "army",      usable: true,  abilityTitle: "Abilities", abilities: "sheet" },
    loot:      { kind: "loot",      usable: false, abilityTitle: null, abilities: "none",
                 note: "A loot pile has nothing to act with." },
    party:     { kind: "party",     usable: false, abilityTitle: null, abilities: "none",
                 note: "A party actor is a container, not something that acts." },
    base:      { kind: "base",      usable: false, abilityTitle: null, abilities: "none",
                 note: "This actor type has no sheet data to act on." },
};

export function kindOf(actor: ActorPF2e | null | undefined): ActorKind {
    const t = (actor as any)?.type;
    return (t && t in KIND_SPECS) ? t as ActorKind : "base";
}

export function specOf(actor: ActorPF2e | null | undefined): KindSpec {
    // 未登记的类型走 npc 那套（卡上有什么列什么），理由见 KIND_SPECS 注释
    const k = kindOf(actor);
    return KIND_SPECS[k] ?? KIND_SPECS.npc;
}

/** 招牌能力是不是「照卡上列」——即没有职业概念的那些 actor。 */
export function usesSheetAbilities(actor: ActorPF2e | null | undefined): boolean {
    return specOf(actor).abilities === "sheet";
}
