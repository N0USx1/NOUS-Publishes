/**
 * G10 · **反应窗口提示**（Nous 2026-08-07 定的立场落地）。
 *
 * > "发生了事件 → 玩家因为机制被触发 → 玩家选择/被动发出指令 ——
 * >  按照囊括『玩家发出的指令』的前提，这部分是应该做的。"
 *
 * ★★ **两件事必须分开，分不开就变成抄规则书**：
 *
 *   | | 谁做 |
 *   |---|---|
 *   | 判断"够不够近、在不在光环里、算不算操作动作" | **玩家**（那句话我们已经显示给他了） |
 *   | 事件发生后，把**触发词对得上**的反应摆出来问一句 | **我们** |
 *
 *   第二件只要**观测事件**，不需要理解事件。所以这里全部是**词法匹配**：
 *   拿聊天消息的类型去对触发条件那段散文里的措辞，对上就摆出来。
 *   ⛔ 这里**永远不许**出现距离、光环、视线一类的判断。
 *
 * ★ 边界（丙类调研 §4.2 实测，104 条带触发段的反应）：
 *   - pf2e 只发 **8 个钩子**，没有"检定结算前"那一个 → 结算前插入做不到；
 *   - 攻击/施法/伤害/检定**都发结构化聊天消息**（带 `outcome`、`target`）→ 事后看得见；
 *   - **16 条的触发事件根本不广播**（含最常用的 `Reactive Strike`）→ 无解，
 *     那一批由**反应分类**（G7）交回玩家，不在这里。
 *
 * ★ 下面 7 条模式是**对着全量语料调出来的**，不是拍脑袋写的：
 *   104 条里 **51 条**能被归类，勇者那 7 条誓约反应分得干干净净
 *   （`Retributive Strike` / `Glimpse of Redemption` / `Liberating Step` /
 *   `Flash of Grandeur` → allyDamaged；`Iron Command` / `Selfish Shield` /
 *   `Destructive Vengeance` → meDamaged）。
 *
 * ⚠ 词法匹配必然有假阳性与假阴性，**这是设计上接受的**：
 *   摆错一格，玩家看一眼触发条件就知道不适用；漏掉一格，反应分类里照样找得到。
 *   为了把匹配做"准"而去解析语义，就走回抄规则书那条路了。
 */

/** 一次可观测事件的种类。 */
export type EventKind =
    | "allyDamaged"      // 盟友被打/受伤
    | "meHit"            // 我被击中
    | "meDamaged"        // 我受伤
    | "spellCast"        // 有人施法
    | "myCheckFailed"    // 我的检定/豁免失败
    | "myAttackMissed"   // 我的攻击落空
    | "foeAttackFailed"; // 敌人的攻击失手

/**
 * 触发条件里对应各类事件的措辞。
 *
 * ⚠ `you\b(?!r)` 那几处**不能省**：`damages your ally` 里也含 "you"，
 *   不挡住 "your" 的话，勇者的四条盟友反应会同时被判成"我受伤"，
 *   于是每次盟友挨打都弹一堆用不上的东西。（第一版实测就是这么错的。）
 */
export const TRIGGER_PATTERNS: Record<EventKind, RegExp> = {
    allyDamaged: /(damages?|deals?\s+damage\s+to|harms?)[^.]{0,45}\byour\s+(ally|allies|eidolon|companion|minion)\b|\b(ally|allies|eidolon)\b[^.]{0,70}\btakes?\b[^.]{0,25}damage/i,
    meHit: /(hits?\s+you\b(?!r)|hit\s+(with|by)\s+(a|an)\b|Strikes?\s+you\b(?!r)|Strike\s+(hits|against)\s+you\b(?!r)|targeted\s+by\s+a\s+Strike)/i,
    meDamaged: /(damages?|deals?\s+damage\s+to)\s+you\b(?!r)|\byou\s+(take|takes|would\s+take|are\s+dealt)\b[^.]{0,45}damage|reduced\s+to\s+0\s+Hit\s+Points/i,
    spellCast: /Casts?\s+a\s+Spell|Activates?\s+an\s+Item/i,
    myCheckFailed: /\byou\s+(fail|critically\s+fail)[^.]{0,60}(saving\s+throw|check|save)\b/i,
    myAttackMissed: /\byou\s+(miss|critically\s+fail)[^.]{0,40}(Strike|attack)\b/i,
    foeAttackFailed: /(critically\s+fails?|misses)[^.]{0,60}(Strike|attack)\b/i,
};

