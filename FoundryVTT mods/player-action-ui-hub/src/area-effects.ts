/**
 * 范围效果（②段，2026-08-05）——**两条路径，机制不同，不要混为一谈**。
 *
 * ★ 路径 A · 盟友增益（`aura`）
 *   往**施法者自己**身上套一个带 Aura 规则元素的 effect，
 *   扩散、进出范围、到期清理**全归 pf2e 管**。我们不碰任何别人的 actor，
 *   于是权限、路由、部分失败这些问题**根本不存在**。
 *
 * ★ 路径 B · 敌人减益（`save`）
 *   **Aura 做不到这个** —— 它只能"在范围内就套"，没有"掷骰后再决定"。
 *   而 Bane 的规则原文是 "Enemies in the area **must succeed at a Will save** or take −1"，
 *   直接套上去等于**跳过豁免**，那是把规则算错了。
 *   所以只能自己遍历敌人 → 逐个掷豁免 → 失败的才套。
 *
 * ⚠ **增益与减益不是对称的**：增益不需要豁免所以能全自动，减益必须先掷骰。
 *   这条差别是规则决定的，不是实现偷懒。
 *
 * ⚠ 路径 B 要**写别人的 actor**，权限跟着执行代码的用户走
 *   （服务端 `canUserModify` 实读，见 effects.ts 注释）。改不动的如实报告，不静默跳过。
 */
import type { ActorPF2e } from "foundry-pf2e";

/** 一个范围法术要怎么处理。 */
export interface AreaPlan {
    /** `aura` = 套给自己让系统扩散；`save` = 遍历敌人掷豁免 */
    mode: "aura" | "save";
    /** 半径（尺），取自法术的 `system.area.value` */
    radius: number;
    /** 要施加的 effect 的 compendium UUID */
    effectUuid: string;
    /** 豁免用哪一项；`mode: "save"` 时必填 */
    save?: "fortitude" | "reflex" | "will";
    /**
     * 哪些成功度算"中招"。
     * ★ 默认只有失败与大失败 —— PF2e 的常规减益，成功就是没事。
     *   有些法术成功也有减半效果，那种要显式写出来。
     */
    applyOn?: DegreeName[];
}

export type DegreeName = "criticalFailure" | "failure" | "success" | "criticalSuccess";

/** pf2e 的 `degreeOfSuccess` 是 0-3，转成名字好读也好写判据。 */
export const DEGREE_NAMES: DegreeName[] = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** 默认中招条件：豁免失败或大失败。 */
export const DEFAULT_APPLY_ON: DegreeName[] = ["criticalFailure", "failure"];

/**
 * 谁在范围内、且是敌人。
 *
 * ⚠ **距离和敌我都用 pf2e 自己的判断**，不自己实现：
 *   - `token.distanceTo()` —— PF2e 的距离规则（含对角线 5/10/5）由它负责；
 *   - `actor.isEnemyOf()` —— 敌我判定是规则问题，源码里 `auraAffectsActor` 用的就是它。
 *   自己算这两样等于把规则搬进来一份，那正是本模组明确不做的事。
 *
 * ⚠ 范围判定要求场景**有网格** —— 无网格场景下 pf2e 的距离与 aura 都不正常
 *   （2026-08-05 实测：十次实验因此全部得出错误结论，见调研文档事实五）。
 */
export function enemiesInRange(
    casterToken: any,
    radiusFeet: number,
): { token: any; actor: ActorPF2e; distance: number }[] {
    try {
        const out: { token: any; actor: ActorPF2e; distance: number }[] = [];
        for (const t of (canvas as any)?.tokens?.placeables ?? []) {
            if (!t?.actor || t.id === casterToken?.id) continue;
            if (!casterToken.actor?.isEnemyOf?.(t.actor)) continue;
            const d = casterToken.distanceTo?.(t);
            if (typeof d !== "number" || d > radiusFeet) continue;
            out.push({ token: t, actor: t.actor, distance: d });
        }
        return out;
    } catch (err) {
        console.error("player-action-ui-hub | enemiesInRange 失败", err);
        return [];
    }
}

/** 一次豁免的结果。 */
export interface SaveOutcome {
    actorName: string;
    degree: DegreeName | null;
    applied: boolean;
    /** 没套上的原因；套上了为 null */
    reason: string | null;
}

/**
 * 对范围内的敌人逐个掷豁免，失败的套上效果。
 *
 * ★ **每一次豁免都出聊天卡片**（`createMessage: true`）——
 *   GM 与玩家都看得见谁掷了多少、成没成。自动化不该是黑箱：
 *   看不见的自动化和算错了没法区分。
 */
export async function resolveSaveAgainstEnemies(
    casterToken: any,
    plan: AreaPlan,
    dc: number,
): Promise<SaveOutcome[]> {
    const results: SaveOutcome[] = [];
    if (plan.mode !== "save" || !plan.save) return results;

    const applyOn = plan.applyOn ?? DEFAULT_APPLY_ON;
    const targets = enemiesInRange(casterToken, plan.radius);

    for (const { actor } of targets) {
        const name = (actor as any).name ?? "?";
        try {
            const stat = (actor as any).saves?.[plan.save];
            if (!stat) { results.push({ actorName: name, degree: null, applied: false, reason: "没有这项豁免" }); continue; }

            const roll = await stat.roll({ dc: { value: dc }, skipDialog: true, createMessage: true });
            const degree = DEGREE_NAMES[roll?.degreeOfSuccess ?? -1] ?? null;

            if (!degree || !applyOn.includes(degree)) {
                results.push({ actorName: name, degree, applied: false, reason: "豁免成功" });
                continue;
            }
            // ⚠ 改别人的 actor：改不动就如实报告，不静默跳过
            if (!(actor as any).canUserModify?.(game.user, "update")) {
                results.push({ actorName: name, degree, applied: false, reason: "无权限修改该角色" });
                continue;
            }
            const doc: any = await fromUuid(plan.effectUuid);
            if (!doc) { results.push({ actorName: name, degree, applied: false, reason: "找不到效果" }); continue; }
            const data = doc.toObject();
            foundry.utils.setProperty(data, "flags.player-action-ui-hub.autoApplied", true);
            await (actor as any).createEmbeddedDocuments("Item", [data]);
            results.push({ actorName: name, degree, applied: true, reason: null });
        } catch (err) {
            console.error(`player-action-ui-hub | 对 ${name} 结算豁免失败`, err);
            results.push({ actorName: name, degree: null, applied: false, reason: "出错，详见控制台" });
        }
    }
    return results;
}

/** 把结算结果写成一句人话，发到聊天栏。**部分失败要如实说**，不要只报成功的。 */
export function summarize(results: SaveOutcome[]): string {
    if (!results.length) return "No enemies in range.";
    const hit = results.filter(r => r.applied).map(r => r.actorName);
    const missed = results.filter(r => !r.applied);
    const parts: string[] = [];
    if (hit.length) parts.push(`Affected: ${hit.join(", ")}`);
    for (const r of missed) parts.push(`${r.actorName}: ${r.reason}`);
    return parts.join(" · ");
}
