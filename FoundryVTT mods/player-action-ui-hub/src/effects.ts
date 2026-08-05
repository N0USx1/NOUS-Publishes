import type { ActorPF2e } from "foundry-pf2e";

/**
 * 效果自动化（②段第一步：**只做自身效果**）。
 *
 * ★ **为什么做**（Nous 2026-08-05）：施放 Shield 之后要手动去聊天卡片上点一下
 *   才能把盾套到自己身上。一场战斗下来 GM 给 3-10 个人反复套、buff 每回合失效再套一遍，
 *   纯粹是把机械劳动摊给人。这正是本模组的根理：**把负担从人脑挪到数据能证明的地方**。
 *
 * ★ **为什么做得到**（实测取证）：pf2e 把效果做成 compendium 里独立的 Effect item，
 *   法术只在描述里 `@UUID` 链接过去。链接是结构化的、Effect 自带 duration 与规则元素、
 *   系统的 `removeExpiredEffects` 又会自动清理到期的 —— **零件齐全，只是没人接起来**。
 *   （`docs/2026-08-05-效果自动化调研.md`）
 *
 * ⚠ **本文件只处理"套给施法者自己"**。给队友/范围内目标套要路由到对那个 actor
 *   有权限的客户端（模组是世界级调度层，见调研文档），那是下一步，不在这里。
 */

/** 判定用的最小法术形状。 */
export interface SpellShape {
    /** `system.target.value`，实测无目标时是空字符串或缺失 */
    target?: string | null;
    /** `system.area`，实测形如 `{type:"emanation", value:60}` */
    area?: unknown;
}

/**
 * 这个法术是不是"施放即作用于自己"。
 *
 * ★ 判据取自实测：**既没有 target 也没有 area** 的才是
 *   （Shield 两者皆空；Heroism/Haste 是 `1 creature`；Bless/Courageous Anthem 有 emanation）。
 *
 * ⚠ 保守起见宁可漏不可错：判不准的一律当成"不是自身"，
 *   最多是玩家照旧手动点一下，而套错人是要去撤销的。
 */
export function isSelfTargeted(spell: SpellShape): boolean {
    const hasTarget = !!(spell.target && String(spell.target).trim());
    return !hasTarget && !spell.area;
}

/**
 * 从法术描述里取出"施放时该套上"的那个 effect 的 UUID。
 *
 * ★ **判据是 `Spell Effect:` 前缀**，不是"第一个 effect 链接"。
 *   实测 spell-effects 包 523 条里：`Spell Effect:` **512**、`Effect:` 5、`Aura:` 等 6。
 *
 * ⚠ 那 5 条 `Effect:` 是**冷却/免疫标记**（`Effect: Shield Immunity`、
 *   `Effect: Guidance Immunity`）。Shield 同时链接了两个 ——
 *   取"第一个链接"在别的法术上碰巧对，在 Shield 上就会**把冷却当增益套上去**，
 *   玩家会以为自己被禁用了。
 *
 * ⚠ `Aura:` 也排除：那是持续光环，不是施放即得的效果。
 */
export function selfEffectUuid(description: string): string | null {
    const links = [...String(description ?? "").matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)];
    const hit = links.find(([, uuid, label]) =>
        uuid.includes("spell-effects") && /^\s*Spell Effect:/i.test(label));
    return hit?.[1] ?? null;
}

/**
 * 把一个 effect 套到 actor 身上。
 *
 * @returns 套上了返回 effect 名，没套返回 null（**不抛错**：
 *          自动化失败不该打断玩家已经掷出去的那次施法）。
 */
export async function applyEffect(actor: ActorPF2e | null, uuid: string): Promise<string | null> {
    try {
        if (!actor) return null;
        // ⚠ 先确认真的改得动：模组跑在客户端，权限跟着**执行代码的那个用户**走，
        //   服务端 `canUserModify` 会拒（`dist/database/backend/server-backend.mjs` 实读）。
        //   自己的角色通常有权限；没有就安静放弃，让玩家照旧手动点。
        if (!(actor as any).canUserModify?.(game.user, "update")) return null;

        const doc: any = await fromUuid(uuid);
        if (!doc) return null;
        const data = doc.toObject();
        // 记一笔来源，方便将来做"撤销自动套上的效果"
        foundry.utils.setProperty(data, "flags.player-action-ui-hub.autoApplied", true);
        await (actor as any).createEmbeddedDocuments("Item", [data]);
        return doc.name ?? null;
    } catch (err) {
        console.error("player-action-ui-hub | applyEffect 失败", err);
        return null;
    }
}

/**
 * 施放之后：**如果这个法术作用于施法者自己**，就把它的效果套上。
 *
 * ⚠ 不满足条件时什么都不做，也不报错 —— 目标类/范围类法术照旧走玩家手动，
 *   在没做完路由之前**不假装自己能处理**。
 */
export async function applySelfEffectAfterCast(
    actor: ActorPF2e | null,
    spell: any,
): Promise<string | null> {
    try {
        const shape: SpellShape = {
            target: spell?.system?.target?.value ?? null,
            area: spell?.system?.area ?? null,
        };
        if (!isSelfTargeted(shape)) return null;

        const uuid = selfEffectUuid(String(spell?.system?.description?.value ?? ""));
        if (!uuid) return null;
        return await applyEffect(actor, uuid);
    } catch (err) {
        console.error("player-action-ui-hub | applySelfEffectAfterCast 失败", err);
        return null;
    }
}
