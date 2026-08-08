import type { ActorPF2e } from "foundry-pf2e";

/**
 * 中心毂里的**状态区**（设计定档 §7，Nous 2026-08-04 拍板要做）。
 *
 * ★ 这是"甲类空白"的落点，也是这个模组定位的核心：
 *   29 职业全扫的结论是——玩家每回合卡住的地方大半不是按钮难找，
 *   而是**"我现在是什么状态"没人显示**（panache 有没有、神火在哪个圣像、
 *   诅咒第几层、当前 MAP）。这些在 pf2e 里**不是 item**，
 *   所以列表型 HUD 结构上就做不了，而轮盘的中心毂天生是块屏。
 *
 * ★ **内圆按职业可变**（Nous 2026-08-05）：
 *   "圆盘的内圆是可以根据角色类型/class 更改的，如果他们有自己特别的 resource，
 *    那么是可以提交在这个 ui 上显示的"。
 *   所以下面有一张 `CLASS_RESOURCES` 登记表 —— 但它**只登记推不出来的那一样**
 *   （哪条资源属于哪个职业、叫什么），数值一律从 actor 现读。
 *   照 aura 那次的教训：抄进来的值是一份会静默腐坏的副本。
 *
 * ⚠ **不再按职业 trait 过滤开关**（2026-08-05 实测推翻了原做法）：
 *   典范的神火 `divine-spark` 挂在**圣像特性**上，那些特性的 traits 是 `["ikon"]`，
 *   **不带 `exemplar`** —— 按 classSlug 过滤永远抓不到它，而它正是典范每回合要看的东西。
 *   更根本的是：过滤问的是"这归不归我的职业"，而毂要回答的是
 *   **"我现在需不需要知道它"**。两个问题的主语不同。
 *   血统专长给的 Dragon's Flight 也是玩家自己在开关的状态，没有理由藏起来。
 */

/** 毂里的一行状态。拆成三段是为了排版时能分别处理（中字标签 + 小字值）。 */
export interface StateLine {
    /** 去重与排序用的稳定键 */
    key: string;
    label: string;
    /** 已经拼好的值，如 `1/3`、`on`、`Skin Hard as Horn` */
    value: string;
}

/** 毂里那一格状态要的输入。纯数据，便于单测。 */
export interface StateInput {
    resources: StateLine[];
    toggles: StateLine[];
    effects: StateLine[];
}

/**
 * 最多几行状态。
 *
 * ⚠ **2026-08-07 改成"一条一行"之后，这个数的含义变了**：
 *   原来是"最多几个**类目**"（资源/开关/effect 各一行，类目数固定、不随角色变）；
 *   现在是"最多几**条**" —— 而条数**是随角色变的**（资源多的职业会顶上来）。
 *   ⇒ 顺序因此变成一个真实的取舍，见 `classStateLines` 里那段。
 *
 * ⚠ 采集端与排版端两个上限**各管各的**：这个管"算出几条"，
 *   `wheel-app.ts` 的 `MAX_HUB_STATE_LINES` 管"毂里画得下几行"。
 *   两者恰好都是 3，**但那是巧合不是约束** —— 别把其中一个删掉去引用另一个。
 */
export const MAX_STATE_LINES = 3;

/* ══════════════════════════════════════════════════════════
 * 通用资源
 * ══════════════════════════════════════════════════════════ */

/**
 * **不该显示的资源池**（唯一的登记表，而且是黑名单不是白名单）。
 *
 * ⚠ `investiture` 是"最多能佩戴几件投资装备"这个**被动上限**，人人都有、
 *   一场战斗里不会变。照单全收会让毂里常驻一条没人关心的行，把真要看的挤掉。
 *   判据是"**这东西会不会在一场战斗里变**"。
 */
export const HIDDEN_RESOURCES = new Set(["investiture"]);

/**
 * 资源池的显示名。**只是好看**，表里没有的会自动把键名转成人话。
 *
 * ⚠ 它绝不参与"显不显示"的判断 —— 一旦参与，就又变成一张会腐坏的白名单。
 */
export const RESOURCE_LABELS: Record<string, string> = {
    focus: "Focus",
    heroPoints: "Hero Points",
    mythicPoints: "Mythic",
    versatileVials: "Vials",
    infusedReagents: "Reagents",
};

/** `versatileVials` → `Versatile Vials`。表里没有的都走这个。 */
export function humanizeKey(key: string): string {
    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, c => c.toUpperCase());
}

