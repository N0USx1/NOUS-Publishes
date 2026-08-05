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
import type { SectorData, WheelLevel } from "./types";
import { strikesOf, strikeSectorId } from "./collectors/strikes";

/** 编排过程中攒下来的选择。 */
export interface MacroContext {
    /** 每一步选中的扇区 id，按步骤顺序 */
    picks: string[];
    /** 翻选条的当前档位（连击用它当**起始 MAP**） */
    variantIndex: number;
}

/** 编排里的一步：给玩家看一层盘，收一个选择。 */
export interface MacroStep {
    /** 这一层的标题 */
    title: (actor: ActorPF2e, ctx: MacroContext) => string;
    /** 这一步能选什么；空数组表示这一步走不下去 */
    options: (actor: ActorPF2e, ctx: MacroContext) => SectorData[];
    /** 这一步要不要翻选条（连击的第一步用它选起始 MAP） */
    variantLabels?: (actor: ActorPF2e, ctx: MacroContext) => string[] | undefined;
}

/** 一个被我们接管的动作。 */
export interface ActionMacro {
    /** 对应 item 的 slug */
    slug: string;
    name: string;
    steps: MacroStep[];
    /** 全部选完之后真正执行 */
    run: (actor: ActorPF2e, ctx: MacroContext, ev: Event) => Promise<void>;
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

/** 被接管的动作表。按 slug 查。 */
export const MACROS: ActionMacro[] = [FLURRY_OF_BLOWS];

export function macroFor(slug: string | null | undefined): ActionMacro | null {
    if (!slug) return null;
    return MACROS.find(m => m.slug === slug) ?? null;
}

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
    if (!sectors.length) return null;
    const labels = step.variantLabels?.(actor, ctx);
    return {
        title: step.title(actor, ctx),
        canGoBack: true,
        sectors,
        variant: labels && labels.length > 1 ? { index: ctx.variantIndex, labels } : undefined,
    };
}
