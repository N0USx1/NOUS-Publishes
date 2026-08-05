/**
 * 从法术本体读值。
 *
 * ★ 这个文件存在的理由：**凡是法术身上有的，都从这里读，不许抄进代码**。
 *   抄一份就是造一个会静默腐坏的副本 —— 实测代价见 cortex foundry pitfalls F 节
 *   （抄的 8 条 traits 错了 7 条，UUID 编了 5 条）。
 *
 * 两条范围路径（aura / save）共用这里，所以它不属于其中任何一个。
 */

/**
 * 升阶后的半径。
 *
 * ★ **不能直接读 `system.area.value`** —— 实测（Frenzied Revelry 5→10→15）
 *   升阶半径存在 `system.heightening.levels[阶].area.value` 这张**覆盖表**里，
 *   **不会落到基础字段上**。读基础字段拿到的是"没应用升阶的值"，
 *   而它在最常见的基础阶下正好是对的，所以平时测不出来。
 *
 * ⚠ 覆盖表按阶给点，不是每阶都有 —— 取**不超过施放阶数的最高那一档**。
 */
export function radiusAtRank(spell: any, rank: number | null | undefined): number | null {
    const 基础 = Number(spell?.system?.area?.value);
    const 覆盖 = spell?.system?.heightening?.levels;
    let 值 = Number.isFinite(基础) ? 基础 : null;
    if (覆盖 && rank) {
        const 命中 = Object.keys(覆盖)
            .map(Number).filter(n => Number.isFinite(n) && n <= rank)
            .sort((a, b) => a - b).at(-1);
        const v = 命中 != null ? Number(覆盖[String(命中)]?.area?.value) : NaN;
        if (Number.isFinite(v)) 值 = v;
    }
    return 值;
}

/** 这次施放的实际阶数。pf2e 自己算好了，不要推算提升环位。 */
export function rankOf(spell: any): number | null {
    const r = Number(spell?.rank ?? spell?.system?.level?.value);
    return Number.isFinite(r) ? r : null;
}

/** 这次施放的豁免 DC（法术自己带着它的施法数值）。 */
export function spellDC(spell: any): number | null {
    const dc = spell?.spellcasting?.statistic?.dc?.value;
    return typeof dc === "number" ? dc : null;
}

/**
 * 法术描述里链接的那个 Spell Effect 的 UUID。
 *
 * ★ **判据是 `Spell Effect:` 前缀**，不是"第一个 effect 链接"。
 *   实测 spell-effects 包 523 条里：`Spell Effect:` **512**、`Effect:` 5、`Aura:` 等 6。
 *   那 5 条 `Effect:` 是**冷却/免疫标记**（`Effect: Shield Immunity`）；
 *   Shield 同时链接了两个，取"第一个"会**把冷却当增益套上去**。
 *
 * ⚠ 这个函数只回答"链接的是哪个 effect"，**不回答"该套给谁"**。
 *   同一个链接，Bless 是套给盟友，Roar of the Dragon 是套给施法者自己
 *   （实测它那条 effect 里只有 `FlatModifier:diplomacy`，是施法者的加值）。
 *   受众要么另行登记，要么读规则原文 —— 从这个字段推不出来。
 */
export function linkedSpellEffectUuid(spell: any): string | null {
    const desc = String(spell?.system?.description?.value ?? "");
    const links = [...desc.matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)];
    const hit = links.find(([, uuid, label]) =>
        uuid.includes("spell-effects") && /^\s*Spell Effect:/i.test(label));
    return hit?.[1] ?? null;
}
