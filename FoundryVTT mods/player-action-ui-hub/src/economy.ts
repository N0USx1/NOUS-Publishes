/**
 * 动作经济记账（3 动作制）。
 *
 * ★ **系统完全不建模这件事**，必须我们自己记（2026-08-04 源码调研实证）：
 *   pf2e 里 `calculateMAPs()` 只返回两个数值做成三个变体让玩家自选，
 *   **不记录"这回合打了几次"**；`combatant.flags.pf2e` 里也没有任何动作额度字段。
 *   见 `docs/2026-08-04-pf2e-system-api-reference.md` §8 判决表。
 *
 * ⚠ **只记不拦**（设计定档 §2）：这里算出来的余额纯粹用于显示，
 *   永远不阻止玩家执行任何动作。PF2e 的特例太多（加速术、状态改动作数、GM 裁定），
 *   误拦比不拦更伤体验。
 *
 * ⚠ **存在内存里，不落盘**：这是我们自己的账，不是游戏数据 ——
 *   往 actor/combatant 上写 flag 就等于改了别人的存档。代价是刷新页面会清零，
 *   下一回合开始时反正也要重置，可以接受。
 */

/**
 * 一个回合的基准动作数。PF2e 是 3 动作制。
 *
 * ⚠ **这是占位值，不是定论**（Nous 2026-08-05）：加速术给第 4 个、缓慢扣掉若干、
 *   震慑直接吃掉开头几个 —— 这些都属于**③段参数化反馈**的射程，那一段建好之后
 *   本值应改为**按角色当前状态算出来**（谓词求值 + 状态读取，见系统 API 参考）。
 *   在那之前我们处于"半开放"：架构先摆好，数值先按基准走，且**只显示不阻止** ——
 *   拦一个我们还算不准的数，比不拦更糟。
 */
export const ACTIONS_PER_TURN = 3;

/**
 * 一轮的反应额度。PF2e 是每轮 1 个。
 *
 * ⚠ 与 `ACTIONS_PER_TURN` 一样是**占位值**：有职业/效果给额外反应。
 *   同属③段参数化反馈的射程，在那之前**只显示不阻止**。
 */
export const REACTIONS_PER_TURN = 1;

interface Ledger {
    /** 本回合已花掉多少 */
    spent: number;
    /** 记的是第几轮，用来判断跨轮要不要清零 */
    round: number;
    /**
     * 每笔花费的明细，用于「撤回上一步」。
     * 只记点数不记做了什么 —— **撤回退的是动作点记账，不是把骰子收回来**
     * （骰子已经进聊天栏，谁也收不回；设计定档的诚实条款）。
     */
    history: number[];
    /**
     * 本回合用掉几个反应。
     *
     * ★ **与 `spent` 是两个独立的池**：反应**不占**常规动作
     *   （`costToPoints("reaction")` 返回 0，那是规则事实）。
     *   混在一起记会让玩家以为用了反击就少一个动作 —— 那是把规则简化**错**了。
     */
    reactions: number;
    /**
     * 本回合**观测到**的攻击掷骰次数（G9）。
     *
     * ★ 与上面几项不同，这个数**不是我们记的账，是我们数的消息** ——
     *   每条攻击掷骰的聊天消息都带 `context.mapIncreases`，
     *   玩家从角色卡上打的也算得到。见 `attacks.ts` 顶部。
     *   记账只记得住从轮盘打出去的那些，那会给出一个**看起来正确的错数**。
     */
    attacks: number;
}

const ledgers = new Map<string, Ledger>();

/** 动作消耗字符串 → 实际点数。反应与自由动作不占常规动作。 */
export function costToPoints(cost: string | null): number {
    switch (cost) {
        case "1": return 1;
        case "2": return 2;
        case "3": return 3;
        default: return 0;   // reaction / free / null
    }
}

/**
 * 取这个角色的账本。
 *
 * ★★ **不再"换一轮就自动清"**（2026-08-07 实测抓到）：
 *   规则是"**你自己的回合开始时**重置"，而 `round` 变的那一刻**通常不是你的回合**。
 *   实测：我在自己回合记了 2 次攻击，轮到下一个人（round 从 1 变 2）时，
 *   我的账**当场被清成 0** —— 而我的回合还没开始。
 *   后果是 MAP 偏一档，且**不报错**，只是数字不对。
 *
 * ★ 现在唯一的清零点是 `resetTurn()`，由 `pf2e.startTurn` 钩子调
 *   （实测签名 `(combatant, encounter, userId)`）。这也正好对上规则：
 *   在别人回合用反应打出去的那一击**应该**算进 MAP，一直算到你下个回合开始。
 *
 * ⚠ `round` 仍然记着，只是**不再拿它当清零判据** —— 它是给显示与排错用的。
 */
function ledgerFor(actorId: string, round: number): Ledger {
    const cur = ledgers.get(actorId);
    if (!cur) {
        const fresh: Ledger = { spent: 0, round, history: [], reactions: 0, attacks: 0 };
        ledgers.set(actorId, fresh);
        return fresh;
    }
    cur.round = round;
    return cur;
}

