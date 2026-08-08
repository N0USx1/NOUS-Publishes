import type { SectorState } from "./types";

/**
 * **当前状态下用不了的动作**（Nous 2026-08-07 定）。
 *
 * > "那个 barbarian 的发怒置灰是可以做的，不是完全的禁止（你还是可以点击），
 * >  而是置灰 + 条件说明警告 emoji。"
 *
 * ★★ **这是全模组唯一一处把规则写进代码的地方，要一直保持是唯一一处。**
 *   立场一向是"不做规则，照规则做行为"，而这里确实抄了一条规则。
 *   可以接受的三个理由，缺一条就该退回去：
 *   ① **只改显示不改行为** —— 灰的格子照样点得下去（三态守则："提示不是锁"）；
 *   ② 判据全在**结构化数据**里（特性），不解析散文、不算距离；
 *   ③ 它答的是玩家真的会算错的一件事 —— 怒中哪些动作用不了，牌桌上没人记得住。
 *
 *   ⚠ **要加第二条限制之前先问一句**：它是不是又变成"替系统判规则"了。
 *     这张表长到第三条，就说明判据错了，该退回只显示条件的那条路。
 */

/** 一条限制的判定结果。 */
export interface Restriction {
    state: SectorState;
    /** 显示在中心毂的说明。⚠ 说"为什么"，不说"不许" —— 我们不禁止任何事。 */
    reason: string;
}

/** 判定要用到的条目形状。 */
export interface RestrictableItem {
    slug?: string | null;
    traits?: string[];
}

/** 角色当前处在哪些会限制动作的状态里。 */
export interface RestrictionState {
    /** 正在盛怒（实测判据见 `isRaging`） */
    raging?: boolean;
}

/**
 * 角色在不在盛怒中。
 *
 * ★ **两个判据都认**（实测 `Effect: Rage` 的规则是
 *   `ActiveEffectLike ×2 + TempHP + RollOption:rage`）：
 *   - 挂着 slug 为 `effect-rage` 的 effect；
 *   - 或者掷骰选项里有 `rage`（系统自己发的信号，更权威）。
 *
 * ⚠ 只认其中一个都会有静默失效的窗口：别的模组/GM 可能直接给 roll option，
 *   而 effect 又可能被换成同名的自定义条目。两个都认，代价只是一次 `some`。
 */
export function isRaging(actor: unknown): boolean {
    const a = actor as any;
    const 有效果 = (a?.itemTypes?.effect ?? []).some((e: any) => e?.slug === "effect-rage");
    if (有效果) return true;
    try {
        return !!a?.getRollOptions?.(["all"])?.includes?.("rage");
    } catch { return false; }
}

/**
 * 盛怒时用不了的动作。
 *
 * ★ 规则原文：**带 `concentrate` 特性的动作用不了，除非它同时带 `rage` 特性**；
 *   `Seek` 例外，明文允许。
 *
 * ★ 实测支撑（`pf2e.actionspf2e` 全包）：
 *   - 带 `concentrate` 的条目 **145** 个；
 *   - 其中同时带 `rage` 的 **0** 个 —— 也就是说这条例外目前一个都没命中，
 *     但**照样要写**：rage 特性的动作挂在职业特性上、不在通用动作包里，
 *     而且新书随时会加。少写这个条件，狂暴者的招牌动作会被自己灰掉。
 *
 * ⚠ 判据只看**特性**，不解析任何描述文字。
 */
export function restrictionFor(
    item: RestrictableItem,
    state: RestrictionState,
): Restriction | null {
    if (!state.raging) return null;
    const traits = item.traits ?? [];
    if (!traits.includes("concentrate")) return null;
    if (traits.includes("rage")) return null;
    if (item.slug === "seek") return null;   // 规则明文放行
    return {
        state: "gated",
        reason: "Raging: you can't use concentrate actions unless they have the rage trait.",
    };
}

/**
 * 读出角色当前的限制状态。只读，绝不写 actor。
 * ⚠ 单独抽出来是为了**每层只算一次** —— 放进逐条目的判定里，
 *   70 条动作就会把 `getRollOptions` 跑 70 遍。
 */
export function restrictionStateOf(actor: unknown): RestrictionState {
    return { raging: isRaging(actor) };
}
