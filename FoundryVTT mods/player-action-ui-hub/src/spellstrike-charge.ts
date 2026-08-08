import type { SectorData } from "./types";

/**
 * **Spellstrike 的充能** —— 全模组唯一一本"系统压根没记"的账。
 *
 * ★ 立项理由（Nous 2026-08-07）：
 *   > "这个部分要硬说是 fvtt 他开发者的失职，但是我们可以自己记账，
 *   >  recharge spellstrike，就像是那个 focus pool 一样，做一个 ui 形式的
 *   >  （只在 magus class 才会出现的）。"
 *
 * ★★ **先说清楚它为什么是例外**。本模组的立场是"不做规则，照规则做行为"，
 *   而这一条确实是在记一个规则状态。它能立，是因为三件事同时成立：
 *
 *   | 判据 | 这里 |
 *   |---|---|
 *   | 系统记了吗 | **完全没有**：action 的 `system.frequency` 是 null，纲要里也没有 Recharge 条目（2026-08-07 实测） |
 *   | 要不要我们判"能不能" | **不要**：用了就是用了，没有任何条件判断 |
 *   | 会不会编一个假来源 | **不会**：那句话只说"用掉了、去充能"，不冒充任何人的断言 |
 *
 *   ⚠ 第三条原来写的是"必须自报家门"，2026-08-07 被 Nous 否掉（那半句已删）。
 *     ★ 分界在这里：上一轮的病是**编了一个不成立的出处**（"卡上说的"，而卡没说过），
 *       不是"没写出处"。**不许编来源**照旧；**必须报出处**不成立 ——
 *       玩家要知道的是能不能点，不是我们的实现细节。
 *
 * ⚠ **只记"用没用过"，不记"怎么恢复"**。规则里还有一句
 *   "施放至少 1 动作的合流（conflux）法术也能充能" —— 那是**规则判断**，不做。
 *   玩家自己点那颗充能键就好；少判一条，就少一条会算错的地方。
 *
 * ★ 存在 actor 的 flag 上而不是内存里：焦点池是持久的，这本账要"像焦点池一样"，
 *   就得跟着一起持久 —— 刷新一下就没了的账，玩家不会信它。
 */

export const MODULE_ID = "player-action-ui-hub";
export const SPENT_FLAG = "spellstrikeSpent";
export const RECHARGE_ID = "recharge-spellstrike";

/**
 * 这个角色**有没有** Spellstrike。
 *
 * ★ "只在 magus 才出现"是**推出来的不是写死的**：判据是身上有没有这条能力，
 *   不是 `class.slug === "magus"`。多职业档、专长档拿到 Spellstrike 一样算 ——
 *   而按职业名写死会把他们漏掉，且不报错。
 */
export function spellstrikeItemOf(actor: unknown): { id: string; uuid?: string } | null {
    const items: any[] = (actor as any)?.items?.contents ?? [];
    const hit = items.find(i => i?.slug === "spellstrike" && i?.type === "action");
    return hit ? { id: hit.id, uuid: hit.uuid } : null;
}

/** 用掉了没有。⚠ 没有 Spellstrike 的角色一律 false（不是"没用过"，是"没有这回事"）。 */
export function isSpent(actor: unknown): boolean {
    if (!spellstrikeItemOf(actor)) return false;
    return (actor as any)?.getFlag?.(MODULE_ID, SPENT_FLAG) === true;
}

/** 记一笔用掉。 */
export async function markSpent(actor: unknown): Promise<void> {
    if (!spellstrikeItemOf(actor)) return;
    try { await (actor as any).setFlag?.(MODULE_ID, SPENT_FLAG, true); }
    catch (err) { console.error("player-action-ui-hub | 记 Spellstrike 用掉失败", err); }
}

/** 充能：把账清掉。 */
export async function recharge(actor: unknown): Promise<void> {
    try { await (actor as any).setFlag?.(MODULE_ID, SPENT_FLAG, false); }
    catch (err) { console.error("player-action-ui-hub | Spellstrike 充能失败", err); }
}

/**
 * 用掉之后给 Spellstrike 那一格加的**灰显 + 理由**；没用掉返回 null。
 *
 * ⚠ 仍然**可点**（三态守则）：规则的例外太多，误拦比不拦更伤。
 */
export function spentNote(actor: unknown): { state: SectorData["state"]; reason: string } | null {
    if (!isSpent(actor)) return null;
    return {
        state: "gated",
        /*
         * ⚠ 这句话**只说事实，不说来源**（Nous 2026-08-07 拍板去掉那半句
         *   "Tracked by this module — pf2e records nothing here."）。
         *
         * ★ 与上一轮那个错误的分界要说清楚，别下次又把它加回来：
         *   上一轮的病是**编了一个假来源**（"卡上说这条不可用"，而卡从来没说过）。
         *   病根是"说了一个不成立的出处"，不是"没说出处"。
         *   ⇒ **不许编来源**仍然成立；**必须报出处**不成立 ——
         *     玩家要的是"我现在能不能点"，不是我们的实现细节。
         */
        reason: "Used. Recharge it (◆) before the next one.",
    };
}

/**
 * 充能那一格；不需要充能（没用过 / 没有 Spellstrike）返回 null。
 *
 * @param img Spellstrike 自己的图标，让两格看得出是一对
 */
export function rechargeSector(actor: unknown, img?: string): SectorData | null {
    if (!isSpent(actor)) return null;
    return {
        id: RECHARGE_ID,
        label: "Recharge",
        img,
        // 规则原文："recharge your Spellstrike as a single action, which has the concentrate trait"
        cost: "1",
        state: "normal",
        detail: "Single action, concentrate. Makes Spellstrike available again.",
    };
}
