/**
 * 动作编排器（②段 · 乙类「一个动作展开成多次判定」）。
 *
 * ★ **目的地是 Nous 2026-08-05 定的那一句**：
 *   "u only need to attack, and the macros / ui of my making will ask u what u wanna
 *    infuse and what outcome will be calculated base on game's rule"
 *   拆成三件可验收的事：**入口只有一个** · **中间由 UI 问** · **结算归规则**。
 *
 * ★ **为什么做成通用编排器而不是逐条写**：
 *   职业清单里的乙类是**同一个形状** —— 武僧连击、魔战士 Spellstrike、
 *   死灵指挥爪牙、召唤师 Act Together，全都是"一个入口 → 若干次询问 → 按规则结算"。
 *   官方全部留白不是疏忽，是规则元素模型天生表达不了"多次判定"
 *   （`docs/2026-08-04-pf2e-class-inventory.md` 乙类）。
 *   逐条写会长出四套彼此不认识的 UI；写成一串步骤则**轮盘的钻取本身就是编排器**。
 *
 * ⚠ **丙类（反击/勇者反应那类）不并进来**：它们的难点是"一半发生在别人身上"，
 *   是跨角色时机问题，与"多次判定"不是一回事。混做会把两个问题绑死。
 *
 * ⚠ 编排器**只负责问和调**，一次判定该加多少减多少**一概不算** ——
 *   每一击的 MAP 由 pf2e 按那件武器自己算好（实测徒手带敏捷是 -4/-8 而非 -5/-10，
 *   标签里就写着）。我们只挑档位。
 */
import type { ActorPF2e } from "foundry-pf2e";
import { linkedEffectUuid, applyMark, clearMarks } from "./marks";
import type { SectorData, WheelLevel } from "./types";
import { strikesOf, strikeSectorId } from "./collectors/strikes";

/** 编排过程中攒下来的选择。 */
export interface MacroContext {
    /** 每一步选中的扇区 id，按步骤顺序 */
    picks: string[];
    /** 翻选条的当前档位（连击用它当**起始 MAP**） */
    variantIndex: number;
    /**
     * 触发这次编排的那个 item 的 id。
     * ★ 按**特性**登记的宏（如指挥官战术）必须知道玩家点的是哪一条 ——
     *   一个宏覆盖几十条战术，靠它才分得清。
     */
    itemId?: string;
}

/** 编排里的一步：给玩家看一层盘，收一个选择。 */
export interface MacroStep {
    /** 这一层的标题 */
    title: (actor: ActorPF2e, ctx: MacroContext) => string;
    /** 这一步能选什么；空数组表示这一步走不下去 */
    options: (actor: ActorPF2e, ctx: MacroContext) => SectorData[];
    /** 这一步要不要翻选条（连击的第一步用它选起始 MAP） */
    variantLabels?: (actor: ActorPF2e, ctx: MacroContext) => string[] | undefined;
    /**
     * 这一步是**多选目标**：点一个累加、再点取消，选完点「Done」进下一步。
     *
     * ★ Nous 2026-08-05 在三个方案里选了这个（累加 + 确认格）：
     *   另两个都要**从规则散文里解析出"该选几个"** —— 那正是今天已经证明会出错的那类
     *   （触发条件、"要选谁"都不在数据里）。累加式不依赖任何推不出来的东西。
     */
    multiTarget?: boolean;
}

/** 一个被我们接管的动作。 */
export interface ActionMacro {
    /**
     * 对应 item 的 slug。与 `trait` 二选一 ——
     * slug 认一条，trait 认一整类。
     */
    slug?: string;
    /**
     * 按**特性**认一整类（如 `tactic`：指挥官的全部战术）。
     *
     * ★ 实测指挥官战术**共享 `tactic` 特性**，而且形态一致
     *   （"Signal up to two/three squadmates…"）—— 逐条登记要写几十条且随版本增加，
     *   按特性登记一条就够。这与"别为每个宏写 UI"是同一个道理，再往上抽一层。
     */
    trait?: string;
    name: string;
    steps: MacroStep[];
    /** 全部选完之后真正执行 */
    run: (actor: ActorPF2e, ctx: MacroContext, ev: Event) => Promise<void>;
    /**
     * 这个动作**除了它自己掷出的那些**，还额外算几次攻击（G9）。
     *
     * ★ 为什么需要：MAP 档位靠**数攻击掷骰消息**推出来（见 attacks.ts），
     *   而 Spellstrike 只掷一次武器攻击，规则却说它"**算作两次攻击**"。
     *   不补这一次，轮盘就会一边在汇总卡里写"这算两次攻击"、
     *   一边把翻选条停在第二档 —— **自己跟自己矛盾**，比两边都错更糟。
     *
     * ⚠ 这确实是**一条规则**写进了代码。可以接受的理由是：
     *   同一条规则已经写在 `run` 的提示文案里了，这里只是让显示与提示一致，
     *   **没有引入新的规则知识**。写第二条之前先想清楚是不是又在抄规则书。
     */
    extraAttacks?: number;
}

