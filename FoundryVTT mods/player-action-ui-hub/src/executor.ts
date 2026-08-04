import { strikeSectorId } from "./collector";

/**
 * 按扇区 id 回查 strike 对象。
 *
 * ⚠ 必须**先过滤出 strike 再取下标**，与 collector 的 `.filter().map()` 顺序一致；
 *   直接在 system.actions 上枚举会让退化分支的下标对不上。
 */
function findStrike(actor: any, strikeId: string): any | null {
    const actions = actor?.system?.actions;
    if (!Array.isArray(actions)) return null;
    const strikes = actions.filter((a: any) => a?.type === "strike");
    return strikes.find((s: any, i: number) => strikeSectorId(s, i) === strikeId) ?? null;
}

/**
 * 执行一次打击。`map` 为 0/1/2，对应第 1/2/3 击。
 * 只调 pf2e 系统自己的函数，规则计算一概不自己做。
 */
export async function rollStrike(
    actor: any,
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
        // ★ 硬约束（设计定档 §6.3）：**必须**把 event 传下去。
        //   PF2e Toolbelt 的自动掩护靠检定上下文里的 target 判断，
        //   缺了会**静默不生效**——不报错、不留痕，出了问题极难查。
        await variant.roll({ event });
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
    actor: any,
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
