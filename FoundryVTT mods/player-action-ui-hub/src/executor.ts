import type { ActorPF2e } from "foundry-pf2e";
import { strikeSectorId, strikesOf, type WheelStrike } from "./collectors/strikes";

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