/* ── 武僧连击 ────────────────────────────────── */

/**
 * 徒手打击。
 *
 * ★ 判据是 `item.category === "unarmed"`（实测），不是武器名字、也不是 `unarmed` 特性 ——
 *   特性只回答"这次攻击算不算徒手"，category 回答"这件东西是不是徒手武器"。
 *   两个问题的主语不同。
 */
export function unarmedStrikes(actor: ActorPF2e): { strike: any; id: string }[] {
    return strikesOf(actor)
        .map((s, i) => ({ strike: s, id: strikeSectorId(s, i) }))
        .filter(x => (x.strike as any)?.item?.category === "unarmed");
}

function 徒手扇区(actor: ActorPF2e): SectorData[] {
    return unarmedStrikes(actor).map(({ strike, id }) => ({
        id,
        label: (strike as any).label ?? (strike as any).item?.name ?? "Unarmed",
        img: (strike as any).item?.img,
        cost: null,
        state: (strike as any).ready === false ? "gated" : "normal",
        reason: (strike as any).ready === false ? "Not available right now." : undefined,
        variantLabels: ((strike as any).variants ?? []).map((v: any) => v.label),
    })) as SectorData[];
}

/**
 * 第 n 击该用哪一档。
 *
 * ★ 规则原文："**Apply your multiple attack penalty to the Strikes normally.**"
 *   即连击不豁免 MAP —— 第一击用起始档，第二击用下一档。
 *
 * ⚠ 上限是**档位数减一**，不是写死的 2：档位数由 pf2e 给（实测 3 档），
 *   写死等于把它的规则抄一份进来。
 */
export function variantIndexFor(start: number, nth: number, variantCount: number): number {
    return Math.min(Math.max(start, 0) + nth, Math.max(variantCount - 1, 0));
}

export const FLURRY_OF_BLOWS: ActionMacro = {
    slug: "flurry-of-blows",
    name: "Flurry of Blows",
    steps: [
        {
            title: () => "Flurry · 1st Strike",
            options: (actor) => 徒手扇区(actor),
            // 翻选条在**第一步**：选的是这次连击的起始 MAP，不是单独某一击的
            variantLabels: (actor) => unarmedStrikes(actor)[0]?.strike?.variants?.map((v: any) => v.label),
        },
        {
            title: () => "Flurry · 2nd Strike",
            // ⚠ 第二步照样列**全部**徒手打击 —— 规则是"两次徒手打击"，
            //   没说必须不同。同一只拳头打两下是合法的，不要替玩家排除。
            options: (actor) => 徒手扇区(actor),
        },
    ],
    async run(actor, ctx, ev) {
        const 全部 = unarmedStrikes(actor);
        const 取 = (id: string) => 全部.find(x => x.id === id)?.strike;
        const a = 取(ctx.picks[0]);
        const b = 取(ctx.picks[1]);
        if (!a || !b) {
            ui.notifications.warn("Those strikes are no longer available — reopen the wheel.");
            return;
        }
        const { rollStrike } = await import("./executor");
        // ⚠ **顺序执行，不并发**：两击共享 MAP 序列，掷骰顺序在聊天记录里要是对的。
        await rollStrike(actor, ctx.picks[0], variantIndexFor(ctx.variantIndex, 0, a.variants?.length ?? 3), ev);
        await rollStrike(actor, ctx.picks[1], variantIndexFor(ctx.variantIndex, 1, b.variants?.length ?? 3), ev);

        /*
         * ★ 规则里还有一句我们**做不到**的："If both hit the same creature, combine their
         *   damage for the purpose of resistances and weaknesses."
         *   pf2e 是逐次结算伤害的，合并抗性需要人来判。
         *
         * ⚠ 做不到就**说出来**，不要默默略过 —— 略过等于让玩家以为规则已经算过了。
         *   （能不能自动判"两击都命中同一目标"没验：没选目标时消息里
         *     `context.outcome` 是空的，实测确认。所以这里不假装能判。）
         */
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor as any }),
            content: `<p><strong>Flurry of Blows</strong></p>`
                + `<p>If both Strikes hit the same creature, combine their damage `
                + `<em>before</em> applying resistances and weaknesses.</p>`,
        });
    },
};

