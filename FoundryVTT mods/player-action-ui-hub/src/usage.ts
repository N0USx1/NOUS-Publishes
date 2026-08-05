/**
 * 动作使用记录 —— 玩家真正点过哪些动作、各点了几次。
 *
 * ★ **为什么需要它**：排序想要的"哪个动作更常用"**不在 pf2e 的数据里**
 *   （系统标了 section/traits/cost/statistic，唯独没标频率）。
 *   与其让我猜一份清单当成现实，不如**记录玩家真实做过的事**——
 *   那才是唯一不会骗人的排序依据（Nous 2026-08-05：「我怕的就是我们的 ui 不反应现实」）。
 *
 * ⚠ **存在模块 setting 里，不碰角色存档。**
 *   这是"这个玩家的使用习惯"，不是游戏数据；写进 actor 就是改了别人的存档
 *   （同 economy.ts 的立场）。scope 用 `client`：习惯是**每个玩家各自**的，
 *   同一个世界里换个人不该继承别人的顺序。
 */

const MODULE_ID = "player-action-ui-hub";
const SETTING = "actionUsage";

/** slug → 用过几次 */
export type UsageMap = Record<string, number>;

/**
 * 记录上限。
 * 超过就整体减半（见 `bump`），避免早期高频动作**永久霸占**前排 ——
 * 玩家换了打法，排序要跟得上，不能被三个月前的习惯锁死。
 */
const DECAY_AT = 200;

/** 注册 setting。必须在 `init` 钩子里调。 */
export function registerUsageSetting(): void {
    game.settings.register(MODULE_ID, SETTING, {
        name: "Action usage history",
        hint: "Which actions you have used, and how often. Drives the ordering of the Actions wheel.",
        scope: "client",     // 使用习惯是每个玩家各自的
        config: false,       // 不在设置面板里露出，它不是给人手改的
        type: Object,
        default: {},
    });
}

/** 读当前记录；读不到就当空表，绝不抛错（排序不该因为存档问题崩掉）。 */
export function usage(): UsageMap {
    try {
        return (game.settings.get(MODULE_ID, SETTING) as UsageMap) ?? {};
    } catch {
        return {};
    }
}

/**
 * 记一次使用。
 *
 * ⚠ 写 setting 是异步的，这里**不 await** —— 排序用的是内存里的下一次读取，
 *   而玩家点完动作盘就关了，没人在等这个写完。失败也只是少记一次，不该打断执行。
 */
export function bump(slug: string): void {
    try {
        const cur = usage();
        const next: UsageMap = { ...cur, [slug]: (cur[slug] ?? 0) + 1 };

        const total = Object.values(next).reduce((a, b) => a + b, 0);
        if (total > DECAY_AT) {
            // 整体减半：保住相对次序，同时给新习惯留出反超的空间。
            // 减到 0 的直接删掉，免得表无限长。
            for (const k of Object.keys(next)) {
                const halved = Math.floor(next[k] / 2);
                if (halved > 0) next[k] = halved;
                else delete next[k];
            }
        }
        void game.settings.set(MODULE_ID, SETTING, next);
    } catch (err) {
        console.error(`${MODULE_ID} | 记录动作使用失败`, err);
    }
}

/** 取某个动作用过几次。给 `rankActions` 当排序依据。 */
export function countOf(map: UsageMap): (slug: string) => number {
    return (slug: string) => map[slug] ?? 0;
}
