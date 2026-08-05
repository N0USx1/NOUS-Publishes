import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";

/**
 * `game.pf2e.actions` 里一条动作的形状。
 *
 * ★ 字段名与类型全部出自 2026-08-05 游戏内实测
 *   （`docs/findings-v0.3-v0.5-data-shapes.md`），不是照抄设计定档的假设。
 *   实测样本 `tumble-through` 的键：
 *   `cost / description / img / name / sampleTasks / section / slug /
 *    traits / difficultyClass / modifiers / notes / rollOptions / statistic`
 */
export interface RawAction {
    slug: string;
    /**
     * ⚠ **本地化 key**，例 `"PF2E.Actions.TumbleThrough.Title"`，不是能直接显示的文字。
     * 别处（actor 上的 item）的 `name` 是成品文字，**只有这个集合不是** ——
     * 漏了 localize 就会在扇区上印出一串 `PF2E.Actions.…`，而且**不报错**。
     */
    name: string;
    /** ⚠ 实测取值 `1 | 2 | null | "reaction" | "free"` —— 数字与字符串并存 */
    cost: number | string | null;
    traits: string[];
    img?: string;
    /** ⚠ 实测有时是数组：`identify-magic → ["arcana","nature","occultism","religion"]` */
    statistic?: string | string[] | null;
}

/**
 * pf2e 的消耗值 → 我们的 `SectorData.cost`。
 *
 * ⚠ 实测 `cost` 是 `number`（`1`）而不是字符串，直接塞进 SectorData 的字符串联合
 *   类型对不上。认不出来的值一律当"不显示消耗记号"，**不硬塞** ——
 *   画错一个 ◆ 比不画更糟。
 */
export function costToSectorCost(cost: number | string | null): SectorData["cost"] {
    if (cost === 1 || cost === "1") return "1";
    if (cost === 2 || cost === "2") return "2";
    if (cost === 3 || cost === "3") return "3";
    if (cost === "reaction" || cost === "free") return cost;
    return null;
}

/** `statistic` 归一成数组。⚠ 实测它可能是 string、string[]，也可能没有。 */
export function statisticList(statistic: string | string[] | null | undefined): string[] {
    if (!statistic) return [];
    return Array.isArray(statistic) ? statistic : [statistic];
}

/**
 * 排序档位，数字越小越靠前 —— **第 1 页装的就是战斗里真会用的那几个**。
 *
 * ★ **只排序不过滤（downtime 除外）**，理由是实测出来的两条：
 *
 *   1. **"这个动作是否必须训练"不在数据里** —— 实测 10 个动作（含 `disable-device`）
 *      的描述文本里都搜不到 trained 要求。按训练与否硬过滤 = 我照着规则书硬编码。
 *   2. **PF2e 里绊摔/擒抱/推撞未训练本来就合法**，而实测角色的运动 rank 恰好是 0。
 *      硬过滤会把这三个全删掉 —— 那是替规则做了一个错误决定。
 *
 *   所以未训练的动作**排后面但仍在盘上**。玩家点得到，只是不在第一屏。
 */
function tierOf(a: RawAction, rankOf: (slug: string) => number): number {
    // attack 优先级最高：两个特性都有时也算战斗动作，别被 exploration 抢走
    if (a.traits.includes("attack")) return 0;
    if (a.traits.includes("exploration")) return 4;
    const stats = statisticList(a.statistic);
    if (stats.length === 0) return 1;      // 移动/延迟/掩护等通用动作，无技能门槛
    // 多检定动作取最高的那个：任一训练过就算训练过（如 escape 可用运动或杂技）
    return Math.max(...stats.map(rankOf)) >= 1 ? 2 : 3;
}

/**
 * 过滤 + 排序。
 * @param rankOf 技能 slug → 熟练度等级（0 = 未训练）。实测字段是 `statistic.rank`。
 */
export function rankActions(list: RawAction[], rankOf: (slug: string) => number): RawAction[] {
    return list
        // downtime 是唯一被删的：它按规则就不是遭遇战动作（实测 70 条里占 3 条）
        .filter(a => !a.traits.includes("downtime"))
        .map(a => ({ a, tier: tierOf(a, rankOf) }))
        // slug 兜底排序：否则同档内顺序随集合迭代而变，玩家每次打开位置都不一样
        .sort((x, y) => x.tier - y.tier || x.a.slug.localeCompare(y.a.slug))
        .map(x => x.a);
}

/**
 * 采集通用与技能动作。只读，绝不写 actor。
 *
 * ⚠ 这一层碰 Foundry 全局（`game.pf2e.actions` / `game.i18n`），**不进单测**；
 *   可判定的逻辑全都抽到了上面三个纯函数里，测试打在那儿。
 */
export function collectActions(actor: ActorPF2e | null): SectorData[] {
    try {
        // ⚠ 局部豁免：类型包（foundry-pf2e v13 分支）对 v14 的 `game.pf2e` 覆盖不全，
        //   `actions` 这个集合没有声明。**只在这一处**，不许扩散。
        const coll = (game as any).pf2e?.actions;
        if (!coll) return [];
        const raw: RawAction[] = [...coll.values()];
        const rankOf = (slug: string): number =>
            (actor?.getStatistic?.(slug) as { rank?: number } | null)?.rank ?? 0;

        return rankActions(raw, rankOf).map((a): SectorData => ({
            id: `action:${a.slug}`,
            // ⚠ 必须 localize，理由见 RawAction.name 的注释
            label: game.i18n.localize(a.name),
            img: a.img,
            cost: costToSectorCost(a.cost),
            state: "normal",
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectActions 失败", err);
        return [];
    }
}