export function macroFor(slug: string | null | undefined): ActionMacro | null {
    if (!slug) return null;
    return MACROS.find(m => m.slug === slug) ?? null;
}

/**
 * 按 item 找宏：**先认 slug，再认特性**。
 *
 * ⚠ 顺序不能反：某条战术将来若要特调，登记一条 slug 宏就能盖过通用的那条。
 *   反过来的话特调永远轮不上。
 */
export function macroForItem(item: { slug?: string | null; traits?: string[] } | null | undefined): ActionMacro | null {
    if (!item) return null;
    const 按slug = macroFor(item.slug ?? null);
    if (按slug) return 按slug;
    const traits = item.traits ?? [];
    return MACROS.find(m => m.trait && traits.includes(m.trait)) ?? null;
}

/* ── 通用步骤：选目标 ────────────────────────── */

/** 选目标那一步的扇区 id 前缀。编排器认这个前缀，选中即设为目标。 */
export const TARGET_PREFIX = "tgt:";

export type TargetSide = "enemies" | "allies" | "any";

/**
 * 场上可选的目标。
 *
 * ★ **为什么要有这一步**（Nous 2026-08-05）：
 *   > "这个 spellstrike 的绑定法术 和这种多目标的应该是要做成 ui 化 >
 *   >  我们的轮盘 ui 应该会询问玩家要用那个"
 *
 *   在这之前 Spellstrike **依赖玩家事先手动选好目标** —— 没选就读不出成功度。
 *   那等于把一步隐含要求留在轮盘外面，与"入口只有一个"的目的地相违。
 *
 * ★ 敌我**用 pf2e 自己的判断**（`actor.isEnemyOf`），不自己算 —— 那是规则问题。
 *
 * ⚠ **距离只在有网格的场景显示**：无网格下 pf2e 的距离不可信
 *   （2026-08-05 实测：十次 aura 实验因此全部得出错误结论）。
 *   宁可不显示，也不要给一个看起来正常的错数。
 *
 * ⚠ 一个 actor 在场上**可能有多个 token**（实测该角色有两个）——
 *   所以"排除自己"要按 actor 比，不是按 token 比。
 */
/**
 * @param includeSelf 把**施法者自己**也列进来。
 *
 * ⚠⚠ 默认排除自己，是因为这个函数最早是给 Spellstrike 写的 —— 那里不该打自己。
 *   但**范围增益不是这样**：Bless / Courageous Anthem 的目标原文就是
 *   "**you** and allies in the area"，把自己漏掉就漏了规则里明写的一个目标。
 *   ⇒ 2026-08-08 实测发现的不一致：范围 buff 的预选把自己选上了（0 ft 当然在范围内），
 *     而这一层的名单里没有自己 —— **界面上看不到的一个目标却真的会被贴上效果**。
 *   ★ 那正是"名单与实际不一致"最坏的一种：它不报错，只是悄悄多贴一个人。
 */
