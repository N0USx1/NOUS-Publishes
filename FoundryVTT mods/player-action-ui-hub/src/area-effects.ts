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
import { radiusAtRank, rankOf, linkedSpellEffectUuid, spellDC } from "./spell-data";

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

/* ══════════════════════════════════════════════════════════════
 * 路径 B 的登记表与接线
 * ══════════════════════════════════════════════════════════════ */

/**
 * 需要豁免的范围减益。
 *
 * ★ 与 aura 那张表同一条纪律：**只登记推不出来的东西**。
 *   豁免项（`system.defense.save.statistic`）、半径、效果 UUID 全部实测可从法术读，
 *   所以这里只剩"接管哪几条"和"哪些成功度算中招"。
 *
 * ⚠ **Roar of the Dragon 不在这里**，尽管它也是"emanation + Will 豁免"。
 *   实测它的 `Spell Effect: Roar of the Dragon` 里只有一条 `FlatModifier:diplomacy` ——
 *   那是**施法者自己**对龙的 +2 交涉加值，套给敌人正好反了（给敌人发增益）。
 *   敌人那头是按四档给 `frightened`（**condition 不是 effect**），
 *   而且规则写明"**GM 判定**谁算与龙有渊源"——目标集合不可推导。
 *   → 形状不同的东西不要因为字段像就归成一类。
 *
 * ⚠ Bane / Malediction 都有"Sustain 一次半径 +10 尺、对**尚未中招**的敌人再掷一次"。
 *   这里**只处理首次施放**：持续追踪谁已中招是跨回合状态，另算一件事。
 */
export interface SaveSpec {
    slug: string;
    name: string;
    /** 规则原文依据 */
    rule: string;
    /** 哪些成功度算中招；不写就是默认的失败/大失败 */
    applyOn?: DegreeName[];
}

export const SAVE_SPECS: SaveSpec[] = [
    {
        slug: "bane", name: "Bane",
        rule: "Enemies in the area must succeed at a Will save or take a -1 status penalty to attack rolls as long as they are in the area.",
    },
    {
        slug: "malediction", name: "Malediction",
        rule: "Enemies in the area must succeed at a Will save or take a -1 status penalty to AC as long as they're in the area.",
    },
];

export function saveSpecFor(slug: string | null | undefined): SaveSpec | null {
    if (!slug) return null;
    return SAVE_SPECS.find(s => s.slug === slug) ?? null;
}

/**
 * 从法术本体拼出这次施放的 `AreaPlan`。
 *
 * ⚠ 取不齐一律 null。尤其**豁免项必须来自 `system.defense.save.statistic`** ——
 *   写死"Will"在这两条上碰巧对，换一条法术就错，而且不会报错。
 */
export function savePlanFor(spell: any): AreaPlan | null {
    const spec = saveSpecFor(spell?.slug ?? null);
    if (!spec) return null;
    const radius = radiusAtRank(spell, rankOf(spell));
    const effectUuid = linkedSpellEffectUuid(spell);
    if (!radius || !effectUuid) return null;
    const save = spell?.system?.defense?.save?.statistic;
    if (save !== "fortitude" && save !== "reflex" && save !== "will") return null;
    return { mode: "save", radius, effectUuid, save, applyOn: spec.applyOn ?? DEFAULT_APPLY_ON };
}

/**
 * 施法者在当前场景上的 token。
 *
 * ⚠ 一个 actor 可能在多个场景各有 token（实测该角色 `getActiveTokens()` 返回 2 个），
 *   要挑**当前画布上的那个**，否则距离是拿另一个场景的坐标算的。
 */
export function casterTokenOf(actor: any): any | null {
    const 全部 = actor?.getActiveTokens?.() ?? [];
    const 本场景 = 全部.find((t: any) => t?.scene?.id === (canvas as any)?.scene?.id);
    return 本场景 ?? 全部[0] ?? null;
}

/**
 * 场景**有没有网格**。
 *
 * ★ 这是一道**门**，不是一个提示：无网格场景下 pf2e 的距离与 aura 都不正常
 *   （2026-08-05 实测：十次实验因此全部得出错误结论）。
 *   无网格时宁可什么都不做并说清楚，也不要算出一个看起来正常的错答案。
 */
export function sceneHasGrid(): boolean {
    return Number((canvas as any)?.scene?.grid?.type ?? 0) > 0;
}

/**
 * 施放之后：如果这是登记过的豁免类范围法术，就逐个敌人掷豁免并结算。
 *
 * ⚠ 玩家通常**改不动敌人的 actor**（权限跟着执行代码的用户走）。
 *   那种情况下豁免照掷（掷骰只发聊天消息，不改文档），改不动的**逐个如实报告** ——
 *   GM 看着结果点两下即可，比"什么都没发生"有用得多，比"静默跳过"诚实得多。
 */
export async function resolveAreaAfterCast(actor: any, spell: any): Promise<string | null> {
    try {
        const plan = savePlanFor(spell);
        if (!plan) return null;

        if (!sceneHasGrid()) {
            return "This scene has no grid — PF2e cannot measure the area reliably, so no saves were rolled.";
        }
        const token = casterTokenOf(actor);
        if (!token) return null;

        const dc = spellDC(spell);
        if (dc == null) return null;

        const results = await resolveSaveAgainstEnemies(token, plan, dc);
        return summarize(results);
    } catch (err) {
        console.error("player-action-ui-hub | resolveAreaAfterCast 失败", err);
        return null;
    }
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