/**
 * 毂内圆要显示的资源 —— **全推导，一条职业映射都不写**（Nous 2026-08-07 定稿）。
 *
 * > "圆盘的内圆是可以根据角色类型/class 更改的，
 * >  如果他们有自己特别的 resource，那么是可以提交在这个 ui 上显示的。"
 *
 * ★★ **原来那张 `CLASS_RESOURCES` 删掉了，因为它已经腐坏过一次**：
 *   表里写的是 `crafting.infusedReagents`，而 remaster 之后炼金术士真正在用的是
 *   **`versatileVials`**（实测 2/3）；`crafting.infusedReagents` 还在，但 `max: 0`。
 *   于是那一行**永远不显示、也不报错** —— 正是那张表自己注释里警告过的失效方式。
 *
 * ★ 正确判据不是"这条属于哪个职业"，而是"**它是不是一个会变的池子**"：
 *   `system.resources` 里 `max > 0` 的都算，除掉黑名单。
 *   专注、英雄点、神话点、炼金瓶、以及**将来任何新职业的新资源**都自动出现。
 *
 * ⚠ 嵌套的池子不递归：实测那一层（`crafting.*`）已经是废弃的，
 *   而递归会把一堆根本不是池子的对象也当成资源。
 */
export function resourceLines(actor: ActorPF2e | null): StateLine[] {
    const pools = (actor as any)?.system?.resources ?? {};
    const out: StateLine[] = [];
    for (const [key, v] of Object.entries(pools as Record<string, any>)) {
        if (HIDDEN_RESOURCES.has(key)) continue;
        const max = Number((v as any)?.max);
        if (!Number.isFinite(max) || max <= 0) continue;
        out.push({
            key: `res:${key}`,
            label: RESOURCE_LABELS[key] ?? humanizeKey(key),
            value: `${Number((v as any)?.value ?? 0)}/${max}`,
        });
    }
    return out;
}


/* ══════════════════════════════════════════════════════════
 * 采集
 * ══════════════════════════════════════════════════════════ */

/**
 * 规则开关，**按 option 归组**。
 *
 * ★ 归组而不是逐条列，是因为同一个开关会被**多个 item 各声明一遍**：
 *   实测每个圣像特性都声明了 `divine-spark`，典范带三个圣像就会列三行同名的。
 *   而它们本来就是同一个开关 —— 神火只有一处，`selection` 说的就是在哪处。
 *
 * ⚠ 同一个 option 还会出现在多个 domain（`all` / `strike-attack-roll` …）下，
 *   那也是同一个开关的不同作用面，不是两个状态。
 */
export function collectToggles(actor: ActorPF2e | null): StateLine[] {
    const a = actor as any;
    const 归组 = new Map<string, StateLine>();
    for (const opts of Object.values(a?.synthetics?.toggles ?? {})) {
        for (const opt of Object.values(opts as Record<string, any>)) {
            const option = String(opt?.option ?? "");
            if (!option || 归组.has(option)) continue;
            const label = String(opt?.label ?? option);
            // 有子选项时，**值就是选中的那个** —— 那才是玩家要看的
            //（"神火在哪个圣像"，不是"神火开着吗"）
            const 选中 = opt?.selection != null
                ? (opt.suboptions ?? []).find((s: any) => s?.value === opt.selection)
                : null;
            const value = 选中 ? String(选中.label ?? 选中.value) : (opt?.enabled ? "on" : "off");
            归组.set(option, { key: `toggle:${option}`, label, value });
        }
    }
    return [...归组.values()];
}

/**
 * 标志性 effect。
 *
 * ★ 判据是"**它带计数**或**它本身就是个开关状态**"：
 *   实测 `Effect: Panache` 的 `badge` 是 null —— panache 是"有没有"，不是"几层"。
 *   所以带 badge 的显示数字，不带的显示存在与否。
 *
 * ⚠ **条件（frightened 之类）不在这里收**，理由见下面那段 ⛔：
 *   名字归游戏自己的效果面板，毂里只呈现它造成的**减值**。
 */
export function collectEffects(actor: ActorPF2e | null): StateLine[] {
    const a = actor as any;
    const out: StateLine[] = [];
    for (const e of a?.itemTypes?.effect ?? []) {
        const badge = e?.system?.badge;
        const 计数 = badge && typeof badge.value === "number" ? String(badge.value) : null;
        // 名字里的 "Effect: " 前缀在毂里是噪音，去掉
        const label = String(e?.name ?? "").replace(/^\s*Effect:\s*/i, "");
        out.push({ key: `effect:${e?.slug ?? label}`, label, value: 计数 ?? "active" });
    }
    return out;
}

/*
 * ⛔ 这里一度有个 `collectConditions()`，把 frightened 之类**按名字**排进状态行。
 *   Nous 2026-08-08 当场收窄：**"你不需要写 status 的名字，因为游戏 ui 已经给了
 *   很大一个了，只需要做对应的减值呈现即可。"**
 *   ★ 他是对的：效果面板那排图标已经答了"我身上有什么"，毂里再抄一遍名字是重复；
 *     毂里缺的是**那个净值里到底含了多少惩罚** —— 名字答不了这个，数才答得了。
 *   ⇒ 改成在打击格上呈现**攻击减值合计**（见 collectors/strikes.ts），
 *     这里不再收条件。删掉而不是留着：没人调用的采集器会被下一个人当成还在用。
 */

