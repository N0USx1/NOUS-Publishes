import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { detailLine, HUB_CLAUSE_MAX } from "../triggers";
import { iconFromChain, type ClassItemLike } from "./class-abilities";
import { sheetActionsOf } from "../sheet-actions";
import { sheetSector } from "./sheet-sectors";
import { restrictionStateOf } from "../restrictions";

/**
 * 反应分类（Nous 2026-08-07 定）。
 *
 * ★★ **它存在的理由是一条我们做不到的事**（丙类调研 §4.2 实测）：
 *   104 条带触发段的反应里，**16 条的触发事件 pf2e 根本不广播**
 *   （"在你触及范围内使用了操作动作"、"你掉落"、"你获得恐惧"…），
 *   最常用的 `Reactive Strike` 就在里面。这不是难做，是**没有事件可听**。
 *
 *   Nous 的处理方式不是硬做，是**把这一半交回给玩家**：
 *
 *   > "为这些事件而做出反馈的『动作持有人』设计更多的 UI element……
 *   >  把我们无法写/极其困难的部分交回给玩家：概念上就变成了
 *   >  『因为你的特性 你还有这些，你看着办吧』。"
 *
 *   ★ 这与整个模组的立场一致：**我们不做规则，我们照规则做行为**。
 *     判断"够不够近、算不算操作动作"是规则（不做）；
 *     把对得上的反应摆到眼前让他自己判断，是行为（做）。
 *
 * ★ **这是一个横切镜头，不是搬家**：同一条反应仍留在职业层/动作层里。
 *   拿掉的话，Magus 的 Spell Parry 就从"我的职业能做什么"里消失了 ——
 *   而玩家找它的时候，两条路都会想走。
 *   ⚠ 所以别为了"不重复"去别处删它，重复在这里是**特性**。
 *
 * ⚠ 实测：**5 级 Magus 一条反应都没有**（Nous offnirr 全 21 个条目零反应）。
 *   所以这一格经常是空的 —— 走已有的"空分类灰显但仍可点"那条路，
 *   点了给一句说明，比一个点不动的死格子强。
 */

/** 采集反应要用到的最小形状。与 `ClassItemLike` 同源，多一个法术专用的字段。 */
export interface ReactionItemLike extends ClassItemLike {
    /**
     * 法术的动作消耗写在 `system.time.value`，**不在 `actionType` 上**（实测）。
     * 反应法术（如 Feather Fall）只能靠这个字段认出来。
     */
    time?: string | null;
    /** 法术所属的施法条目 id；非法术为 null。执行时要用它拼 `spell:<entry>:<spell>`。 */
    entryId?: string | null;
}

/**
 * 一个条目算不算反应。
 *
 * ⚠ **两个字段都要看**：动作/专长用 `system.actionType.value === "reaction"`，
 *   法术用 `system.time.value === "reaction"` —— 法术**没有 actionType 字段**
 *   （实测 undefined，class-abilities 那边同样踩过）。
 *   只看一个字段会静默漏掉一整类，而且不报错。
 */
export function isReaction(item: ReactionItemLike): boolean {
    return item.actionType === "reaction" || item.time === "reaction";
}

/**
 * 从条目清单里挑出反应，按名字排序。
 *
 * ★ **按名字排，不按使用频率排**：这一格的用途是"翻一翻我还有什么"，
 *   而不是"快速点我常点的那个"。频率排序会让位置每场战斗都在动，
 *   把唯一能靠肌肉记忆的东西也拿掉。
 */
export function pickReactions(items: ReactionItemLike[]): ReactionItemLike[] {
    return items.filter(isReaction).sort((a, b) => a.name.localeCompare(b.name));
}

/** 采集反应扇区。只读，绝不写 actor。 */
export function collectReactions(actor: ActorPF2e | null): SectorData[] {
    try {
        /*
         * ★★ **优先照角色卡搬**（Nous 2026-08-07）：卡上就有 "Reactions" 那一节，
         *   我们不该再自己判"什么算反应"。
         * ⚠ 拿不到卡数据才走下面按字段推的退化路径。
         */
        const 卡 = sheetActionsOf(actor);
        if (卡) {
            const byId = new Map(((actor as any)?.items?.contents ?? []).map((i: any) => [i.id, i]));
            // ⚠ 转换只此一份（`sheetSector`）；灰显判据是 `frequency` 不是 `usable`，
            //   理由见 sheet-actions.ts 里 usable 那段注释。
            const 限制态 = restrictionStateOf(actor);
            return 卡.filter(s => s.group === "reaction")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(s => sheetSector(s, "reaction:", byId.get(s.id), 限制态));
        }
        const items: ReactionItemLike[] = ((actor as any)?.items?.contents ?? []).map((i: any) => ({
            id: i.id,
            name: i.name,
            type: i.type,
            img: i.img,
            traits: i.system?.traits?.value ?? [],
            actionType: i.system?.actionType?.value,
            time: i.system?.time?.value ?? null,
            actions: i.system?.actions?.value ?? null,
            category: i.system?.category,
            grantedById: i.flags?.pf2e?.grantedBy?.id ?? null,
            description: i.system?.description?.value ?? "",
            // 实测：法术的归属条目在 `system.location.value`
            entryId: i.type === "spell" ? (i.system?.location?.value ?? null) : null,
        }));
        const byId = new Map(items.map(i => [i.id, i]));
        const resolve = (id: string) => byId.get(id);

        return pickReactions(items).map((i): SectorData => ({
            /*
             * ★ **法术反应沿用 `spell:` 前缀**，让它落回已有的施法分支 ——
             *   施放要扣法术位、要认施法条目，那套逻辑只该有一份。
             *   照抄一份到这里，就是又造了一个会腐坏的副本。
             */
            id: i.type === "spell" && i.entryId ? `spell:${i.entryId}:${i.id}` : `reaction:${i.id}`,
            label: i.name,
            /*
             * ⚠ **不兜底成同一个图标**（2026-08-07 我先那么做了，Nous 否掉）：
             *   反应多半是从纲要直接装上的独立条目，既没有 grantedBy 链可回溯、
             *   自己的图标又是 pf2e 的通用动作图标（视为空缺）——
             *   全兜底成循环箭头的话，一圈长得一模一样，**等于没有图标**。
             * ★ 正解是让**标签断成两行**（见 wheel-app 的 SECTOR_LABEL_UNITS）：
             *   "Reactive Strike" 原来被切成 "Reactive Str…"，那是断行没做，
             *   不是"必须有图标"。
             */
            img: iconFromChain(i, resolve),
            cost: "reaction",
            // 这一整层都是反应，但记号仍要画：玩家会从别的层跳进来，
            // 少了它就得靠"我记得这层是反应层"来读，那是把状态放进人脑
            badge: "⟳",
            /*
             * ★ 触发条件就是这一格的**全部价值**。玩家卡住的不是"找不到反击按钮"，
             *   而是"我现在到底能不能反击" —— 而那句话本来就写在条目里。
             * ⚠ 必须传 localize：NPC 的能力描述常常整段是 @Localize 引用，
             *   不展开的话每一个 NPC 反应都读不到触发条件，且不报错。
             */
            detail: detailLine(i.description, true, HUB_CLAUSE_MAX, (k) => game.i18n.localize(k)) ?? undefined,
            // 三态守则：提示不是锁。反应槽用完了也照常可点（见毂里的 ⟳ 计数），
            // 因为"这一轮还能不能反应"是规则判断，规则判断归玩家
            state: "normal",
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectReactions 失败", err);
        return [];
    }
}
