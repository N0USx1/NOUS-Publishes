/**
 * **施法编排框架**（Nous 2026-08-08）。
 *
 * > "我希望你这个是做成一个 spellcasting 的框架，这样别的法术可以直接套用。"
 *
 * 一次完整的施法不是"点一下就完了"，而是一串**有先后、有节奏**的步骤：
 *
 * ```
 *   选目标（有上限）→ 确认 → 施放 → 每个目标摇 save → 摇伤害 → 贴 effect
 *                                   └────── 每条消息之间隔开 ──────┘
 * ```
 *
 * ★★ 做成框架而不是给 Electric Arc 写特例，是因为**每一条法术都会用到其中几步**，
 *   而步骤之间的顺序与节奏是共通的。逐个法术手搓的下场已经见过一次：
 *   Spellstrike 就是手搓的，于是它那套"消息一起蹦出来"的毛病**只在它身上修得掉**。
 *
 * ⚠ 本模块**只管规划，不碰 Foundry**（纯函数、可单测）。
 *   真正去掷骰/发消息的那一半在 `executor.ts` —— 那边要调 pf2e 的 API，
 *   而那些 API 必须实测过才能写（本项目吃过太多次"看起来对的调用"的亏）。
 */

/**
 * 两条聊天消息之间至少隔多久（毫秒）。
 *
 * ★ Nous 2026-08-08："所有的 chatlog 会一并蹦出，最好是每一条间隔 2s"
 *   → 实测之后收到 **1s**（"间隔那个还是 1s 就够了"）。
 *   ⚠ 这个数是**手感**，不是算出来的 —— 所以它必须是一个改一处就全生效的常量，
 *     而不是散在各个 await 里的字面量。
 *   ★ 这不是美观问题：一次 Electric Arc 会连着发**施法卡 + N 个目标的豁免 + 伤害**，
 *     全挤在同一瞬间刷出来时，桌上其他人**根本来不及看清哪一条对应谁** ——
 *     而豁免结果恰恰是所有人都要读的那条。
 * ⚠ 这个值也该给 Spellstrike 用（它有同样的毛病），所以放在框架里而不是某个分支里。
 *
 * ⛔⛔ **不要改成"合并成一条消息"**（2026-08-08 讨论过并否决）：
 *   pf2e-toolbelt 的 TargetHelper 用 `createMessage: false` + `Promise.all`，
 *   把 N 个目标的豁免结果塞回同一条消息的 flag —— 根本不产生多条，因此不需要节流。
 *   技术上更"干净"，**但 Nous 明确不要**：
 *   > "我们 1s 的间隔给一种很自然是玩家在 roll 的感觉，我觉得很好，
 *   >  他那种太机械化了。"
 *   ★ 所以这一秒**不是在缓解刷屏**，是在**模拟一个人依次掷骰**的节奏 ——
 *     它是产品意图，不是权宜之计。一条一条出来，桌上的人跟着看，
 *     那正是线下骰子落桌的感觉；一次性汇总成一张表就没有这回事了。
 *   ⚠ 顺带：Toolbelt **无许可证**（`license: null`，依赖的 foundry-helpers 也是），
 *     它的代码一行都不能抄 —— 这里只是记下"那条路存在且我们不走"。
 */
export const CHAT_GAP_MS = 1000;

/**
 * 这个法术最多能选几个目标；**解析不出来就返回 null（= 不限制）**。
 *
 * ★★ 这里**确实在读那句英文**，而我在 `spell-target.ts` 里说过"不解析目标文本"——
 *   两处不矛盾，因为问的不是同一件事：
 *     - 那边要判**敌我**，那是规则语义，散文里读不出来，读错会贴错人；
 *     - 这里只取**一个数字上限**，而且**读错的代价是可控的**（见下面两条兜底）。
 *
 * ⚠ 兜底一：**取文本里最大的那个数**。实测的写法都符合：
 *   `1 creature` → 1、`1 or 2 creatures` → 2、`1 to 3 willing creatures` → 3、
 *   `up to 5 willing living creatures` → 5。
 * ⚠ 兜底二：**一个数字都没有就不限制**（`you and allies in the area` 这类）。
 *   宁可不拦，也不要拦错 —— 那是 playbook 13「提示不是锁」的同一条。
 * ⚠ 兜底三：调用方把它当**提示**用（超了给一句话），不做硬性禁止：
 *   规则里有太多"每提升 2 环多 1 个目标"的写法，写死上限迟早拦掉合法操作。
 */
