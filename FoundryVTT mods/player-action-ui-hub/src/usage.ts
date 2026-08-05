/**
 * 动作使用记录 —— 玩家真正点过哪些动作、各点了几次。
 *
 * ★ **为什么需要它**：排序想要的"哪个动作更常用"**不在 pf2e 的数据里**
 *   （系统标了 section/traits/cost/statistic，唯独没标频率）。
 *   与其让我猜一份清单当成现实，不如**记录玩家真实做过的事**
 *   （Nous 2026-08-05：「我怕的就是我们的 ui 不反应现实」）。
 *
 * ★★ **但"跟着频率实时重排"是错的**（Nous 2026-08-05 指出，按 cortex 复盘）：
 *
 *   径向菜单相对列表的**唯一结构性优势就是空间记忆** —— 玩家学会
 *   「Stride 在左上」之后不用看就能甩过去。位置一变这个优势就没了，
 *   轮盘退化成一个圆形的列表，而"不用瞄"正是它存在的理由。
 *
 *   更糟的是它**骗人**：盘面看起来一切正常，肌肉记忆却已失效、毫无提示。
 *   玩家凭记忆甩向老位置，点到的是别的动作 —— 在 PF2e 里那是浪费一个动作，
 *   或者掷出一个收不回的骰子（撤回只退记账，见 economy.ts）。
 *
 * **所以规则是「位置只增不改」**：
 *   - 用满 `PROMOTE_AT` 次才升进常用区（Nous 认可的阈值）；
 *   - 升上来的**插在常用区末尾**，不是首位 —— 已有的位置一个都不动；
 *   - **升上来就永不降级、永不换位**，哪怕后来用得更多／更少。
 *
 *   代价是常用区只增不减、久了会变长。这个代价是**故意选的**：
 *   排序略微过时，远好过位置漂移导致误点。
 *
 * ⚠ **存在模块 setting 里，不碰角色存档。** 这是"这个玩家的使用习惯"，
 *   不是游戏数据。scope 用 `client`：习惯是每个玩家各自的。
 */

const MODULE_ID = "player-action-ui-hub";
const SETTING = "actionUsage";

/**
 * 用满几次才升进常用区。
 * 5 是 Nous 2026-08-05 认可的数字：足够滤掉"顺手点了一次"，
 * 又不至于让真常用的动作迟迟上不来。
 */
export const PROMOTE_AT = 5;

export interface UsageRecord {
    /** slug → 点过几次。只用来判断够不够升，**不参与排序**。 */
    counts: Record<string, number>;
    /**
     * 已升进常用区的 slug，**按升上来的先后排**。
     *
     * ★ 排序直接用这个数组的顺序 —— 它只在末尾追加，所以
     *   **任何已有条目的下标永远不变**，这就是"位置只增不改"的实现。
     */
    promoted: string[];
}

const EMPTY: UsageRecord = { counts: {}, promoted: [] };

/** 注册 setting。必须在 `init` 钩子里调。 */
export function registerUsageSetting(): void {
    game.settings.register(MODULE_ID, SETTING, {
        name: "Action usage history",
        hint: "Which actions you have used. Actions you use often move into the front of the Actions wheel and then stay put.",
        scope: "client",     // 使用习惯是每个玩家各自的
        config: false,       // 不在设置面板里露出，它不是给人手改的
        type: Object,
        default: EMPTY,
    });
}

/** 读当前记录；任何异常都退回空表，排序不该因为存档问题崩掉。 */
export function usage(): UsageRecord {
    try {
        const raw = game.settings.get(MODULE_ID, SETTING) as Partial<UsageRecord> | null;
        return {
            counts: raw?.counts ?? {},
            promoted: Array.isArray(raw?.promoted) ? raw.promoted : [],
        };
    } catch {
        return EMPTY;
    }
}

/**
 * 纯函数：记一次使用，算出新的记录。抽出来才能不依赖 Foundry 做单测。
 *
 * ⚠ **只在跨过阈值的那一刻追加 promoted，且只追加到末尾。**
 *   任何"按次数重排 promoted"的写法都会让位置漂移，正是这里要防的事。
 */
export function withUse(rec: UsageRecord, slug: string): UsageRecord {
    const counts = { ...rec.counts, [slug]: (rec.counts[slug] ?? 0) + 1 };
    const promoted = rec.promoted.includes(slug) || counts[slug] < PROMOTE_AT
        ? rec.promoted
        : [...rec.promoted, slug];      // ★ 末尾追加，已有下标不动
    return { counts, promoted };
}

/**
 * 记一次使用并落盘。
 *
 * ⚠ 写 setting 是异步的，这里**不 await** —— 玩家点完动作盘就关了，没人在等它；
 *   失败也只是少记一次，不该打断动作执行。
 */
export function bump(slug: string): void {
    try {
        void game.settings.set(MODULE_ID, SETTING, withUse(usage(), slug));
    } catch (err) {
        console.error(`${MODULE_ID} | 记录动作使用失败`, err);
    }
}

/**
 * slug → 它在常用区里排第几；不在常用区返回 `Infinity`。
 * 给 `rankActions` 当**首要**排序依据。
 */
export function promotedRank(rec: UsageRecord): (slug: string) => number {
    const order = new Map(rec.promoted.map((s, i) => [s, i]));
    return (slug: string) => order.get(slug) ?? Number.POSITIVE_INFINITY;
}
