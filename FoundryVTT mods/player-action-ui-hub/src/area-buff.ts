/**
 * 范围法术**贴效果**那条链的判据层（Nous 2026-08-08）。
 *
 * > 目标是 "ui 提交请求 → place radius（透明的）→ 确认 → 自动给所有友军贴 buff"。
 *
 * ★★ **为什么这里有一张手写的表** —— 先说清楚，因为本项目删过一张腐坏的表
 *   （`CLASS_RESOURCES`，见 class-state.ts）。
 *
 *   我扫了 `pf2e.spells-srd` **全部 1993 个法术**找结构化判据，四条候选**全军覆没**：
 *
 *   | 想用的判据 | 实测 | 结论 |
 *   |---|---|---|
 *   | 法术自带 rules 发 effect | 1993 个里只有 **11** 个有 rules，且全是 `DamageDice`/`DamageAlteration` | 法术**不自己发** effect |
 *   | 无存骰 ⇒ 增益 | `Black Tentacles`(attack) / `Reverse Gravity` / `Spike Stones` 都无存骰 | ✗ |
 *   | 有存骰 ⇒ 敌对 | `Life's Fresh Bloom`（治疗）**有** fortitude 存骰 | ✗ |
 *   | 目标文本提 ally/enemy | 带 area 且带 effect 的 61 个里，**53 个目标文本是空串（87%）** | ✗ |
 *
 *   ⇒ **pf2e 里没有任何字段说"这个范围法术该贴给友军还是敌军"**。
 *     系统自己也不判：角色卡的做法是贴一张卡，玩家把 effect 拖到人身上。
 *
 * ★ Nous 的结论（2026-08-08）：
 *   > "那么只能自己去收集，一点一点的去做了，这没有办法，这种批量覆盖肯定会出错。"
 *
 *   ⇒ 于是这张表**只登记那一样推不出来的东西**（贴给谁），而且
 *   **表里没有的绝不猜** —— 走手选那条路（每个目标玩家自己点）。
 *   ★ 这与 `CLASS_RESOURCES` 的区别正在这里：那张表存的是**会变的值**
 *     （哪条资源、叫什么），所以会腐坏；这张表存的是**规则事实**
 *     （Bless 给友军、Bane 给敌军），它只在 Paizo 改规则时才变。
 *   ⚠ effect 本身**一律现读**（从法术描述里的 UUID 解），表里不存 UUID ——
 *     存了就又变成一份会静默过期的副本。
 */

/** 范围法术的效果该贴给哪一边。 */
export type BuffSide = "allies" | "enemies";

/**
 * 一个法术的效果贴给谁。
 *
 * - `allies` / `enemies`：**范围**法术，按半径预选那一边（Bless / Bane / anthem）；
 * - `targets`：**单体**法术，贴给玩家在「选目标」那一步选中的人（Haste / Heroism / Fly）；
 * - `self`：**自身**法术，贴给施法者自己（Sure Strike）——它不选目标，
 *   所以没有确认那一步，施放完直接挂。
 *
 * ★★ 三类合一张表，是因为它们答的是**同一个问题**（"这法术的效果给谁"），
 *   只是给法不同。分几张表就有几个真相源 —— 加一条时要想"该往哪张加"，
 *   而想错了不会报错，只会那条法术悄悄不生效。
 */
export type ApplyTo = BuffSide | "targets" | "self";

/**
 * 范围法术的贴附对象登记表。**一条一条验过再加**。
 *
 * ⚠ 加一条之前先在真实世界里跑一遍：法术描述里确实只有一个
 *   `Compendium.pf2e.spell-effects.Item.*`，且那个 effect 就是该贴的那个。
 *   （实测每个法术恰好 1 个 UUID，所以现在不用消歧；**哪天遇到 2 个的，
 *   在这里加消歧字段，别在提取函数里猜。**）
 * ⚠ 键是 pf2e 的 `system.slug`，不是名字 —— 名字跟着语言包变。
 */
