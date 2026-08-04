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

function ledgerFor(actorId: string, round: number): Ledger {
    const cur = ledgers.get(actorId);
    if (!cur || cur.round !== round) {
        const fresh: Ledger = { spent: 0, round, history: [] };
        ledgers.set(actorId, fresh);
        return fresh;
    }
    return cur;
}

/** 本回合还剩几个动作。可能为负（玩家超支了，我们照实显示不拦）。 */
export function remaining(actorId: string, round: number): number {
    return ACTIONS_PER_TURN - ledgerFor(actorId, round).spent;
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

/** 回合开始：清零。 */
export function resetTurn(actorId: string, round: number): void {
    ledgers.set(actorId, { spent: 0, round, history: [] });
}

/** 全部清空（关世界/换场景时用）。 */
export function clearAll(): void {
    ledgers.clear();
}

/**
 * 画成记号串：满的用 ◆，用掉的用 ◇，超支的用 ✕。
 * 例：剩 2 → "◆◆◇"；超支 1 → "◇◇◇✕"。
 */
export function glyphs(remainingCount: number): string {
    if (remainingCount >= 0) {
        const left = Math.min(remainingCount, ACTIONS_PER_TURN);
        return "◆".repeat(left) + "◇".repeat(ACTIONS_PER_TURN - left);
    }
    return "◇".repeat(ACTIONS_PER_TURN) + "✕".repeat(Math.min(-remainingCount, 3));
}