export function targetOptions(
    actor: ActorPF2e,
    side: TargetSide = "any",
    multi = false,
    includeSelf = false,
): SectorData[] {
    try {
        const 画布: any = canvas;
        const 全部: any[] = 画布?.tokens?.placeables ?? [];
        const 我: any = 全部.find(t => t?.actor?.id === (actor as any)?.id);
        const 有网格 = Number(画布?.scene?.grid?.type ?? 0) > 0;
        const 已选: Set<any> = (game as any)?.user?.targets ?? new Set();

        return 全部
            .filter(t => t?.actor && t.isVisible !== false
                && (includeSelf || t.actor.id !== (actor as any)?.id))
            .filter(t => {
                if (side === "any") return true;
                const 敌 = (actor as any)?.isEnemyOf?.(t.actor) === true;
                return side === "enemies" ? 敌 : !敌;
            })
            .map((t): SectorData => {
                const d = 有网格 && 我?.distanceTo ? Math.round(我.distanceTo(t)) : null;
                const 敌 = (actor as any)?.isEnemyOf?.(t.actor) === true;
                return {
                    id: `${TARGET_PREFIX}${t.id}`,
                    label: String(t.name ?? "?"),
                    img: t.document?.texture?.src ?? undefined,
                    cost: null,
                    /*
                     * ★★ **敌我要进毂**（Nous 2026-08-08 实测报的："还可以电疗友军"）。
                     *   目标格有 token 图 ⇒ 扇区上只画图标、不画字，于是这一格**长得都一样** ——
                     *   谁是敌谁是友完全看不出来，误选一个友军的代价是一发法术。
                     * ⛔ 原来这份信息写在 `detail` 里，而说明区 2026-08-08 整块拿掉之后
                     *   `detail` **根本不画** —— 信息还在数据里，屏幕上却没有。
                     *   ★ 那是最难发现的一种坏法：写的人以为给了，用的人从没见过。
                     * ⚠ 距离只在算得准（有网格）时给；敌我一律给 —— 那是规则判断，无网格也成立。
                     */
                    hubNotes: [[敌 ? "⚔ Enemy" : "✚ Ally", d !== null ? `${d} ft` : null]
                        .filter(Boolean).join("  ·  ")],
                    // ★ 已经选中的标出来 —— 多数时候玩家早就选好了，一眼确认比重选快
                    badge: 已选.has(t) ? "◎" : undefined,
                    state: "normal",
                };
            })
            .concat(multi ? [完成格()] : []);
    } catch (err) {
        console.error("player-action-ui-hub | targetOptions 失败", err);
        return [];
    }
}

/**
 * 多选时的「选完了」格。
 *
 * ★ **计数印在格子上**：选了几个必须看得见 —— 多选界面最常见的毛病就是
 *   玩家不确定自己到底选中了几个，只能退出去数。
 * ⚠ 一个都没选时**灰显但仍可点**（三态守则"提示不是锁"），
 *   点了给一句说明，比一个点不动的死格子强。
 */
function 完成格(): SectorData {
    const n = targetCount();
    return {
        id: TARGET_DONE,
        label: "Done",
        cost: null,
        detail: n === 1 ? "1 target selected" : `${n} targets selected`,
        badge: n > 0 ? String(n) : undefined,
        state: n > 0 ? "normal" : "gated",
        reason: n > 0 ? undefined : "Pick at least one target first.",
    };
}

/** 多选时那个「选完了」格子的 id。 */
export const TARGET_DONE = `${TARGET_PREFIX}__done`;

/**
 * 把某个扇区选中的 token 设为目标。
 *
 * ★ 由编排器**统一处理**（认 `tgt:` 前缀），所以任何宏加一个选目标的步骤就能用，
 *   不用各写一份。
 *
 * @param multi 多选步骤：**累加并可再点取消**，不清掉别的；单选则替换。
 * @returns 处理了返回 true（编排器据此决定要不要推进）
 */
export function applyTargetPick(sectorId: string, multi = false): boolean {
    if (!sectorId.startsWith(TARGET_PREFIX) || sectorId === TARGET_DONE) return false;
    const id = sectorId.slice(TARGET_PREFIX.length);
    const t: any = ((canvas as any)?.tokens?.placeables ?? []).find((x: any) => x?.id === id);
    if (!t) return false;
    if (!multi) { t.setTarget(true, { releaseOthers: true }); return true; }
    /*
     * ★ **再点一次取消**（Nous 2026-08-05 选了 A 方案：累加 + 确认格）。
     *   没有"取消"的多选是个陷阱：点错一个就只能退出整个编排重来。
     * ⚠ `releaseOthers: false` —— 多选的全部意义就在于不清掉别的。
     */
    const 已选 = ((game as any)?.user?.targets ?? new Set()).has(t);
    t.setTarget(!已选, { releaseOthers: false });
    return true;
}