export const SPELL_EFFECT_APPLY: Record<string, ApplyTo> = {
    // 2026-08-08 实测：emanation15，effect = "Spell Effect: Bless"
    bless: "allies",
    // 2026-08-08 实测：emanation10，effect = "Spell Effect: Bane"
    bane: "enemies",

    /*
     * —— 吟游诗人的赞歌（Nous 2026-08-08 点名："这个 anthem，戏称绿屁，
     *    因为朋友玩 bard 每次都放整个屏幕变绿"）——
     *
     * ★ 这一族正是这条路最该覆盖的：**每回合都在放、范围大、贴的人多**。
     *   Courageous Anthem 是 emanation **60 尺** —— 手动一个个点友军正是他说的那个痛点。
     * ⚠ 同族里 **Dirge of Doom / Counter Performance 没有 effect item**（实测效果数 0），
     *   所以登记了也没用（`areaBuffOf` 会在 UUID 那关返回 null）—— 索性不登记，
     *   免得下一个人以为它们已经接上了。
     * ⚠ `Allegro` 是 `1 ally` 的单体法术、没有 area，走的是「选目标」那条路，不属这里。
     */
    "courageous-anthem": "allies",   // emanation60，effect = "Spell Effect: Courageous Anthem"
    "rallying-anthem": "allies",     // emanation60，effect = "Spell Effect: Rallying Anthem"
    "valiant-anthem": "allies",      // emanation30，effect = "Spell Effect: Valiant Anthem"

    /*
     * —— 单体增益：贴给「选目标」那一步选中的人 ——
     *
     * ⚠ 这一类原来是**整条断的**：选完目标、法术也放出去了，
     *   但 `Spell Effect: Haste` 从来没挂上 —— 玩家还得自己去纲要里拖一次。
     *   ★ 而且它不报错，法术卡照常发出去，看着像成了（2026-08-08 扫描时发现）。
     * ⚠ 只登记**确认过描述里恰好一个 effect** 的；`targets` 不需要判敌我，
     *   目标是玩家自己点的 —— 所以这一类比范围那类安全得多。
     */
    haste: "targets",                // effect = "Spell Effect: Haste"
    heroism: "targets",              // effect = "Spell Effect: Heroism"
    fly: "targets",                  // effect = "Spell Effect: Fly"

    /*
     * —— 自身增益：不选目标，施放完直接挂到自己身上 ——
     * ⚠ 这一类的 `targetingOf` 是 `none`（没有射程 ⇒ 作用于自己），
     *   所以它**不经过确认层** —— 也不需要：目标只有一个而且不会选错。
     */
    "sure-strike": "self",           // effect = "Spell Effect: Sure Strike"
};

/*
 * ⛔ **考察过但故意不登记的**（免得下一个人重新查一遍）：
 *   - `electric-arc` / `fear` / `slow` / `enfeeble` / `synesthesia` / `invisibility`
 *     —— 实测**效果数 0**：pf2e 这些用 condition 不用 effect，没东西可贴，
 *        走「选目标 + 确认」那条路就够了；
 *   - `tailwind` —— 描述里有**两个** effect（`Tailwind` / `Tailwind (8 hours)`），
 *     该由人选哪个。`spellEffectUuidOf` 会因此返回 null，自动退回手动，**不用特判**；
 *   - `dirge-of-doom` / `counter-performance` —— 同族 anthem，但效果数 0。
 */

/**
 * ⛔ 旧名 `AREA_BUFF_SIDE` 已并入上面那张表（2026-08-08）。
 *   两类（范围/单体）答的是同一个问题，分两张表就是两个真相源。
 */

/**
 * 范围内的候选目标该怎么给出来。
 *
 * ★★ **两条路，取决于场景有没有网格**（判据出自 macros.ts 那条老教训：
 *   > "距离只在有网格的场景显示：无网格下 pf2e 的距离不可信
 *   >  —— 2026-08-05 实测，十次 aura 实验因此全部得出错误结论。"）
 *
 *   - `auto`：有网格 ⇒ 距离算得准，按半径圈出来**替玩家预选**，他只需过目确认；
 *   - `manual`：无网格 ⇒ **算不准就不算**，把人全列出来让他自己点。
 *
 * ⚠ 这不是"降级"，是**同一条原则的两种实现**：算得准的替他做，算不准的不装作算得准。
 *   给一份看起来正常的错名单，比让他多点几下坏得多 —— 那正是他说的
 *   "这种批量覆盖肯定会出错"。
 */
