import type { ActorPF2e } from "foundry-pf2e";
import { strikeSectorId, strikesOf, type WheelStrike } from "./collectors/strikes";
import { applySelfEffectAfterCast } from "./effects";
import { resolveAreaAfterCast } from "./area-effects";

/**
 * 按扇区 id 回查 strike 对象。
 *
 * ⚠ 必须**先过滤出 strike 再取下标**，与 collector 的 `.filter().map()` 顺序一致；
 *   直接在 system.actions 上枚举会让退化分支的下标对不上。
 *   ——所以直接复用 collector 的 `strikesOf`，两边永远是同一份过滤。
 */
function findStrike(actor: ActorPF2e | null | undefined, strikeId: string): WheelStrike | null {
    return strikesOf(actor).find((s, i) => strikeSectorId(s, i) === strikeId) ?? null;
}

/**
 * 把玩家在轮盘上的这一次点击，翻译成 pf2e 掷骰要的"意图事件"。
 *
 * 为什么不直接把原始点击事件递过去（源码实读 2026-08-05）：
 *
 * 1. **Ctrl 是我们的呼出键，但 pf2e 拿它当"暗骰"开关。**
 *    `sheet/helpers.ts:145` —— `if (event.ctrlKey || event.metaKey) messageMode = "gm"|"blind"`。
 *    玩家 Ctrl+点呼出轮盘后不松手直接点扇区，**每一次攻击都会变成暗骰**，
 *    而且不报错、无提示。必须把 ctrl/meta 抹掉。
 * 2. **默认要跳过加值确认框。** 轮盘存在的意义就是省掉多余那一步
 *    （§0 根理：把负担从人脑挪走）；确认框里的加值本来就由 pf2e 自动算好，
 *    诸如鼓舞类光环 buff 无论开不开框都已经在加值栈里。
 * 3. **仍要留给玩家反悔的口子**：按住 Shift 点 → 照常弹框，可临时加环境加值。
 *    这沿用 pf2e 自己"Shift 反转"的既有习惯，不另发明。
 *
 * 实现上造一个真的 `PointerEvent`：`isRelevantEvent`（helpers.ts:135）只鸭子类型地检查
 * 有没有 ctrlKey/metaKey/shiftKey 三个键，但用真事件最稳。
 *
 * ★ 2026-08-05（Task 9）由 `MouseEvent` 改成 `PointerEvent`：pf2e 的 `RollParameters.event`
 *   标的就是 `PointerEvent`（`system/rolls.ts` / 类型包 `system/rolls.d.ts:21`），
 *   而 `MouseEvent` 是它的父类、不可赋值。原来靠 globals 全 any 才没被发现。
 *   `PointerEvent` 是 `MouseEvent` 的子类，鸭子检查照样通过，运行时行为不变。
 *
 * ⚠ 掩护不受影响：Toolbelt 的 auto-cover 读的是检定上下文里的 `context.target`
 *   （其 tool.ts:307），来源是 `game.user.targets`，与事件对象无关。
 */
function intentEvent(realEvent: Event | null): PointerEvent {
    const skipDefault = !game.user?.settings?.showCheckDialogs;
    const userWantsDialog = !!(realEvent as MouseEvent | null)?.shiftKey;
    // skipDialog = shiftKey ? !skipDefault : skipDefault（helpers.ts:144）
    // 我们要的：默认 skipDialog=true；按住 Shift 则 false。反解出 shiftKey：
    const shiftKey = userWantsDialog ? skipDefault : !skipDefault;
    return new PointerEvent("click", { shiftKey, ctrlKey: false, metaKey: false });
}

/**
 * 执行一次打击。`map` 为 0/1/2，对应第 1/2/3 击。
 * 只调 pf2e 系统自己的函数，规则计算一概不自己做。
 */
export async function rollStrike(
    actor: ActorPF2e | null,
    strikeId: string,
    map: number,
    event: Event,
): Promise<void> {
    try {
        const strike = findStrike(actor, strikeId);
        if (!strike) {
            ui.notifications.warn("That strike is no longer available — reopen the wheel.");
            return;
        }
        const variant = strike.variants?.[map];
        if (!variant) {
            ui.notifications.warn("That strike has no such attack in the sequence.");
            return;
        }
        // 传的是"意图事件"而非原始点击，理由见 intentEvent 的注释：
        // 默认跳过加值框、且不让呼出用的 Ctrl 把这一击变成暗骰。
        await variant.roll({ event: intentEvent(event) });
    } catch (err) {
        console.error("player-action-ui-hub | rollStrike 失败", err);
        ui.notifications.error("The roll failed — see the console for details.");
    }
}

/**
 * 执行武器辅助动作（拔出/收起/换手）。
 * `auxIndex` 取 0 即"第一个辅助动作"——未拔出时实测只有 "Draw (1H)" 这一个
 * （findings-v0.1 §2）。
 */
export async function execAuxiliary(
    actor: ActorPF2e | null,
    strikeId: string,
    auxIndex: number,
): Promise<void> {
    try {
        const strike = findStrike(actor, strikeId);
        const aux = strike?.auxiliaryActions?.[auxIndex];
        if (!aux) {
            ui.notifications.warn("This weapon has no such action.");
            return;
        }
        await aux.execute();
    } catch (err) {
        console.error("player-action-ui-hub | execAuxiliary 失败", err);
        ui.notifications.error("The action failed — see the console for details.");
    }
}

