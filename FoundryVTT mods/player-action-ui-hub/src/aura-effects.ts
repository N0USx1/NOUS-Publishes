/**
 * 我们自己带的 Aura 效果配置。
 *
 * ★ **为什么要自己带**（2026-08-05 批量对齐引擎库 + 11 次实测得出）：
 *
 *   pf2e 的 Aura 规则元素**是可用的**（有网格的场景下实测扩散成功），
 *   但**几乎没有法术配了它**：1993 个法术 → 450 个有 area → emanation 133 个
 *   → 29 个链接了 Spell Effect → **只有 3 个自带 Aura**（Bless / Benediction /
 *   Incendiary Aura）。吟游诗人那一整族 anthem 全都没有。
 *
 *   所以缺的不是机制而是配置。这里补的就是配置 —— **一条代码都不用写**，
 *   套上去之后扩散、进出范围、到期清理**全归 pf2e 管**。
 *
 * ★ **这张表只登记"推不出来的那一样"：受众**。
 *   半径、特性、效果 UUID 全部**从法术本体读**（见 `auraPlanFor`）——
 *   抄进代码的字段是一份会静默腐坏的副本：写下那一刻看着对，之后与正本分叉且不报错。
 *   实测代价：我抄的 8 条里 traits **错了 7 条**（重制版 anthem 已无 `auditory`，
 *   改成 emotion/mental），半径漏了升阶覆盖。
 *
 * ⚠ **只收"无豁免的盟友增益"**。需要豁免的（Bane / Malediction / Roar of the Dragon）
 *   **不在这里** —— 它们的规则原文是"敌人必须通过 Will 豁免，否则……"，
 *   用 aura 直接套等于**跳过豁免**，那是把规则算错了。那些走 area-effects.ts 的路径 B。
 *
 * ⚠ 受众**逐个读规则原文确认过**，不是从字段推的：
 *   实测"按效果数值符号推受众"在 4 个可对拍样本里错了 2 个（50%），不可用。
 */

import { radiusAtRank, rankOf, linkedSpellEffectUuid } from "./spell-data";

/** 一个法术的受众登记。**只有这一样推不出来**，其余全从法术读。 */
export interface AuraSpec {
    /** 法术 slug */
    slug: string;
    /** 显示名，出问题时好认 */
    name: string;
    /** 给谁 —— 这张表存在的唯一理由 */
    affects: "allies" | "enemies" | "all";
    /** 规则原文依据 —— 受众是照它定的，改之前先看这句 */
    rule: string;
}

/**
 * 吟游诗人的 composition 与同类盟友增益。
 *
 * ⚠ `Shielding Formation` **不在这里**：它的规则是"每个**在回合结束时**位于光环内的盟友"，
 *   带时机条件，aura 的"在范围内即生效"表达不了。硬套会给出比规则更宽的结果。
 */
export const AURA_SPECS: AuraSpec[] = [
    {
        slug: "courageous-anthem", name: "Courageous Anthem", affects: "allies",
        rule: "You and all allies in the area gain a +1 status bonus to attack rolls, damage rolls, and saves against fear effects.",
    },
    {
        slug: "rallying-anthem", name: "Rallying Anthem", affects: "allies",
        rule: "You and all allies in the area gain a +1 status bonus to AC and saving throws against fear.",
    },
    {
        slug: "triple-time", name: "Triple Time", affects: "allies",
        rule: "You and all allies in the area gain a +10-foot status bonus to all Speeds.",
    },
    {
        slug: "song-of-strength", name: "Song of Strength", affects: "allies",
        rule: "You and all allies in the area gain a +1 status bonus to Athletics checks.",
    },
    {
        slug: "valiant-anthem", name: "Valiant Anthem", affects: "allies",
        rule: "You and all allies in the area gain a +10-foot status bonus to Speeds and a +1 status bonus to attack rolls.",
    },
    {
        slug: "silvers-refrain", name: "Silver's Refrain", affects: "allies",
        rule: "Weapon and unarmed attacks by allies in the area are treated as silver.",
    },
    {
        slug: "frenzied-revelry", name: "Frenzied Revelry", affects: "allies",
        rule: "You and your allies gain a +1 status bonus to saving throws against mental effects while in the area.",
    },
    {
        slug: "coiling-dance", name: "Coiling Dance", affects: "allies",
        rule: "Your allies in the area are filled with sacred energy, making their spells and attacks holy.",
    },
];

/** 按法术 slug 找登记；没有就是"这个法术我们不接管"。 */
export function auraSpecFor(slug: string | null | undefined): AuraSpec | null {
    if (!slug) return null;
    return AURA_SPECS.find(s => s.slug === slug) ?? null;
}

/** 从法术读出来的、真正拿去建 aura 的那组值。 */
export interface AuraPlan {
    spec: AuraSpec;
    radius: number;
    traits: string[];
    effectUuid: string;
}

/**
 * 这个法术能不能走 aura 路径；能的话，值全部从它自己身上取。
 *
 * @returns 取不齐（没登记 / 没 area / 没自带效果）一律返回 null ——
 *          **不猜、不兜底**：兜出来的 aura 会安静地套上一个错的东西。
 */
export function auraPlanFor(spell: any): AuraPlan | null {
    const spec = auraSpecFor(spell?.slug ?? null);
    if (!spec) return null;
    const radius = radiusAtRank(spell, rankOf(spell));
    if (!radius) return null;
    const effectUuid = linkedSpellEffectUuid(spell);
    if (!effectUuid) return null;
    const traits: string[] = [...(spell?.system?.traits?.value ?? [])];
    return { spec, radius, traits, effectUuid };
}

/**
 * 生成要套到**施法者自己**身上的那个 effect 的数据。
 *
 * ★ 关键是 `effects[].affects` 与**不带** `predicate` ——
 *   pf2e 自带的 Bless aura 有一条 `self:signature:{item|origin.signature}` predicate，
 *   实测（含补齐 origin）**始终不扩散**；不带 predicate 的配置一次就成。
 */
export function buildAuraEffect(plan: AuraPlan, casterLevel: number): Record<string, unknown> {
    const { spec, radius, traits, effectUuid } = plan;
    return {
        name: `${spec.name} (Aura)`,
        type: "effect",
        img: "icons/svg/aura.svg",
        system: {
            description: {
                value: `<p>${spec.rule}</p><p><em>Applied by Player Action UI Hub.</em></p>`,
            },
            // ⚠ 持续时间跟着法术走；anthem 族都是 1 轮，靠玩家每轮重施
            duration: { value: 1, unit: "rounds", expiry: "turn-start", sustained: false },
            level: { value: casterLevel },
            tokenIcon: { show: true },
            rules: [{
                key: "Aura",
                radius,
                traits,
                slug: `pauih-aura-${spec.slug}`,
                effects: [{ uuid: effectUuid, affects: spec.affects }],
            }],
        },
        flags: { "player-action-ui-hub": { autoApplied: true, auraFor: spec.slug } },
    };
}