/** 当前选了几个目标。多选步骤要把它显示出来 —— 选了几个必须看得见。 */
export function targetCount(): number {
    return ((game as any)?.user?.targets ?? new Set()).size ?? 0;
}

/* ── 魔战士 Spellstrike ──────────────────────── */

/**
 * 能拿来 Spellstrike 的法术。
 *
 * ★ 判据**逐条出自规则原文**（从 pf2e 自带的 Spellstrike 活动里读出来的，不是我记的）：
 *   > "You cast a spell that **takes 1 or 2 actions** to cast and
 *   >  **requires either a spell attack roll or a saving throw**."
 *
 *   两条筛选缺一不可：
 *   - `system.time.value` 是 `"1"` 或 `"2"`（实测就是这个字段；`actionCost` 恒为 null）
 *   - `isAttack === true`（实测 Phase Bolt / Ignition / Telekinetic Projectile 为真）
 *     **或** `system.defense.save.statistic` 有值（实测 Glass Shield 是 reflex）
 *
 * ⚠ 不筛"有没有伤害"：规则说的是要攻击骰或豁免，不是要伤害。
 *   加一条规则里没有的筛选，会把合法选项从玩家眼前删掉。
 */
export function spellstrikeSpells(actor: ActorPF2e): { entry: any; spell: any; id: string }[] {
    const out: { entry: any; spell: any; id: string }[] = [];
    for (const entry of (actor as any)?.spellcasting?.contents ?? []) {
        if (!entry?.statistic) continue;          // 没有施法数值的条目（物品之类）跳过
        for (const spell of entry.spells?.contents ?? []) {
            const time = String(spell?.system?.time?.value ?? "");
            if (time !== "1" && time !== "2") continue;
            const 要攻击 = spell?.isAttack === true;
            const 要豁免 = !!spell?.system?.defense?.save?.statistic;
            if (!要攻击 && !要豁免) continue;
            out.push({ entry, spell, id: `ss:${entry.id}:${spell.id}` });
        }
    }
    return out;
}

/** 近战打击 —— 规则写明是 "**melee** Strike"。 */
export function meleeStrikes(actor: ActorPF2e): { strike: any; id: string }[] {
    return strikesOf(actor)
        .map((s, i) => ({ strike: s, id: strikeSectorId(s, i) }))
        .filter(x => (x.strike as any)?.item?.isMelee === true);
}

/** pf2e 的 `degreeOfSuccess` 是 0-3。 */
export const DEGREE = ["criticalFailure", "failure", "success", "criticalSuccess"] as const;

