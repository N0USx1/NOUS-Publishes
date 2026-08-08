import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { ACTION_ICONS, iconFor } from "../icons";
import { detailLine } from "../triggers";
import { restrictionFor, restrictionStateOf } from "../restrictions";
import { sheetActionsOf } from "../sheet-actions";
import { sheetSector } from "./sheet-sectors";
import { actionUuid } from "../action-uuids";

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
     * ⚠ **也是本地化 key**（与 `name` 同）：实测 `trip.description === "PF2E.Actions.Trip.Description"`。
     * 直接当文字用会印出一串 key，而且不报错 —— 同一个坑，第二个字段。
     */
    description?: string;
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

/*
 * ⛔ **这里原来有一整套排序机器**（`COLD_START_ORDER` / `tierOf` / `rankActions`），
 *   2026-08-07 连同它的单测一起删掉。
 *
 *   它排的是注册表里那 25 条通用动作。Nous 看到的结果是：
 *   > "那个 action 大类里面，基本上全是用不到的。"
 *
 *   ★ 病根不在排序排得好不好 —— **排序解决不了取舍**。
 *     把 Arrest a Fall / Avert Gaze / Burrow / Mount 排到第 3 页，它们还是占着 3 页；
 *     而玩家真正会点的那几条，本来就已经在他自己的角色卡上了。
 *   ★ 一并作废的还有那份"哪个更常用"的自拟清单 —— 那是**我编的数据**，
 *     pf2e 从来没有这个字段。判据见下面 BASIC_ACTIONS。
 */

/**
 * **常驻的那几个通用动作**（Nous 2026-08-07 点名）。
 *
 * > "那个 action 大类里面基本上全是用不到的 —— 游戏里面提供，
 * >  但是玩家和 GM 里面都是不会真正的去丢色子的。
 * >  放 3-4 常用的，然后就只去读角色表里面的应该就可以。"
 * > "我觉得可能给一个 aid、take cover、tumbling through，
 * >  第四的（这个永远是 ui 里面最后一个）……提醒玩家去在表格里面添加。"
 *
 * ★ **哪三个是 Nous 拍的，不是我排的** —— "常不常用"这件事 pf2e 数据里没有，
 *   我上一版靠一份自拟的 `COLD_START_ORDER` 排 25 条，
 *   结果是一圈他从来不点的东西（Arrest a Fall / Avert Gaze / Burrow / Mount…）。
 *   ⚠ 排序推不出取舍：把没用的排到第 3 页，它还是占着 3 页。
 *
 * ★ 剩下的一律**照角色卡搬** —— 玩家真会点的那些，他自己早就拖进卡里了。
 *   这与 alpha 反馈那条完全一致：
 *   "players can just add which actions they want… People rarely drag in all
 *    the ones they can possibly do, just ones they commonly do."
 */
export const BASIC_ACTIONS = ["aid", "take-cover", "tumble-through"] as const;

/** 末位那一格的 id —— 点它去开角色卡。 */
export const SHEET_HINT_ID = "sheet:actions";

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
        // ⚠ **每层只算一次**：放进逐条目判定里，几十条动作会把 getRollOptions 跑几十遍
        const 限制态 = restrictionStateOf(actor);

        const 基本: SectorData[] = (coll ? BASIC_ACTIONS
            .map(slug => coll.get(slug) as RawAction | undefined)
            .filter((a): a is RawAction => !!a) : [])
            .map(a => 通用扇区(a, 限制态));

        /*
         * ★ 卡上那份「Actions」清单 —— 玩家自己录进去的那些。
         * ⚠ 用**同一个转换器**（`sheetSector`），与 Free / Reactions / Class 共享一份，
         *   别在这里再抄一遍。
         */
        const 卡 = sheetActionsOf(actor);
        const byId = new Map(((actor as any)?.items?.contents ?? []).map((i: any) => [i.id, i]));
        const 自录: SectorData[] = (卡 ?? [])
            .filter(s => s.group === "action")
            .map(s => sheetSector(s, "class:", byId.get(s.id), 限制态));

        return [...基本, ...自录, 添加提示()];
    } catch (err) {
        console.error("player-action-ui-hub | collectActions 失败", err);
        return [];
    }
}