/**
 * 掷一次裸技能检定。
 *
 * ★ 存在的理由是 Nous 2026-08-05 的观察：**"撬锁"玩家心里想的是"掷巧手"**。
 *   技能层的第一格给的就是这个 —— 不用先找到某个具体动作才能掷。
 *   对照表 §6：`actor.getStatistic(slug).roll({ event })`。
 */
export async function rollSkill(
    actor: ActorPF2e | null,
    slug: string,
    event: Event,
): Promise<void> {
    try {
        const stat = (actor as any)?.getStatistic?.(slug);
        if (!stat) {
            ui.notifications.warn("This character has no such skill.");
            return;
        }
        /*
         * ⚠⚠ **这条路径不能传 `event`** —— 与 `variant.roll()` 正好相反（2026-08-05 实测）。
         *
         *   四种组合逐个试出来的（`showCheckDialogs` 为真时）：
         *     只传 `skipDialog: true`              → 出结果、无框  ✓
         *     `event`(无 shift) + `skipDialog:true` → 无结果、弹框  ✗
         *     `event`(有 shift) + `skipDialog:true` → 无结果、弹框  ✗
         *     只传 `event`                          → 无结果、弹框  ✗
         *
         *   **只要 `event` 在，`skipDialog` 就完全失效**，与 shift 是什么无关 ——
         *   不是两个参数打架，是 `event` 一出现就接管了整个判断。
         *
         *   所以打击那边靠 `intentEvent` 反解 shift、这边靠 `skipDialog`，
         *   **两条路径必须分开写**。我最初照搬打击的写法，白改了两轮。
         *
         * ⚠ 不传 event 的代价：生态模组拿不到检定上下文。对技能检定可以接受 ——
         *   Toolbelt 的自动掩护只包攻击检定，与这里无关（设计定档 §6.3）。
         *   将来若有模组要听技能检定，这里要重新权衡。
         *
         * 立场不变：默认跳过加值框（省掉多余那一步），按住 Shift 才弹。
         */
        const wantsDialog = !!(event as MouseEvent | null)?.shiftKey;
        await stat.roll({ skipDialog: !wantsDialog });
    } catch (err) {
        console.error("player-action-ui-hub | rollSkill 失败", err);
        ui.notifications.error("The check failed — see the console for details.");
    }
}

/**
 * 施放一个法术。
 * 对照表 §6：`spell.spellcasting.cast(spell, {rank, slotId})`。
 *
 * ⚠ **`rank` 用 pf2e 自己算好的 `spell.rank`，我们不推算提升环位** ——
 *   实测戏法 `baseRank: 1` 而 `rank: 3`（系统自动升到角色最高环）。
 *   自己算等于把规则搬进来一份，那正是本模组明确不做的事。
 */
export async function castSpell(
    actor: ActorPF2e | null,
    entryId: string,
    spellId: string,
): Promise<void> {
    try {
        const entry = (actor as any)?.spellcasting?.get?.(entryId);
        const spell = entry?.spells?.get?.(spellId);
        if (!entry || !spell) {
            ui.notifications.warn("That spell is no longer available — reopen the wheel.");
            return;
        }
        await entry.cast(spell, { rank: spell.rank });

        /*
         * ★ 施放之后自动把"作用于自己"的效果套上（②段第一步）。
         *   pf2e 只在聊天卡片上给个按钮等玩家点 —— 那一步是纯机械劳动，
         *   而 Shield 这类每回合都要重来（实测持续"到你下回合开始"）。
         *
         * ⚠ **放在 cast 之后、且失败不影响施法**：骰子已经掷出去了，
         *   自动化出问题不该把已经生效的施法也搅黄。
         */
        const applied = await applySelfEffectAfterCast(actor, spell);
        if (applied) ui.notifications.info(`${applied} applied.`);

        /*
         * ★ 豁免类范围减益（路径 B）：逐个敌人掷豁免，失败的才套。
         *   **不能像 aura 那样直接套** —— Bane 的规则是"敌人必须通过 Will 豁免，否则…"，
         *   直接套等于跳过豁免。
         *
         * ⚠ 结果发到聊天栏而不是通知条：它是**多行、要留档**的东西，
         *   而且部分失败（没权限改敌人）要让 GM 看得见并接手。
         */
        const 结算 = await resolveAreaAfterCast(actor, spell);
        if (结算) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: actor as any }),
                content: `<p><strong>${spell.name}</strong></p><p>${结算}</p>`,
            });
        }
    } catch (err) {
        console.error("player-action-ui-hub | castSpell 失败", err);
        ui.notifications.error("Casting failed — see the console for details.");
    }
}

/**
 * 执行一个通用/技能动作。
 * 对照表 §6：`game.pf2e.actions.get(slug).use({ actors, event })`。
 *
 * ⚠ 同样传"意图事件"而不是原始点击 —— 理由与 `rollStrike` 完全一致：
 *   呼出轮盘用的 Ctrl 会被 pf2e 读成暗骰开关（`sheet/helpers.ts:145`）。
 */
export async function useAction(
    actor: ActorPF2e | null,
    slug: string,
    event: Event,
): Promise<void> {
    try {
        // ⚠ 局部豁免同 collectors/actions.ts：类型包没有声明 `game.pf2e.actions`
        const action = (game as any).pf2e?.actions?.get(slug);
        if (!action) {
            ui.notifications.warn("That action is not available in this world.");
            return;
        }
        await action.use({ actors: actor ? [actor] : [], event: intentEvent(event) });
    } catch (err) {
        console.error("player-action-ui-hub | useAction 失败", err);
        ui.notifications.error("The action failed — see the console for details.");
    }
}