export const SPELLSTRIKE: ActionMacro = {
    slug: "spellstrike",
    // 规则：Spellstrike 算作两次攻击。它自己只掷一次武器攻击，所以补一次
    extraAttacks: 1,
    name: "Spellstrike",
    steps: [
        {
            /*
             * ★ **先问打谁**（Nous 2026-08-05："轮盘 ui 应该会询问玩家要用那个"）。
             *   在这之前 Spellstrike 依赖玩家事先手动选好目标 —— 没选就读不出成功度，
             *   等于把一步隐含要求留在轮盘外面。
             * ⚠ 已经选中的那个带 ◎ 记号：多数时候玩家早就选好了，一眼确认比重选快。
             */
            title: () => "Spellstrike · Target",
            options: (actor) => targetOptions(actor, "enemies"),
        },
        {
            title: () => "Spellstrike · Spell",
            options: (actor) => spellstrikeSpells(actor).map(({ spell, id }) => ({
                id,
                label: spell.name,
                img: spell.img,
                cost: String(spell?.system?.time?.value ?? "1") as SectorData["cost"],
                // 让玩家一眼看出这条走哪个分支 —— 两条分支的结算完全不同
                detail: spell.isAttack
                    ? "Uses the Strike's roll"
                    : `Target saves (${spell?.system?.defense?.save?.statistic})`,
                state: "normal",
            })) as SectorData[],
        },
        {
            title: () => "Spellstrike · Strike",
            options: (actor) => meleeStrikes(actor).map(({ strike, id }) => ({
                id,
                label: String(strike.label ?? "?"),
                img: strike.item?.img,
                cost: null,      // 消耗记在 Spellstrike 活动上（2 个动作），不是这一击
                state: strike.ready === false ? "gated" : "normal",
                reason: strike.ready === false ? "Not drawn." : undefined,
                variantLabels: (strike.variants ?? []).map((v: any) => v.label),
            })) as SectorData[],
            // 翻选条放在打击这一步：选的是这一击用第几档
            variantLabels: (actor) => meleeStrikes(actor)[0]?.strike?.variants?.map((v: any) => v.label),
        },
    ],
    async run(actor, ctx, ev) {
        const 法 = spellstrikeSpells(actor).find(x => x.id === ctx.picks[1]);
        const 击 = meleeStrikes(actor).find(x => x.id === ctx.picks[2]);
        if (!法 || !击) {
            ui.notifications.warn("That spell or strike is no longer available — reopen the wheel.");
            return;
        }

        const { rollStrike, rollStrikeDamage } = await import("./executor");
        const 提示: string[] = [];

        // ① 施放 —— 法术照常消耗法术位，但**不按常规结算**
        //    （规则原文："imbue its effects into an attack instead of executing the spell normally"）
        await 法.entry.cast(法.spell, { rank: 法.spell.rank });

        // ② 掷这一击。**只掷一次** —— 规则要求用这一次的结果同时决定打击和法术。
        const idx = Math.max(0, Math.min(ctx.variantIndex, (击.strike.variants?.length ?? 1) - 1));
        const 结果: any = await rollStrike(actor, ctx.picks[2], idx, ev);
        const degree: string | null = DEGREE[结果?.degreeOfSuccess ?? -1] ?? null;

        /*
         * ⚠ **没选目标就算不出成功度**（实测：没有目标时 `variant.roll()` 返回值里
         *   `degreeOfSuccess` 为 null，消息 context 里也没有 outcome；选了目标才有）。
         *   那种情况**不猜**：如实说一句，让玩家自己按结果处理。
         */
        if (!degree) {
            提示.push("No target was selected, so the Strike's degree of success is unknown — resolve the spell manually.");
        } else if (degree === "success" || degree === "criticalSuccess") {
            /*
             * ★★ **打击本身的伤害**（Nous 2026-08-07 实测缺的就是这一半）：
             *   Spellstrike 是**一次打击** —— 命中就照常算武器伤害，
             *   法术伤害是**另加**的。原来只掷了法术那份，
             *   玩家还得自己回角色卡再点一次武器伤害。
             * ⚠ 必须在下面分支**之前**掷：不管法术是攻击型还是豁免型，
             *   武器伤害都照算，两条支线都要。
             */
            const 出了 = await rollStrikeDamage(actor, ctx.picks[2], idx, ev,
                                                degree === "criticalSuccess");
            if (!出了) 提示.push("Roll the weapon damage from your sheet — this strike didn't expose a damage roll.");
        }

        if (!degree) {
            // 上面已经说过了
        } else if (法.spell.isAttack) {
            // ③-A 需要攻击骰的法术：用打击的结果
            if (degree === "success" || degree === "criticalSuccess") {
                await rollSpellDamage(法.spell);
                if (degree === "criticalSuccess") {
                    // ⚠ pf2e 的法术卡片**没有"暴击伤害"按钮**（实测只有一个 spell-damage），
                    //   法术的暴击翻倍发生在**应用伤害**那一步。做不到就说出来，不假装做了。
                    提示.push("Critical hit — double the spell's damage when applying it.");
                }
            } else {
                提示.push(degree === "criticalFailure"
                    ? "The Strike critically failed, so the spell has no effect."
                    : "The Strike missed, so the spell has no effect.");
            }
        } else {
            /*
             * ③-B 需要豁免的法术。规则原文：
             *   "the target rolls its saving throw normally **regardless of your attack
             *    roll's result**, unless your Strike was a critical failure"
             * ⚠ 所以这里**不能**照搬 A 分支的"没打中就没效果" —— 那是把规则算错了。
             */
            提示.push(degree === "criticalFailure"
                ? "The Strike critically failed, so the spell is lost."
                : "The target rolls its saving throw normally — the Strike's result does not change it.");
        }

        // ④ MAP：规则原文"算两次攻击，但**打完之后**才施加"。系统不记 MAP，我们也不记，
        //    所以把它说出来 —— 这正是本模组的活：把要记的东西挪到眼前。
        提示.push("This counted as two attacks for your multiple attack penalty, applied from now on.");

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor as any }),
            content: `<p><strong>Spellstrike</strong> — ${法.spell.name}</p><p>${提示.join("<br>")}</p>`,
        });
    },
};