/** 这条触发条件对得上哪几类事件。对不上返回空数组。 */
export function kindsForTrigger(trigger: string | null | undefined): EventKind[] {
    const t = String(trigger ?? "");
    if (!t) return [];
    return (Object.keys(TRIGGER_PATTERNS) as EventKind[]).filter(k => TRIGGER_PATTERNS[k].test(t));
}

/** 从聊天消息里读出的最小事实。 */
export interface MessageFacts {
    /** `flags.pf2e.context.type` */
    type?: string | null;
    /** 掷骰者的 actor id */
    rollerId?: string | null;
    /** 目标的 actor id（实测四成攻击消息没有目标） */
    targetId?: string | null;
    /** `criticalSuccess` / `success` / `failure` / `criticalFailure` */
    outcome?: string | null;
}

/** 判定敌我/自己要用到的上下文。**由外部提供**，这个模块不碰 Foundry。 */
export interface WatchContext {
    /** 我自己（轮盘正在驱动的那个 actor）的 id */
    meId: string;
    /** 这个 actor 是不是我的盟友（不含我自己） */
    isAlly: (actorId: string) => boolean;
}

/**
 * 这条消息落成哪几类事件。
 *
 * ⚠ **自己掷的攻击不该触发"我被击中"**：不排除的话，玩家每打一下
 *   都会被自己的攻击弹一次窗。判据是掷骰者是不是我。
 * ⚠ **命中与否要看 outcome**：`failure` 的攻击是"没打中"，
 *   把它算成 meHit 会在每次敌人落空时弹出挨打才能用的反应。
 */
export function classify(facts: MessageFacts, ctx: WatchContext): EventKind[] {
    const 出: EventKind[] = [];
    const 我掷的 = facts.rollerId != null && facts.rollerId === ctx.meId;
    const 打我 = facts.targetId != null && facts.targetId === ctx.meId;
    const 打盟友 = facts.targetId != null && facts.targetId !== ctx.meId && ctx.isAlly(facts.targetId);
    const 命中 = facts.outcome === "success" || facts.outcome === "criticalSuccess";
    const 落空 = facts.outcome === "failure" || facts.outcome === "criticalFailure";

    if (facts.type === "attack-roll") {
        if (!我掷的 && 打我 && 命中) 出.push("meHit");
        if (!我掷的 && 落空) 出.push("foeAttackFailed");
        if (我掷的 && 落空) 出.push("myAttackMissed");
    }
    if (facts.type === "damage-roll") {
        if (!我掷的 && 打我) 出.push("meDamaged", "meHit");
        if (!我掷的 && 打盟友) 出.push("allyDamaged");
    }
    if (facts.type === "spell-cast" && !我掷的) 出.push("spellCast");
    if ((facts.type === "saving-throw" || facts.type === "skill-check") && 我掷的 && 落空) {
        出.push("myCheckFailed");
    }
    return [...new Set(出)];
}

/** 一个候选反应：只要名字与触发条件，其余由调用方带着。 */
export interface ReactionLike {
    id: string;
    label: string;
    /** 已经解析好的触发条件（`triggers.ts` 的产物） */
    trigger?: string | null;
}

/**
 * 这些事件下，哪几条反应的触发词对得上。
 *
 * ⚠ **没有触发条件的一律不摆**：那类条目我们无从判断它在等什么，
 *   摆出来只是噪音。它仍然在反应分类里，玩家找得到。
 */
export function matchReactions<T extends ReactionLike>(reactions: T[], kinds: EventKind[]): T[] {
    if (!kinds.length) return [];
    const 要 = new Set(kinds);
    return reactions.filter(r => kindsForTrigger(r.trigger).some(k => 要.has(k)));
}