/**
 * 末位那一格：**去角色卡添加**。
 *
 * ★ 它不是一个动作，是一个出口 —— 所以用蓝字（`tone: "link"`）与真动作区分开。
 *   Nous 的话："第四的（这个永远是 ui 里面最后一个）全部用蓝色字写，
 *   提醒玩家去在表格里面添加 + 打开玩家表格。"
 *
 * ★ 为什么它比"把 70 条全摆出来"强：摆出来的那 70 条**点了也只是贴一段说明**，
 *   而卡上那条是玩家自己配好的、带加值和规则元素的。
 *   与其替他准备一堆半成品，不如把他领到能一次配好的地方。
 */
function 添加提示(): SectorData {
    return {
        id: SHEET_HINT_ID,
        /*
         * ⚠ 环上只放一个记号（Nous 2026-08-07："边盘上面的 ui 就只放一个蓝色的加号
         *   就够，本来就没地方放"）。一格宽约 50px，塞得下记号塞不下句子。
         */
        label: "+",
        // 句子在毂里说 —— 那里有的是地方
        hubLabel: "Add on sheet",
        cost: null,
        state: "normal",
        tone: "link",
        detail: "Anything you drag onto your sheet's Actions tab shows up here. Click to open it.",
    };
}

/**
 * 采集**自由动作**（Nous 2026-08-07："玩家表格上还有 free action"）。
 *
 * ★ 完全照卡上那一节搬；卡上没有就返回空，**上层据此不画这一格**
 *   —— 与 Bodies / Conditions 同一条规矩：灰着不传达任何信息的格子就不该常驻。
 */
export function collectFreeActions(actor: ActorPF2e | null): SectorData[] {
    try {
        const 卡 = sheetActionsOf(actor);
        if (!卡) return [];
        const 限制态 = restrictionStateOf(actor);
        const byId = new Map(((actor as any)?.items?.contents ?? []).map((i: any) => [i.id, i]));
        return 卡.filter(s => s.group === "free")
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(s => sheetSector(s, "class:", byId.get(s.id), 限制态));
    } catch (err) {
        console.error("player-action-ui-hub | collectFreeActions 失败", err);
        return [];
    }
}

/** 注册表里一条通用动作 → 扇区。 */
function 通用扇区(a: RawAction, 限制态: ReturnType<typeof restrictionStateOf>): SectorData {
        const 限 = restrictionFor({ slug: a.slug, traits: a.traits }, 限制态);
        return {
            id: `action:${a.slug}`,
            // ⚠ 必须 localize，理由见 RawAction.name 的注释
            label: game.i18n.localize(a.name),
            // ⚠ 实测 25 条基础动作里 20 条用的是 pf2e 的**通用消耗图标**
            //   （OneAction.webp 之流）—— 一圈全长一样等于没有图标，要换掉
            img: iconFor(a.img, ACTION_ICONS[a.slug]),
            cost: costToSectorCost(a.cost),
            /*
             * ★ **把「要求」摆到眼前**（2026-08-05，丙类调研的副产品）：
             *   实测注册表 70 条里 27 条有 Requirements，
             *   而 Trip 的 "You have at least one hand free" 正是设计定档点名要处理的那条。
             *   这是③段「条件灰显」里**可推导的那一半** ——
             *   判断满不满足很难且容易算错，把要求显示出来推得出来，且零映射。
             * ⚠ `description` 与 `name` 一样是本地化 key，必须 localize 后再解析。
             */
            detail: detailLine(
                a.description ? game.i18n.localize(a.description) : null,
                a.cost === "reaction",
            ) ?? undefined,
            /*
             * ★ **灰显不是禁止**（三态守则）：`gated` 只是变暗 + 画 ⛔ + 在毂里说明为什么，
             *   点下去照样执行。PF2e 的特例太多，误拦比不拦更伤。
             */
            state: 限?.state ?? "normal",
            reason: 限?.reason,
            // ★ 说明可点 → 打开纲要里那条的说明窗（毂里放不下的部分一点就有）
            infoUuid: actionUuid(a.slug),
        };
}