/**
 * 掷法术伤害。
 *
 * ⚠ **事件里的 shift 要反解**，与 `executor.ts` 的 `intentEvent` 同一套：
 *   传一个空事件的话 `rollDamage` 会弹出 Damage Roll 加值框等人 ——
 *   实测整个调用不返回，卡死。
 */
async function rollSpellDamage(spell: any): Promise<void> {
    try {
        const skipDefault = !game.user?.settings?.showCheckDialogs;
        const ev = new PointerEvent("click", { shiftKey: !skipDefault, ctrlKey: false, metaKey: false });
        Object.defineProperty(ev, "target", { value: document.body });
        await spell.rollDamage(ev);
    } catch (err) {
        console.error("player-action-ui-hub | 掷法术伤害失败", err);
    }
}

/* ── 指挥官战术（按**特性**认一整类）────────────── */

/**
 * 指挥官的战术。
 *
 * ★ **一条宏覆盖全部战术**，靠的是它们共享 `tactic` 特性（实测）。
 *   形态也一致 —— 规则原文一律是 "Signal (up to N) squadmate(s)…"：
 *     Strike Hard! → "Signal **a** squadmate"
 *     Buckle-Cut Blitz / Wait For It… → "Signal **up to two** squadmates"
 *     Pop, Drop, and Lock → "Signal **up to three** squadmates"
 *     For Talmandor! → "for **each** squadmate in your banner's aura"
 *   四种数量形态，**累加+确认**一套通吃 —— 这正是不去解析"该选几个"的好处：
 *   那个数只写在散文里（实测 `actionspf2e` 里**没有任何动作**的 target 字段带数量）。
 *
 * ⚠ **我们不替盟友行动**：规则说的是"被信号的盟友**自己**做某事（多为反应）"。
 *   玩家侧通常也改不动别人的 actor（权限跟着执行代码的用户走）。
 *   所以这个宏做的是**把信号发出去并点名是谁** —— 剩下的归那些玩家/GM。
 *   假装替他们掷骰会比不做更糟：他们会以为已经做过了。
 */
export const COMMANDER_TACTIC: ActionMacro = {
    trait: "tactic",
    name: "Tactic",
    steps: [
        {
            title: () => "Signal squadmates",
            // 盟友，多选 —— 规则允许几个由玩家按规则自己掌握
            options: (actor) => targetOptions(actor, "allies", true),
            multiTarget: true,
        },
    ],
    async run(actor, ctx) {
        const item: any = (actor as any)?.items?.get?.(ctx.itemId ?? "");
        const 名 = item?.name ?? "Tactic";
        const ids = String(ctx.picks[0] ?? "").split(",").filter(Boolean);
        const 名单 = ids
            .map(id => ((canvas as any)?.tokens?.placeables ?? []).find((t: any) => t?.id === id)?.name)
            .filter(Boolean);

        // 先把战术本身的卡片发出去（规则文本、消耗、特性都在里面，我们不复述）
        try { await (game as any).pf2e.rollItemMacro(item?.uuid); } catch { /* 没有 uuid 就只发下面那张 */ }

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: actor as any }),
            content: `<p><strong>${名}</strong></p>`
                + (名单.length
                    ? `<p>Signalled: ${名单.join(", ")}.</p>`
                      + `<p>Each signalled squadmate acts on their own turn or reaction — this card is the signal, not their roll.</p>`
                    : `<p>No squadmate was signalled.</p>`),
        });
    },
};

/**
 * 被接管的动作表。先按 slug 查，再按特性查（见 `macroForItem`）。
 *
 * ⚠ 放在文件末尾：`const` 不提升，登记表必须排在它引用的那些宏**之后**。
 */
/* ── 守护者 Taunt / 秘械师 Exploit Vulnerability ───
 *
 * ★ 两条共用一个宏体：**选一个敌人 → 把动作自带的效果贴到它身上**。
 *   效果 uuid 从动作**自己的描述**里取（见 marks.ts），一条登记都不用写。
 * ★ "换目标要清掉上一个"是**免费的**：贴新的之前撤掉我贴在别处的同名效果。
 *   我们不代记"上一个是谁" —— 那份状态就挂在别人身上，去找就是了。
 */
