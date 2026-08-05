import type { ActorPF2e } from "foundry-pf2e";

/**
 * 中心毂里的**职业状态区**（设计定档 §7，Nous 2026-08-04 拍板要做）。
 *
 * ★ 这是"甲类空白"的落点，也是这个模组定位的核心：
 *   29 职业全扫的结论是——玩家每回合卡住的地方大半不是按钮难找，
 *   而是**"我现在是什么状态"没人显示**（panache 有没有、神火在哪个圣像、
 *   诅咒第几层、当前 MAP）。这些在 pf2e 里**不是 item**，
 *   所以列表型 HUD 结构上就做不了，而轮盘的中心毂天生是块屏。
 *
 * ⚠ 本版只接**通用的两类**：专注点池、规则开关。
 *   逐职业的特调状态（神火位置、诅咒层数）属③段参数化反馈，不在这里硬编码 ——
 *   按职业名 if-else 是最容易写、也最容易在多职业/原型/模组内容上出错的做法。
 */

/** 毂里那一格职业状态要的输入。纯数据，便于单测。 */
export interface StateInput {
    /** 专注点池，实测路径 `actor.system.resources.focus` */
    focus: { value: number; max: number } | null;
    /** 归属本职业的规则开关 */
    toggles: { label: string; enabled: boolean }[];
}

/** 毂里最多放几行。再多就把中心毂挤爆，且和底下的动作经济行打架。 */
export const MAX_STATE_LINES = 2;

/**
 * 职业状态行。
 *
 * ★ **没有内容就返回空数组**，那一格整个不出现（设计定档 §7）——
 *   占一个空位比不显示更糟：玩家会以为是加载失败或自己漏看了什么。
 */
export function classStateLines(input: StateInput): string[] {
    const lines: string[] = [];
    // 资源排在开关之前：余量是每回合都要看的，开关状态相对稳定
    if (input.focus && input.focus.max > 0) {
        lines.push(`✦ Focus ${input.focus.value}/${input.focus.max}`);
    }
    for (const t of input.toggles) {
        lines.push(`${t.label} ✦ ${t.enabled ? "on" : "off"}`);
    }
    return lines.slice(0, MAX_STATE_LINES);
}

/**
 * 从 actor 取状态。
 *
 * ⚠ **开关要按职业归属过滤**：实测那个 Magus 角色的 `synthetics.toggles` 里
 *   是 `dragons-flight` —— **那不是 Magus 的**，来自血统专长 Dragon's Flight。
 *   整个端进来就会在毂里显示一条与职业无关的状态。
 *   过滤依据走 `itemId` 回查该 item 的 trait，**不按名字猜**（§6.2 守则）。
 */
export function readClassState(actor: ActorPF2e | null): StateInput {
    try {
        const a = actor as any;
        const classSlug = a?.class?.slug ?? null;
        const focus = a?.system?.resources?.focus ?? null;

        const toggles: { label: string; enabled: boolean }[] = [];
        for (const [, options] of Object.entries(a?.synthetics?.toggles ?? {})) {
            for (const [, opt] of Object.entries(options as Record<string, any>)) {
                // 回查发出这个开关的 item，只留属于本职业的
                const item = opt?.itemId ? a?.items?.get?.(opt.itemId) : null;
                const traits: string[] = item?.system?.traits?.value ?? [];
                if (!classSlug || !traits.includes(classSlug)) continue;
                toggles.push({
                    label: String(opt?.label ?? opt?.option ?? "?"),
                    enabled: !!opt?.enabled,
                });
            }
        }
        return { focus: focus && focus.max > 0 ? { value: focus.value, max: focus.max } : null, toggles };
    } catch (err) {
        console.error("player-action-ui-hub | readClassState 失败", err);
        return { focus: null, toggles: [] };
    }
}
