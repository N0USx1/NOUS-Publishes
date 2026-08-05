import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { usage, promotedRank } from "../usage";
import { isSkillAction } from "./skills";
import { ACTION_ICONS, iconFor } from "../icons";

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
    /**
     * pf2e 自己的分类。实测取值与条数：
     * `basic`(15) / `specialty-basic`(9) / `skill`(42) / undefined(4)。
     *
     * ★ **这才是该用的分档依据**（2026-08-05 Nous 指出后改）。
     */
    section?: string;
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
 * 冷启动的高频动作顺序 —— **这是人为判断，不是游戏数据**。
 *
 * ★ 必须先承认这一点：**"哪个动作更常用"不在 pf2e 的数据里**。
 *   系统标了 section、traits、cost、statistic，唯独没标频率。
 *   所以这份清单是按 PF2e 实战经验列的，**会随职业与玩法而不准**。
 *
 * ⚠ 它的作用**仅限冷启动**：玩家一旦真正用过某个动作，
 *   使用记录就会压过这份清单（见 `rankActions`）。
 *   换句话说，它只负责"第一次打开时不难用"，不负责"一直是对的"——
 *   长期正确性交给玩家自己的行为，那才是真实数据。
 *   （Nous 2026-08-05 拍板"两者合起来"。）
 */
const COLD_START_ORDER = [
    "stride", "step", "seek", "take-cover", "aid", "demoralize", "trip",
    "grapple", "shove", "escape", "hide", "feint", "tumble-through", "ready",
    "delay", "stand", "drop-prone", "recall-knowledge", "point-out", "interact",
];

/**
 * 排序档位，数字越小越靠前。
 *
 * ★ **判据是 `section` 不是 `attack` 特性**（2026-08-05 Nous 指出后改）。
 *   原来拿 `attack` 当"战斗动作"，但那个特性的真实语义是
 *   **"会吃多重攻击减值"**，和"战斗里常不常用"根本是两回事。实测后果：
 *     - `force-open`（破门，探索向）**带** attack → 被顶到第 1 页；
 *     - `take-cover` 的 traits 是**空数组** → 靠特性永远筛不到它；
 *     - `demoralize` / `seek` / `feint` 都不带 attack → 全被压到后面。
 *   这就是"UI 不反映现实"的样子：拿一个自以为等价的代理指标替换了真实语义。
 *
 * ★ **只排序不过滤（downtime 除外）**，理由同样是实测出来的：
 *   "这个动作是否必须训练"不在数据里，而 PF2e 里绊摔/擒抱/推撞未训练本来就合法
 *   （实测角色运动 rank 恰好是 0）。硬过滤会把最该显示的几个删掉。
 */
function tierOf(a: RawAction, rankOf: (slug: string) => number): number {
    // exploration 是规则明说的"探索模式活动"，遭遇战里用不上 → 排最后
    if (a.traits.includes("exploration")) return 4;
    if (a.section === "basic") return 0;              // pf2e 自己标的基础动作
    if (a.section === "specialty-basic") return 1;    // 情境性基础动作
    const stats = statisticList(a.statistic).filter(Boolean);
    if (stats.length === 0) return 1;
    // 多检定动作取最高的那个：任一训练过就算训练过（如 escape 可用运动或杂技）
    return Math.max(...stats.map(rankOf)) >= 1 ? 2 : 3;
}

/**
 * 过滤 + 排序。
 *
 * 排序优先级（从强到弱）：
 *   1. **常用区**（已升上来的）按它升上来的先后 —— 见下面那条铁律；
 *   2. 冷启动清单里的次序；
 *   3. `tierOf` 的分档；
 *   4. slug 字母序兜底 —— 否则同档内顺序随集合迭代而变，
 *      玩家每次打开看到的位置都不一样。
 *
 * ★★ **位置只增不改**（Nous 2026-08-05 指出后重做）。
 *   前一版是"用过的立刻跨档顶到最前、按次数排"，那会让**每点一次动作、
 *   下次打开顺序就变**。径向菜单相对列表的唯一结构性优势就是空间记忆，
 *   位置一漂移这个优势就没了，而且它**不报错**：盘面看着正常，
 *   玩家甩向老位置点到的却是别的动作。
 *   所以排序依据是 `promotedRank`（升入先后，末尾追加、永不换位），
 *   **不是使用次数**。次数只用来判断够不够升。
 *
 * @param rankOf   技能 slug → 熟练度等级（0 = 未训练）。实测字段是 `statistic.rank`。
 * @param frontOf  动作 slug → 它在常用区排第几（不在则 `Infinity`）。默认全不在。
 */
export function rankActions(
    list: RawAction[],
    rankOf: (slug: string) => number,
    frontOf: (slug: string) => number = () => Number.POSITIVE_INFINITY,
): RawAction[] {
    return list
        // ⚠ downtime 是唯一被删的，**升上来了也不收**：它按规则就不是遭遇战动作
        //   （实测 70 条里 3 条：create-forgery / subsist / treat-disease）
        .filter(a => !a.traits.includes("downtime"))
        .map(a => {
            const cold = COLD_START_ORDER.indexOf(a.slug);
            return {
                a,
                front: frontOf(a.slug),
                cold: cold < 0 ? Number.MAX_SAFE_INTEGER : cold,
                tier: tierOf(a, rankOf),
            };
        })
        .sort((x, y) =>
            x.front - y.front
            || x.cold - y.cold
            || x.tier - y.tier
            || x.a.slug.localeCompare(y.a.slug))
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
        // ★ 技能动作已分到 Skills 那一格去了（Nous 2026-08-05）：
        //   67 条挤成 10 页，而"撬锁"这种玩家心里想的是"掷巧手"，
        //   跟"翻滚穿过"这类战术动作放一起找不着。判据见 skills.ts 的 isSkillAction。
        const raw: RawAction[] = [...coll.values()].filter(a => !isSkillAction(a));
        const rankOf = (slug: string): number =>
            (actor?.getStatistic?.(slug) as { rank?: number } | null)?.rank ?? 0;
        // 玩家自己的常用区 —— 压过冷启动清单与分档，但**位置只增不改**
        const front = promotedRank(usage());

        return rankActions(raw, rankOf, front).map((a): SectorData => ({
            id: `action:${a.slug}`,
            // ⚠ 必须 localize，理由见 RawAction.name 的注释
            label: game.i18n.localize(a.name),
            // ⚠ 实测 25 条基础动作里 20 条用的是 pf2e 的**通用消耗图标**
            //   （OneAction.webp 之流）—— 一圈全长一样等于没有图标，要换掉
            img: iconFor(a.img, ACTION_ICONS[a.slug]),
            cost: costToSectorCost(a.cost),
            state: "normal",
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectActions 失败", err);
        return [];
    }
}