function 指名一个敌人(name: string): ActionMacro["run"] {
    return async (actor, ctx) => {
        const itemId = ctx.itemId;
        const item: any = itemId ? (actor as any).items?.get(itemId) : null;
        const uuid = linkedEffectUuid(item?.system?.description?.value);
        if (!uuid) {
            ui.notifications.warn(`${name}: this action doesn't link an effect, so there's nothing to apply.`);
            return;
        }
        const 目标token = 令牌(ctx.picks[0]);
        if (!目标token?.actor) {
            ui.notifications.warn(`${name}: that creature is no longer on the scene.`);
            return;
        }
        const src: any = await fromUuid(uuid);
        if (!src) {
            ui.notifications.warn(`${name}: the linked effect could not be loaded.`);
            return;
        }
        const 我token = (canvas as any)?.tokens?.placeables?.find((t: any) => t?.actor?.id === (actor as any).id);
        const origin = {
            actorUuid: String((actor as any).uuid),
            itemUuid: String(item?.uuid ?? ""),
            tokenUuid: 我token?.document?.uuid ?? null,
        };
        // 先清掉我贴在别人身上的同一个 —— 换目标自带清除
        await clearMarks((canvas as any)?.tokens?.placeables ?? [], src.name, origin.actorUuid,
                         目标token.actor.id);
        const 结果 = await applyMark(目标token.actor, src.toObject(), origin);
        await 报告(actor, name, 结果);
    };
}

/** 从 `tgt:<tokenId>` 取回令牌。 */
function 令牌(pick: string | undefined): any {
    if (!pick?.startsWith(TARGET_PREFIX)) return null;
    const id = pick.slice(TARGET_PREFIX.length);
    return (canvas as any)?.tokens?.placeables?.find((t: any) => t?.id === id) ?? null;
}

/**
 * 把结果贴进聊天栏。
 * ⚠ **失败也要说**：贴不上去（多半是权限）时静默收场，玩家会以为生效了。
 */
async function 报告(actor: ActorPF2e, name: string, r: { applied: boolean; targetName: string; reason: string | null }) {
    const 行 = r.applied
        ? `<p><strong>${name}</strong> — ${r.targetName} is now marked.</p>`
        : `<p><strong>${name}</strong> — could not mark ${r.targetName}: ${r.reason}</p>`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: actor as any }),
        content: 行,
    });
}

export const TAUNT: ActionMacro = {
    slug: "taunt",
    name: "Taunt",
    steps: [{ title: () => "Taunt · Target", options: (actor) => targetOptions(actor, "enemies") }],
    run: 指名一个敌人("Taunt"),
};

export const EXPLOIT_VULNERABILITY: ActionMacro = {
    slug: "exploit-vulnerability",
    name: "Exploit Vulnerability",
    steps: [{ title: () => "Exploit Vulnerability · Target", options: (actor) => targetOptions(actor, "enemies") }],
    run: 指名一个敌人("Exploit Vulnerability"),
};

export const MACROS: ActionMacro[] = [FLURRY_OF_BLOWS, SPELLSTRIKE, COMMANDER_TACTIC, TAUNT, EXPLOIT_VULNERABILITY];

/** 把某一步铺成一层盘面。步骤走不下去（没东西可选）时返回 null。 */
export function levelForStep(
    actor: ActorPF2e,
    macro: ActionMacro,
    stepIndex: number,
    ctx: MacroContext,
): WheelLevel | null {
    const step = macro.steps[stepIndex];
    if (!step) return null;
    const sectors = step.options(actor, ctx);
    // ⚠ 多选步骤即使"一个目标都没有"也不能返回 null —— 那会让编排直接跳过这一步。
    //   有没有可选目标是场上的事，与步骤存不存在无关。
    if (!sectors.length) return null;
    const labels = step.variantLabels?.(actor, ctx);
    return {
        title: step.title(actor, ctx),
        canGoBack: true,
        sectors,
        variant: labels && labels.length > 1 ? { index: ctx.variantIndex, labels } : undefined,
    };
}
