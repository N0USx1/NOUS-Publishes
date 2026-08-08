/**
 * 丙类 · **把效果贴到我指名的那个敌人身上**（守护者 Taunt 等）。
 *
 * ★★ **登记表一条都不用写** —— 效果的 uuid **就写在动作自己的描述里**：
 *   实测 `Taunt` 的描述含 `@UUID[Compendium.pf2e.feat-effects.Item.FlyWq9znOHvpISNW]{Effect: Taunt}`。
 *   与"图标走 grantedBy 链""光环靠 heightening 表"是同一形状：
 *   东西早在数据里，只是没去取那一环。
 *
 * ★ **"标的是谁"也不用我们代记**（2026-08-05 查透、2026-08-07 落地时修正）：
 *   我原以为要用 `TokenMark` 规则元素。实测**不需要** ——
 *   `Effect: Taunt` 的谓词写的是 `{not: "target:signature:{item|origin.signature}"}`，
 *   也就是说 **pf2e 自己用 `flags.pf2e.origin` 记住了"谁taunt的"**。
 *   我们只要把 origin 填对，剩下的判定全是它的事。
 *   ⚠ 少填 origin 不会报错 —— 效果照样挂上去，只是那个 −1 对**所有人**生效，
 *     包括对守护者自己。**错得比不挂更隐蔽。**
 *
 * ⚠ **写别人的 actor**：权限跟着执行代码的用户走（与范围效果路径 B 同一条边界）。
 *   玩家通常改不动敌人 —— 改不动就**如实报告**，绝不静默跳过。
 */

/** 一次施加的结果。⚠ 失败要能说出为什么，"没反应"是最差的反馈。 */
export interface MarkResult {
    applied: boolean;
    targetName: string;
    reason: string | null;
}

/**
 * 从一个动作的描述里取出它自带的效果 uuid。
 *
 * ⚠ 判据是 **`@UUID` 链接的显示名以 `Effect:` 开头**，不是"描述里第一个链接" ——
 *   实测 Taunt 的描述里**第一个**链接是 `Off-Guard`（一个条件），
 *   取第一个会把条件当成效果贴上去。
 */
export function linkedEffectUuid(descriptionHtml: string | null | undefined): string | null {
    const links = [...String(descriptionHtml ?? "").matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)];
    const hit = links.find(([, , label]) => /^\s*Effect:/i.test(label));
    return hit?.[1] ?? null;
}

/** 施加时要填的 origin。**填错不报错**，见文件顶部。 */
export interface OriginRefs {
    actorUuid: string;
    itemUuid: string;
    tokenUuid?: string | null;
}

/**
 * 组装要写进目标身上的效果数据。
 *
 * ★ 两个标记都要打：
 *   - `flags.pf2e.origin` —— pf2e 靠它回答"这是谁贴的"（谓词直接读它）；
 *   - `flags.player-action-ui-hub.autoApplied` —— 我们自己贴的，将来要认得出来
 *     （与范围效果那边同一个标记，清理时一视同仁）。
 */
export function buildMarkEffect(effectSource: any, origin: OriginRefs): any {
    const data = foundry.utils.deepClone(effectSource);
    foundry.utils.setProperty(data, "flags.pf2e.origin", {
        actor: origin.actorUuid,
        item: origin.itemUuid,
        token: origin.tokenUuid ?? null,
    });
    foundry.utils.setProperty(data, "flags.player-action-ui-hub.autoApplied", true);
    return data;
}

/**
 * 把效果贴到目标身上；同名的先撤掉。
 *
 * ★ **"换目标"就是这一步自带的**：撤旧贴新，我们不必代记上一个是谁。
 * ⚠ 撤旧只撤**我们自己贴的、且 origin 是我**的那些 ——
 *   别人贴的同名效果不归我们管，删掉就是替别人做决定。
 */
export async function applyMark(
    target: any,
    effectSource: any,
    origin: OriginRefs,
): Promise<MarkResult> {
    const targetName = String(target?.name ?? "?");
    try {
        // ⚠ 改别人的 actor：改不动就如实报告，不静默跳过（同 area-effects）
        if (!target?.canUserModify?.((globalThis as any).game?.user, "update")) {
            return { applied: false, targetName, reason: "You don't have permission to modify that creature — the GM has to apply it." };
        }
        const slug = String(effectSource?.system?.slug ?? effectSource?.name ?? "");
        const 旧 = (target.itemTypes?.effect ?? []).filter((e: any) =>
            (e?.slug === slug || e?.name === effectSource?.name)
            && e?.flags?.["player-action-ui-hub"]?.autoApplied
            && e?.flags?.pf2e?.origin?.actor === origin.actorUuid);
        if (旧.length) await target.deleteEmbeddedDocuments("Item", 旧.map((e: any) => e.id));

        await target.createEmbeddedDocuments("Item", [buildMarkEffect(effectSource, origin)]);
        return { applied: true, targetName, reason: null };
    } catch (err) {
        console.error("player-action-ui-hub | applyMark 失败", err);
        return { applied: false, targetName, reason: "Something went wrong — see the console." };
    }
}

/**
 * 撤掉**我贴在别人身上**的同一个效果（换目标时用）。
 * 返回撤掉了几个。
 */
export async function clearMarks(
    tokens: any[],
    effectName: string,
    actorUuid: string,
    exceptActorId?: string | null,
): Promise<number> {
    let n = 0;
    for (const t of tokens) {
        const a = t?.actor;
        if (!a || a.id === exceptActorId) continue;
        if (!a.canUserModify?.((globalThis as any).game?.user, "update")) continue;
        const 旧 = (a.itemTypes?.effect ?? []).filter((e: any) =>
            e?.name === effectName
            && e?.flags?.["player-action-ui-hub"]?.autoApplied
            && e?.flags?.pf2e?.origin?.actor === actorUuid);
        if (!旧.length) continue;
        await a.deleteEmbeddedDocuments("Item", 旧.map((e: any) => e.id));
        n += 旧.length;
    }
    return n;
}