export type AreaPickMode = "auto" | "manual";

/**
 * 这一次范围贴附该用哪种方式挑人。
 *
 * ⚠ 只认 `emanation`：它以施法者为中心，**位置不用玩家放**，半径一算就知道圈到谁。
 *   burst / cone / line 要玩家先摆模板，而模板圈到谁又没有公开 API（实测
 *   `MeasuredTemplate` 上只有私有的 `_getGridHighlightPositions`）——
 *   ⇒ 那几类一律 `manual`，别硬算。
 *   ★ 目前登记表里 5 条全是 emanation，所以这条限制现在不吃亏。
 */
export function areaPickMode(
    area: { type?: string; value?: number } | null | undefined,
    hasGrid: boolean,
): AreaPickMode {
    if (!hasGrid) return "manual";
    return area?.type === "emanation" && Number(area?.value) > 0 ? "auto" : "manual";
}

/** `spellEffectUuidOf` 只认这一点形状，方便单测。 */
export interface SpellDescLike {
    system?: {
        slug?: string | null;
        description?: { value?: string } | null;
    } | null;
}

/**
 * 从法术描述里取它对应的 **spell effect** 的 UUID。
 *
 * ★ 这是 pf2e 唯一给出这层关系的地方：描述正文里嵌着
 *   `@UUID[Compendium.pf2e.spell-effects.Item.XXXX]`。
 *   全库 431 个法术有它，其中带 area 的 61 个。
 *
 * ⚠ **只认 `spell-effects` 这个包**：描述里还会引用条件、其它法术、装备……
 *   放宽到"任意 Compendium UUID"会抓回一堆不是效果的东西。
 * ⚠ 去重后**多于一个就返回 null**：实测目前每个法术恰好一个，
 *   真出现两个说明这条需要人来消歧 —— 那时宁可退回手动，也不要挑一个看起来对的。
 */
export function spellEffectUuidOf(spell: SpellDescLike | null | undefined): string | null {
    const desc = String(spell?.system?.description?.value ?? "");
    if (!desc) return null;
    const hit = desc.match(/Compendium\.pf2e\.spell-effects\.Item\.[A-Za-z0-9]+/g) ?? [];
    const 去重 = [...new Set(hit)];
    return 去重.length === 1 ? 去重[0] : null;
}

/**
 * 这个法术能不能走"放模板 → 批量贴效果"那条快路。
 *
 * @returns 能走时给出 `{ effectUuid, side }`；**任何一处不确定都返回 null**，
 *   由调用方退回"逐个手选"——那条路永远是安全兜底。
 */
export function effectApplyOf(spell: SpellDescLike | null | undefined):
        { effectUuid: string; applyTo: ApplyTo } | null {
    const slug = String(spell?.system?.slug ?? "");
    if (!slug) return null;
    const applyTo = SPELL_EFFECT_APPLY[slug];
    if (!applyTo) return null;                  // 没登记 ⇒ 不猜
    const effectUuid = spellEffectUuidOf(spell);
    if (!effectUuid) return null;               // 描述里找不到唯一的效果 ⇒ 不猜
    return { effectUuid, applyTo };
}

/**
 * 只要**范围**那一类（`allies` / `enemies`）—— 单体的走「选目标」那条路，不在这里。
 * ⚠ 单体也会贴效果，但那一步在确认之后，见 main.ts 的施放段。
 */
export function areaBuffOf(spell: SpellDescLike | null | undefined):
        { effectUuid: string; side: BuffSide } | null {
    const r = effectApplyOf(spell);
    // ⚠ 白名单式收窄，不是"排除 targets" —— 以后再加类型时，
    //   排除式会把新类型**默默放进来**（新类型多半也不该走范围预选）。
    if (r?.applyTo !== "allies" && r?.applyTo !== "enemies") return null;
    return { effectUuid: r.effectUuid, side: r.applyTo };
}
