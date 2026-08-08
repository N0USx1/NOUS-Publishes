/**
 * **这回合最后施放的那个法术是什么伤害类型**。
 *
 * ★ 只为一件事存在（Nous 2026-08-07）：
 *   > "spell strike 之后自动进入，询问类型是最后一个发出的 spell 的攻击类型
 *   >  （比如绑定到 Ignition，那么自动加火属性的）。如果都没有就是武器类型的。"
 *
 *   Arcane Cascade 的规则原文正是这个意思：
 *   *"If you Cast a Spell and then enter Arcane Cascade on the same turn,
 *     you can change the damage from the stance to any one damage type that spell could deal."*
 *
 * ★ **我们不判"能不能改"，只是把答案先填好** —— 玩家仍然可以删掉重挂。
 *   这条与"提示不是锁"是同一件事的另一面：预填是省一步，不是替他做决定。
 *
 * ⚠ **按回合作废**（`round` 对不上就当没有）：规则限定"同一个回合"，
 *   而记忆型的东西最容易变成一个**看起来正确的错答案** ——
 *   上一场战斗的火属性被带进这一回合，玩家不会发现。
 *   实现上不去"过期删除"，只在读的时候比对 round：写进去的东西不会自己腐坏。
 */

interface 记录 { round: number; types: string[] }

const 表 = new Map<string, 记录>();

/** 记一次施法。`types` 为空也照记 —— "施了个没伤害的法术"也是事实。 */
export function noteSpell(actorId: string, round: number, types: string[]): void {
    if (!actorId || !Number.isFinite(round)) return;
    表.set(actorId, { round, types: [...types] });
}

/**
 * 这回合最后一个法术的伤害类型；不同回合或没记录返回空数组。
 * ⚠ `round` 传 null（不在战斗中）时一律返回空：战斗外没有"同一个回合"这回事。
 */
export function spellTypesThisTurn(actorId: string, round: number | null): string[] {
    if (round === null) return [];
    const r = 表.get(actorId);
    return r && r.round === round ? [...r.types] : [];
}

/** 战斗开始/结束时清账，与 economy 同一时点。 */
export function clearSpells(): void { 表.clear(); }
