import { strikeSectorId } from "./collectors/strikes";

/**
 * **打击的伤害串** —— `1d6 + 1 piercing` 这一行。
 *
 * ★ 起因（Nous 2026-08-08）："攻击那里没有说明 ok，但是没有写伤害数值说明。"
 *
 * ★★ **问系统要成品，不自己拼**：`strike.damage({ getFormula: true })` 直接给
 *   `"1d6 + 1 piercing"`，力量加值、符文、增伤全在里面。
 *   ⚠ 另一条看着更省事的路是 `strike.item.system.damage`
 *   （实测 `{dice:1, die:"d6", damageType:"piercing", modifier:0}`）——
 *   那是**武器的基础伤害**，不含任何加值。拿它显示会稳定地少报一截，
 *   而且**看起来完全正常**（格式对、类型对，只有数小了）。
 *
 * ⚠ 它是**异步**的，而采集器是同步的 —— 与 `sheet-actions` / `spell-slots` 同一套办法：
 *   呼出轮盘时取一次缓存起来，采集器同步读。
 */

const 缓存 = new Map<string, string>();
const 键 = (actorId: string, key: string) => `${actorId}::${key}`;

/** 取一次全部打击的伤害串并缓存。**在呼出轮盘那一步 await 它**。 */
export async function primeStrikeDamage(actor: unknown): Promise<void> {
    const a = actor as any;
    const actorId = a?.id;
    if (!actorId) return;
    const strikes = (a?.system?.actions ?? []).filter((x: any) => x?.type === "strike");
    await Promise.all(strikes.map(async (s: any, i: number) => {
        const k = 键(actorId, strikeSectorId(s, i));
        try {
            const f = await s.damage?.({ getFormula: true });
            if (typeof f === "string" && f.trim()) 缓存.set(k, f.trim());
            else 缓存.delete(k);
        } catch {
            // ⚠ 取不到就**不显示**，不退回基础伤害 —— 少报的数字比没有数字更坏
            缓存.delete(k);
        }
    }));
}

/** 读缓存；没有返回 undefined（那一格就不显示伤害）。 */
export function strikeDamageOf(actor: unknown, strikeKey: string): string | undefined {
    const actorId = (actor as any)?.id;
    return actorId ? 缓存.get(键(actorId, strikeKey)) : undefined;
}

/** 换角色/角色数据变了就清掉（换了武器、上了符文，伤害就变了）。 */
export function clearStrikeDamage(): void { 缓存.clear(); }