export function maxTargetsOf(targetText: string | null | undefined): number | null {
    const t = String(targetText ?? "");
    if (!t.trim()) return null;
    const 数 = (t.match(/\d+/g) ?? []).map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (!数.length) return null;
    return Math.max(...数);
}

/**
 * **多动作型**：这个法术可以投入几个动作？
 *
 * ★ Nous 2026-08-08：
 *   > "多动作型：法术可以重复施法 = 玩家投入的动作数量 → ui 询问需要多少动作，
 *   >  点击数量确定（查 force barrage 和 firebolt）"
 *
 * ★★ 判据是**结构化字段**，不是英文：`system.time.value` 实测就是 `"1 to 3"`
 *   （Force Barrage —— 它就是 remaster 之前的 Magic Missile）。
 *   全库分布：`"1"` 246 条、`"2"` 1099 条、`"3"` 211 条、`"reaction"` 95 条，
 *   而 **`"X to Y"` 这种只有 30 条** —— 正是这一类。
 *
 * @returns `{ min, max }`；不是这一类就返回 null（照常一次施完）。
 * ⚠ 只认 `数字 to 数字`：`"1 minute"` / `"10 minutes"` / `"reaction"` 都不该命中。
 */
export function actionRangeOf(timeValue: string | null | undefined):
        { min: number; max: number } | null {
    const m = String(timeValue ?? "").trim().match(/^(\d+)\s+to\s+(\d+)$/);
    if (!m) return null;
    const min = Number(m[1]), max = Number(m[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) return null;
    return { min, max };
}

/**
 * 这条法术归哪一类 —— **决定 UI 管不管它**。
 *
 * ★★ Nous 2026-08-08 定的收窄：
 *   > "这个 spell casting frame 还需要一个默认型：0 → 直接接线 cast，ui 什么都不管
 *   >  （基本上所有的 spell，我们不管）。然后这种其他类型我们想要做的就为他们接线。"
 *
 *   ⚠ 这一条是对我做过头的纠正：我原来让**所有**"有目标+有射程"的法术
 *   （全库 75 条）都弹选目标层。而绝大多数法术根本不需要轮盘插手 ——
 *   多一层确认对它们**纯粹是多一次点击**。
 *   ★ 判据因此反过来：**默认不管，只有认得出的类型才接线**。
 *
 * ⛔ `spellstrike` 那种**复合**动作不在这个框架里（Nous 同一句话里说的）——
 *   它走 `macros.ts` 的编排器，那边先接管（`活跃编排` 分支排在最前）。
 *   两套并存是有意的：编排器管"再问你几个问题"，这个框架管"一次施法的固定流程"。
 *
 * ★★★ **这些自动化是"定制"，不是"正确答案"**（Nous 2026-08-08）：
 *   > "我们不能默认我们做的这些就是对的，给玩家和 gm 留玩的空间。
 *   >  我给你安排的那些其实算是我想要定制的。"
 *
 *   ⇒ 三条落地约束，加新类型时一并遵守：
 *     ① **默认不管**（`default` 覆盖绝大多数法术）——不确定就别插手；
 *     ② 每一步都**可绕过**：确认格零目标也能点、超上限只提示不禁止、
 *        gated 照旧可点由 pf2e 自己拒；
 *     ③ 凡是**规则里有而系统没自动化**的（如 Force Barrage 的多发），
 *        由玩家**显式选**了我们才做，绝不替他推断。
 */
export type CastKind =
    /** **默认**：直接 cast，UI 一概不管。绝大多数法术都是这一类。 */
    | "default"
    /** 攻击型：我掷命中（Phase Bolt / Divine Lance） */
    | "attack"
    /** 豁免型：对方掷豁免（Electric Arc / Fear） */
    | "save"
    /** 范围贴附：放范围 → 确认 → 批量贴 effect（Bless / anthem） */
    | "area-buff"
    /** 单体/自身贴附：选中的人（或自己）挂 effect（Haste / Sure Strike） */
    | "effect"
    /** 多动作：先问投几个动作（Force Barrage） */
    | "multi-action";

/** `castKindOf` 要看的那几样。全部是已经实测过的字段。 */
export interface CastKindInput {
    /** `spell.isAttack`（pf2e 算好的） */
    isAttack?: boolean;
    /** `spell.system.defense.save?.statistic` */
    saveStatistic?: string | null;
    /** `system.time.value`，用来认多动作型 */
    timeValue?: string | null;
    /** `effectApplyOf` 的结果：`allies`/`enemies`=范围，`targets`/`self`=单体 */
    effectApplyTo?: "allies" | "enemies" | "targets" | "self" | null;
    /** `targetingOf` 的结果 */
    targeting?: "none" | "pick" | "area";
}

/**
 * 判这条法术归哪一类。
 *
 * ★★ **顺序即优先级**，而且每一条都对应一件"UI 真的要做的事"：
 *   1. `multi-action` —— 要先问投几个动作，那一步在**其它一切之前**（它改变法术本身的效果）；
 *   2. `area-buff` —— 要放范围、批量贴；
 *   3. `attack` —— 要掷命中；
 *   4. `save` —— 要让目标掷豁免（且**得先有目标可选**）；
 *   5. `effect` —— 要把 effect 贴给选中的人/自己；
 *   6. 其余一律 `default` —— **UI 什么都不管**。
 *
 * ⚠ `save` 那条要求 `targeting === "pick"`：范围豁免法术（Fireball）的目标由模板圈定，
 *   逐个点反而会点出一份和模板不一致的名单 —— 那种归 `default`，交给 pf2e 原路。
 */
export function castKindOf(input: CastKindInput): CastKind {
    if (actionRangeOf(input.timeValue)) return "multi-action";
    if (input.effectApplyTo === "allies" || input.effectApplyTo === "enemies") return "area-buff";
    if (input.isAttack) return "attack";
    if (input.saveStatistic && input.targeting === "pick") return "save";
    if (input.effectApplyTo === "targets" || input.effectApplyTo === "self") return "effect";
    return "default";
}

/** 这一类要不要 UI 插手？`default` 是唯一不插手的。 */
export function needsWheelFlow(kind: CastKind): boolean {
    return kind !== "default";
}

/** 一次施法里的一步。 */
export type CastStepKind =
    /** 把法术本身放出去（pf2e 发施法卡、扣法术位） */
    | "cast"
    /** 让一个目标掷豁免 */
    | "save"
    /**
     * 掷**命中**（attack 型法术，如 Phase Bolt / Divine Lance / Telekinetic Projectile）。
     * ★ Nous 2026-08-08："attack 型比如 phase bolt 属于攻击，摇命中色子。"
     * ⚠ 与 `save` **互斥**：一个法术要么让对方豁免，要么自己掷命中，不会两者都来。
     *   判据是 pf2e 算好的 `spell.isAttack`（实测 Phase Bolt=true、Electric Arc=false）。
     */
    | "attack"
    /** 掷伤害 */
    | "damage"
    /** 把 spell effect 贴到目标身上 */
    | "effect";

export interface CastStep {
    kind: CastStepKind;
    /**
     * 这一步会不会往聊天栏里发东西。
     * ★ 节流只对**发消息的**步骤有意义 —— 贴 effect 不发消息，就不该白等 2 秒。
     */
    emitsMessage: boolean;
    /** 针对哪个目标（`save` 步骤专用；其余为 null） */
    targetIndex: number | null;
}

/** 规划一次施法要走哪几步时需要知道的事。 */
export interface CastPlanInput {
    /** 目标个数（选目标那一步的结果） */
    targetCount: number;
    /** 法术有豁免吗（`system.defense.save`） */
    hasSave: boolean;
    /**
     * 这是攻击型法术吗（`spell.isAttack`）。
     * ⚠ 与 `hasSave` 互斥 —— 同时为真时**攻击优先**（实测 attack 型的 `defense.save` 是 null，
     *   真出现两者都有的，那是数据异常，掷命中比让对方豁免更接近原意）。
     */
    isAttack?: boolean;
    /** 法术有伤害吗（判据用 `getDamage()`，不看 `system.damage`） */
    hasDamage: boolean;
    /**
     * 伤害要掷几次。默认 1。
     *
     * ★ 多动作型专用（Force Barrage：投 N 个动作 = 射 N 发，各掷各的伤害）。
     * ⚠⚠ **这是我们的解释，不是系统给的**：实测 Force Barrage 的
     *   `system.damage` 只有一发 `1d4+1`、`rules` 是空的、`heightening` 是 null ——
     *   pf2e **根本没自动化这条规则**，卡上只发一发。
     *   ⇒ 所以它只在玩家**显式选了动作数**之后才生效（他选的就是他的意图），
     *     我们绝不替他从"这法术能投 1-3 个动作"推断出该射几发。
     */
    damageCount?: number;
    /** 有要贴的 spell effect 吗（`effectApplyOf` 的结果） */
    hasEffect: boolean;
}

/**
 * 排出这一次施法的步骤序列。
 *
 * ★★ **顺序是规则决定的，不是我随便排的**：
 *   1. `cast` —— 先把法术放出去。⚠ 放在最前是因为 pf2e 可能**拦下它**
 *      （法术位不够、条件不满足）；后面几步都建立在"它真的放出去了"之上。
 *   2. `attack` **或** `save` —— 二选一，**每个目标一条**：
 *      攻击型是我掷命中，豁免型是对方掷豁免。各掷各的，合成一条会丢掉"谁过了谁没过"。
 *   3. `damage` —— 一次。基础豁免的伤害是**一份**，按各人的成功度打折，
 *      不是每人各掷一次（那会给出 N 份不同的伤害，规则上是错的）。
 *   4. `effect` —— 最后。贴在前的话，法术万一被拦下，buff 已经挂上去了
 *      （"没花代价却拿到收益"，与 main.ts 里那条同源）。
 *
 * ⚠ 没有目标时**不排 save**：豁免是目标掷的，没人可掷。
 */
export function planCast(input: CastPlanInput): CastStep[] {
    const steps: CastStep[] = [
        { kind: "cast", emitsMessage: true, targetIndex: null },
    ];
    /*
     * ★ 攻击型 vs 豁免型**二选一**：
     *   - 攻击型（Phase Bolt）：**我**掷命中，每个目标各掷一次；
     *   - 豁免型（Electric Arc）：**对方**掷豁免，每个目标各掷一次。
     *   ⚠ 两者都排的话会掷出一次多余的骰，而多出来的那次看起来完全合理。
     */
    if (input.isAttack) {
        for (let i = 0; i < input.targetCount; i++) {
            steps.push({ kind: "attack", emitsMessage: true, targetIndex: i });
        }
    } else if (input.hasSave) {
        for (let i = 0; i < input.targetCount; i++) {
            steps.push({ kind: "save", emitsMessage: true, targetIndex: i });
        }
    }
    if (input.hasDamage) {
        // ★ 多发：每发各掷一次（Force Barrage）。默认 1 发。
        const n = Math.max(1, Math.floor(Number(input.damageCount ?? 1)) || 1);
        for (let i = 0; i < n; i++) {
            steps.push({ kind: "damage", emitsMessage: true, targetIndex: null });
        }
    }
    if (input.hasEffect) {
        // ⚠ 贴 effect 不发聊天消息 ⇒ 不占节流间隔
        steps.push({ kind: "effect", emitsMessage: false, targetIndex: null });
    }
    return steps;
}

/**
 * 第 `i` 步之前要等多久（毫秒）。
 *
 * ★ 只在**两条消息之间**等：第一条不等（玩家刚点完，等待感是纯粹的卡顿），
 *   不发消息的步骤也不等。
 * ⚠ 拿它算而不是在循环里写 `await wait(2000)`，是为了让"等多久"可测 ——
 *   节奏这种东西肉眼看不出对错，只能靠断言钉住。
 */
export function gapBefore(steps: CastStep[], i: number, gapMs = CHAT_GAP_MS): number {
    if (i <= 0 || i >= steps.length) return 0;
    if (!steps[i].emitsMessage) return 0;
    // 往前找最近的一条"发过消息"的步骤；找不到说明前面没人发过 ⇒ 不用等
    for (let j = i - 1; j >= 0; j--) {
        if (steps[j].emitsMessage) return gapMs;
    }
    return 0;
}

/** 整套跑完大约要多久（毫秒）—— 用来提示玩家，别让他以为卡住了。 */
export function totalDuration(steps: CastStep[], gapMs = CHAT_GAP_MS): number {
    return steps.reduce((n, _, i) => n + gapBefore(steps, i, gapMs), 0);
}
