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
 * 毂里最多放几行。
 *
 * ⚠ 这个数是**排版约束**不是逻辑约束：`readClassState` 会把全部状态算出来，
 *   截断只发生在最后一步。要加行数是 Nous 的决定（属"看起来的东西"），
 *   不是我改个常量的事。
 */
export const MAX_STATE_LINES = 3;

/* ══════════════════════════════════════════════════════════
 * 通用资源
 * ══════════════════════════════════════════════════════════ */

/**
 * 全职业共通、值得显示的资源池。
 *
 * ⚠ **不是把 `system.resources` 整个端上来**：实测里 `investiture` 是 0/10 且
 *   人人都有 —— 它是"最多能佩戴几件投资装备"这个**被动上限**，不是每回合要看的状态。
 *   照单全收会让毂里常驻一条没人关心的行，把真正要看的挤掉。
 *   判据是"**这东西会不会在一场战斗里变**"。
 */
export const COMMON_RESOURCES: { path: string; key: string; label: string }[] = [
    { path: "focus", key: "focus", label: "Focus" },
    { path: "heroPoints", key: "hero", label: "Hero Points" },
    { path: "mythicPoints", key: "mythic", label: "Mythic" },
];

/**
 * 职业特有的资源（Nous 的"内圆按 class 可变"落点）。
 *
 * ★ 这张表存在的理由和 aura 那张一样：**"哪条资源属于哪个职业"推不出来**。
 *   `system.resources` 是个平摊的字典，没有任何字段说 infusedReagents 是炼金术士的。
 *
 * ⚠ 加新条目前先在游戏里量一次路径 —— 猜一个路径不会报错，只会永远读到 undefined
 *   然后这一行安静地不出现。
 */
export const CLASS_RESOURCES: Record<string, { path: string; key: string; label: string }[]> = {
    // 实测路径：`actor.system.resources.crafting.infusedReagents`
    alchemist: [{ path: "crafting.infusedReagents", key: "reagents", label: "Reagents" }],
};

function 读资源(a: any, path: string): { value: number; max: number } | null {
    const v = path.split(".").reduce((o: any, k) => o?.[k], a?.system?.resources);
    if (!v || typeof v.max !== "number" || v.max <= 0) return null;
    return { value: Number(v.value ?? 0), max: Number(v.max) };
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
 * ⚠ 不显示条件（frightened 之类）：那些 Foundry 的 token 血条与角色卡已经在显示，
 *   毂里再来一份是重复，而毂的行数很贵。
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

/** 从 actor 取状态。**只读，绝不写 actor。** */
export function readClassState(actor: ActorPF2e | null): StateInput {
    try {
        const a = actor as any;
        const classSlug: string | null = a?.class?.slug ?? null;
        const 表 = [...COMMON_RESOURCES, ...(classSlug ? CLASS_RESOURCES[classSlug] ?? [] : [])];

        const resources: StateLine[] = [];
        for (const r of 表) {
            const v = 读资源(a, r.path);
            if (v) resources.push({ key: r.key, label: r.label, value: `${v.value}/${v.max}` });
        }
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
 * 状态行。
 *
 * ★ **没有内容就返回空数组**，那一格整个不出现（设计定档 §7）——
 *   占一个空位比不显示更糟：玩家会以为是加载失败或自己漏看了什么。
 *
 * ★ 排序依据是"**多快会变**"，不是"属不属于职业"：
 *   资源（每回合都在动）→ 有具体选择的开关（神火在哪、这轮选了什么）
 *   → effect → 单纯开/关的开关（一场战斗里基本不动）。
 */
export function classStateLines(input: StateInput): string[] {
    const 有选择 = input.toggles.filter(t => t.value !== "on" && t.value !== "off");
    const 纯开关 = input.toggles.filter(t => t.value === "on" || t.value === "off");
    const 排好 = [...input.resources, ...有选择, ...input.effects, ...纯开关];
    return 排好.slice(0, MAX_STATE_LINES).map(l => `${l.label} ✦ ${l.value}`);
}