/**
 * 本回合**一共**有几个动作 —— 按角色当前状态算，不再是写死的 3。
 *
 * ★ 2026-08-05 alpha 反馈推动：
 *   "If you are keeping track of actions left in the UI, maybe keep in mind
 *    slowed/stunned/hasted conditions?"
 *   本模组的根理就是"数据已经知道答案了" —— 缓慢/震慑/迅捷全在 actor 的条件里，
 *   显示一个跟状态无关的 3，比不显示更糟：它是**一个看起来正确的错数**。
 *
 * ★★ **压制关系不用我们算**（实测）：同时挂 slowed 1 + stunned 2 之后，
 *   `actor.conditions.active` 里**只剩 stunned**（它带 `overrides: ["slowed"]`）。
 *   pf2e 已经把"震慑压制缓慢"这条规则解析完了 —— 我们照读它解析后的结果即可。
 *   自己写 `max(slowed, stunned)` 等于把规则抄一份进来，抄的那份迟早和它分叉。
 *
 * ⚠ 下限是 0，不是负数：条件再重也只是"这回合没得动"。
 */
export interface TurnConditions {
    /** `actor.conditions.active` 里生效的减动作条件与其层数 */
    lost?: number;
    /** 迅捷：+1 动作 */
    quickened?: boolean;
}

export function actionsThisTurn(cond: TurnConditions = {}): number {
    const 基准 = ACTIONS_PER_TURN + (cond.quickened ? 1 : 0);
    return Math.max(0, 基准 - Math.max(0, cond.lost ?? 0));
}

/**
 * 本回合还剩几个动作。可能为负（玩家超支了，我们照实显示不拦）。
 *
 * @param cond 当前状态；不传就按无状态的基准算（旧调用点行为不变）
 */
export function remaining(actorId: string, round: number, cond: TurnConditions = {}): number {
    return actionsThisTurn(cond) - ledgerFor(actorId, round).spent;
}

/** 花掉 n 个动作。n 为 0 时什么都不做（反应/自由动作）。 */
export function spend(actorId: string, round: number, n: number): void {
    if (n <= 0) return;
    const l = ledgerFor(actorId, round);
    l.spent += n;
    l.history.push(n);
}

/**
 * 撤回上一笔花费，返回退了几点（没有可撤的返回 0）。
 * ⚠ 退的只是**动作点记账**——已经掷出去的骰子留在聊天栏，收不回来。
 */
export function undoLast(actorId: string, round: number): number {
    const l = ledgerFor(actorId, round);
    const last = l.history.pop();
    if (last === undefined) return 0;
    l.spent = Math.max(0, l.spent - last);
    return last;
}

/** 有没有可撤回的花费 —— 用来决定撤回按钮是否可点。 */
export function canUndo(actorId: string, round: number): boolean {
    return ledgerFor(actorId, round).history.length > 0;
}

/** 退还 n 个动作（撤销用）。不会退到负花费以下。 */
export function refund(actorId: string, round: number, n: number): void {
    if (n <= 0) return;
    const l = ledgerFor(actorId, round);
    l.spent = Math.max(0, l.spent - n);
}

/**
 * 本回合还剩几个反应。
 * ★ 与动作是**两个独立的池**：用了反击不该让动作点少一个。
 */
export function reactionsLeft(actorId: string, round: number): number {
    return REACTIONS_PER_TURN - ledgerFor(actorId, round).reactions;
}

/** 用掉一个反应。同样**只记不拦**，可以记成负余额。 */
export function spendReaction(actorId: string, round: number): void {
    ledgerFor(actorId, round).reactions += 1;
}

/**
 * 记下一次攻击掷骰（G9）。
 *
 * ⚠ 调用点在 `createChatMessage` 钩子里，**不在我们掷骰那一处** ——
 *   挂在掷骰处就只数得到从轮盘打的，玩家从角色卡点一下就漏。
 */
export function noteAttack(actorId: string, round: number, n = 1): void {
    ledgerFor(actorId, round).attacks += n;
}

/** 本回合观测到打了几次。 */
export function attacksThisTurn(actorId: string, round: number): number {
    return ledgerFor(actorId, round).attacks;
}

/** 回合开始：清零。 */
export function resetTurn(actorId: string, round: number): void {
    ledgers.set(actorId, { spent: 0, round, history: [], reactions: 0, attacks: 0 });
}

/** 全部清空（关世界/换场景时用）。 */
export function clearAll(): void {
    ledgers.clear();
}

/**
 * 画成记号串：满的用 ◆，用掉的用 ◇，超支的用 ✕。
 * 例：剩 2 → "◆◆◇"；超支 1 → "◇◇◇✕"。
 *
 * ★ **格子数跟着本回合的实际动作数走**，不是写死的 3（2026-08-05 alpha 反馈）：
 *   迅捷时画 4 格、缓慢 1 时画 2 格。
 *   画三个格子却告诉玩家"你只有 2 个动作"，等于把状态藏在数字里 ——
 *   而这个模组存在的理由就是让状态**看得见**。
 *
 * @param total 本回合一共几个动作；不传按基准 3（旧调用点行为不变）
 */
export function glyphs(remainingCount: number, total: number = ACTIONS_PER_TURN): string {
    const 格 = Math.max(0, total);
    if (remainingCount >= 0) {
        const left = Math.min(remainingCount, 格);
        return "◆".repeat(left) + "◇".repeat(格 - left);
    }
    return "◇".repeat(格) + "✕".repeat(Math.min(-remainingCount, 3));
}

/**
 * 反应记号：还有反应用实心 ⟳，用掉了用空心 ⟲。
 *
 * ★ 用**另一个字形**而不是第四个 ◆（Nous 2026-08-05 定"用记号区分"）：
 *   反应不占动作，画成第四个菱形会让人以为这回合有四个动作 ——
 *   那正是把规则简化**错**了的样子。
 */
export function reactionGlyph(left: number): string {
    return left > 0 ? "⟳" : "⟲";
}
