/**
 * G9 · **当前 MAP**（多重攻击减值）—— 2026-08-07。
 *
 * ★★ **这一条不是"我们代记"，是"我们观测"**（实测推翻了原计划）。
 *   职业清单把 MAP 列进甲类，理由是"系统不存" —— 那句话只对了一半：
 *   pf2e 的 `calculateMAPs()` 确实不记"这回合打了几次"，
 *   **但每一条攻击掷骰的聊天消息都写着它是在第几档打的**：
 *
 *   | 字段 | 实测值 |
 *   |---|---|
 *   | `message.flags.pf2e.context.type` | `"attack-roll"` |
 *   | `message.flags.pf2e.context.mapIncreases` | `0` / `1` / `2` |
 *   | `message.flags.pf2e.context.actor` | 掷骰者的 actor id |
 *   | `context.options` 里 | `"map:increases:0"` |
 *
 *   实测该世界 51 条攻击消息，**每一条都有 `mapIncreases`**。
 *
 * ★ **观测 > 代记**，理由不是优雅是正确：
 *   代记只能记住**从轮盘打出去**的那些。玩家从角色卡上点一下打击，
 *   我们的账就少一次 —— 于是轮盘显示的 MAP **是个看起来正确的错数**，
 *   比不显示更糟。观测聊天栏则不管他从哪打的。
 *
 * ⚠ **我们不算减值是多少**。三档的文字（`"+9 (MAP -4)"`）由 pf2e 自己给，
 *   敏捷武器的 -4/-8 也在里面。我们只做一件事：**数他这回合打了几次**，
 *   据此把翻选条**预选到对的那一档**。判减值是规则，数次数是观测。
 *
 * ⚠ **只预选，不锁死**：翻选条照旧能翻。有一堆"这次不计入 MAP"的规则特例，
 *   我们不打算认识它们 —— 预选错了玩家翻一下就好，锁死就没救了。
 */

/** 一条攻击掷骰里我们要的那点东西。 */
export interface AttackObservation {
    actorId: string;
    /** 这一击是在第几档打的：0 / 1 / 2 */
    mapIncreases: number;
}

/**
 * 从一条聊天消息里读出攻击观测；不是攻击掷骰返回 null。
 *
 * ⚠ 判据是 `context.type === "attack-roll"`，**不是"消息里有骰子"** ——
 *   伤害掷骰、技能检定、豁免都带骰子，数进去会让 MAP 跳得莫名其妙。
 *
 * ⚠ **重掷不能算成新的一击**：`context.isReroll` 为真时同一击会再发一条消息，
 *   数进去等于凭空多一档减值。
 */
export function readAttack(message: unknown): AttackObservation | null {
    const ctx = (message as any)?.flags?.pf2e?.context;
    if (!ctx || ctx.type !== "attack-roll") return null;
    if (ctx.isReroll) return null;
    const actorId = ctx.actor ?? (message as any)?.speaker?.actor;
    if (!actorId) return null;
    const n = Number(ctx.mapIncreases);
    return { actorId: String(actorId), mapIncreases: Number.isFinite(n) ? n : 0 };
}

/** MAP 一共三档：第 0/1/2 击。第四击起仍按第三档。 */
export const MAP_TIERS = 3;

/**
 * 打了 `count` 次之后，下一击该用第几档。
 *
 * ⚠ 上限是 `MAP_TIERS - 1` 而不是无穷：pf2e 的变体只有三个，
 *   下标越界会让翻选条读到 undefined，而那**不报错**，只是文字空掉。
 */
export function nextMapIndex(count: number): number {
    return Math.min(Math.max(0, Math.floor(count)), MAP_TIERS - 1);
}

/**
 * 毂里那句话：这回合已经打了几次、下一击在哪一档。
 *
 * ★ 档位文字**原样取自 pf2e**（`strike.variants[i].label`），不自己拼 ——
 *   findings-v0.1 §2 实测那串 label 本身就自带 MAP 文案，
 *   再拼一遍会把 MAP 显示两次；敏捷武器的 -4/-8 也只有它知道。
 */
export function mapNote(variantLabels: string[] | undefined, count: number): string | null {
    if (count <= 0) return null;
    const idx = nextMapIndex(count);
    const 档 = variantLabels?.[idx];
    return 档 ? `Attacked ${count}× ✦ next ${档}` : `Attacked ${count}×`;
}