/**
 * 影响本回合动作数的条件。
 *
 * ★★ **压制关系交给 pf2e**（2026-08-05 实测）：同时挂 slowed 1 + stunned 2 之后，
 *   `actor.conditions.active` 里**只剩 stunned**（它自带 `overrides: ["slowed"]`）。
 *   所以这里**把 active 里的减动作条件直接相加**就够了 —— 该压制的它已经压掉了。
 *   自己写 `max(slowed, stunned)` 等于把规则抄一份进来，那份迟早分叉。
 *
 * ⚠ 只认这三条。别的"不能行动"类条件（麻痹、昏迷）**不在这里减动作** ——
 *   它们的规则不是"少几个动作"而是"根本不能行动"，用动作数表达会把规则说小了。
 *   那类留给③段的条件灰显。
 */
export const ACTION_CONDITIONS = ["slowed", "stunned"] as const;

export function turnConditions(actor: ActorPF2e | null): { lost: number; quickened: boolean; notes: string[] } {
    const 生效 = ((actor as any)?.conditions?.active ?? []) as any[];
    let lost = 0;
    const notes: string[] = [];
    for (const c of 生效) {
        if ((ACTION_CONDITIONS as readonly string[]).includes(c?.slug)) {
            const n = Number(c?.value ?? 0);
            if (Number.isFinite(n) && n > 0) { lost += n; notes.push(`${c.name}`); }
        }
    }
    const quickened = 生效.some(c => c?.slug === "quickened");
    if (quickened) notes.push("Quickened");
    return { lost, quickened, notes };
}

/** 从 actor 取状态。**只读，绝不写 actor。** */
export function readClassState(actor: ActorPF2e | null): StateInput {
    try {
        const resources = resourceLines(actor);

        return { resources, toggles: collectToggles(actor), effects: collectEffects(actor) };
    } catch (err) {
        console.error("player-action-ui-hub | readClassState 失败", err);
        return { resources: [], toggles: [], effects: [] };
    }
}

/* ══════════════════════════════════════════════════════════
 * 排版
 * ══════════════════════════════════════════════════════════ */

/**
 * 状态行 —— **一个类目一行**（Nous 2026-08-05 定）。
 *
 * > "按类目起新的行……如果是按目录入新建的话就不会出现每次都要修的概念"
 *
 * ★ **为什么按类目而不是按条目**：按条目排的话，行数随角色变
 *   （法师 2 条、典范 5 条），版式就得跟着每个职业改一次 —— 改不完。
 *   按类目排，**行数上限等于类目数**（现在 3），加一个职业的资源
 *   只是让"资源"那一行变长，**排版一次都不用动**。
 *
 * ★ 类目顺序按"**多快会变**"：资源（每回合都在动）→ 开关（这轮选了什么）→ effect。
 *
 * ⚠ 类目内部才用 " · " 接；**跨类目绝不接** —— 接起来就退回成一行，
 *   那正是 2026-08-05 顶出毂外的那个 bug。
 *
 * ⚠ 没有内容的类目**不占行**：空行比不显示更糟，玩家会以为漏加载了。
 */
export function classStateLines(input: StateInput): string[] {
    // 开关内部：有具体选择的排前面（"神火在哪个圣像"比"开着没"信息量大）
    const 开关 = [
        ...input.toggles.filter(t => t.value !== "on" && t.value !== "off"),
        ...input.toggles.filter(t => t.value === "on" || t.value === "off"),
    ];
    /*
     * ★★ **一条一行**（Nous 2026-08-07："hero 和 focus 那个我们之前说按照类型换行"）。
     *
     *   原来是把同一类目的几条**拼成一行**（`Hero Points ✦ 1/3 · Focus ✦ 1/1`）。
     *   拼行省的是行数，付的是**读的代价**：两个数字挤在一起，
     *   要找"焦点还剩几点"得先在一串里定位它。
     *   而这几行答的正是"我现在还有什么资源"——那是要**扫一眼就读到**的东西。
     *
     * ⚠ 代价说清楚：一行只放一条，画得下的**条数**就少了
     *   （原来三行能放六七条，现在三行就是三条，见 wheel-app 的 MAX_HUB_STATE_LINES）。
     *   所以顺序变得要紧：**资源 → 开关 → effect**，
     *   资源是"还能不能做"，最该被看见；effect 是"身上有什么"，最能等。
     */
    return [...input.resources, ...开关, ...input.effects]
        .map(l => `${l.label} ✦ ${l.value}`)
        .slice(0, MAX_STATE_LINES);
}
