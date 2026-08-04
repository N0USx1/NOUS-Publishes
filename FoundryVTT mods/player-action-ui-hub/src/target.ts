import type { ActorPF2e } from "foundry-pf2e";

/**
 * 轮盘作用于谁：优先当前控制的 token，其次玩家绑定角色。都没有则返回 null。
 *
 * 字段路径以 Task 0 Step 2 的实测为准（findings-v0.1 §1–2）：
 * `canvas.tokens.controlled[0].actor` 与 `game.user.character` 在
 * Foundry 14.365 + pf2e 8.4.0 上实读通过，无需改名。
 *
 * ★ 返回类型是 `ActorPF2e | null` 而不是 `any`（Task 9）：这里是整条链的入口，
 *   它一 `any`，下游 collector / executor / main 全部跟着失去类型闸。
 */
export function resolveActor(): ActorPF2e | null {
    const controlled = canvas?.tokens?.controlled?.[0]?.actor;
    if (controlled) return controlled;
    const bound = game?.user?.character;
    if (bound) return bound;
    return null;
}
