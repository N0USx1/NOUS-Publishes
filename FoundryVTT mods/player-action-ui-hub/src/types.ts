/**
 * 扇区的可用性三态（设计定档 §6.4）。三态都可点击——我们只提示，不禁止。
 * - normal : 无附加条件
 * - risky  : ⚠ 可以做但有额外检定/代价（如迟钝下施法要过平骰）。
 *            **保持正常亮度**，变暗会被读成"不该做"，那是把规则简化错了。
 * - gated  : ✖ 规则上此刻用不了（无 panache 的终结技、次数已用尽）。变暗。
 */
export type SectorState = "normal" | "risky" | "gated";

/** 轮盘上一个可点扇区的数据。UI 只认这个结构，不认 pf2e 的原始对象。 */
export interface SectorData {
    /** 稳定标识，用于回查执行目标 */
    id: string;
    /** 扇区上显示的名字 */
    label: string;
    /** 动作消耗，用于画 ◆ 记号；null = 不显示 */
    cost: "1" | "2" | "3" | "reaction" | "free" | null;
    /** 可用性状态 */
    state: SectorState;
    /** 完整原因，显示在中心毂；state 为 normal 时忽略。优先用系统 addenda 原文 */
    reason?: string;
    /** 短提示，**直接印在扇区上**（B 档强度，不用悬停就能看见） */
    badge?: string;
    /**
     * 条目图标路径（如 `systems/pf2e/icons/equipment/weapons/rapier.webp`）。
     *
     * ★ 有图标时扇区**只画图标不画名字**，名字交给中心毂在悬停时显示
     *   （Nous 2026-08-05 提出）。这是**结构上**避免长名字压出扇区，
     *   而不是靠缩字号硬塞 —— "Unarmed Attack" 那种长度怎么缩都别扭。
     */
    img?: string;
    /**
     * 这个条目的**多段变体**显示文字，第 0 项是第 1 击。
     *
     * ⚠ 文字**直接来自 pf2e**（`strike.variants[i].label`），不要自己拼"第 N 击"：
     *   findings-v0.1 §2 实测 label 本身就自带 MAP 文案
     *   （`["+13", "+9 (MAP -4)", "+5 (MAP -8)"]`），再拼一遍会把 MAP 显示两次。
     *
     * 每个条目各存一份而不是全盘共用一份，是因为**不同武器的加值不同**：
     * 共用第一把武器的数字，玩家悬停第二把时看到的就是假数字。
     */
    variantLabels?: string[];
}

/** 一层盘面。 */
export interface WheelLevel {
    /** 这一层的标题，显示在中心毂 */
    title: string;
    sectors: SectorData[];
    /** 是否显示返回扇区 */
    canGoBack: boolean;
    /**
     * 中心毂底部的变体翻选条（MAP 三段）；这一层不需要时省略。
     * 只有**下标**是全盘共用的状态——"现在是第几击"对整层成立；
     * 具体显示哪串文字则按悬停的扇区各取各的 `variantLabels`。
     */
    variant?: {
        /** 当前第几项，0 起 */
        index: number;
        /** 没有悬停任何扇区时显示的文字（取本层第一个条目的） */
        labels: string[];
    };
    /**
     * 分页状态；一页装得下的层省略即可。
     *
     * ★ `sectors` **始终存全量**，只渲染当前页 —— 翻页因此不必重新采集。
     *   重采集一次要重扫 70 条动作，而且会和双向绑定的重建打架。
     *
     * ⚠ 一层**不要同时开 `paging` 和 `variant`**：两者抢同一对胶囊箭头。
     *   `#onClick` 里分页优先。法术层将来若两者都需要，得另想办法（见 v0.3–v0.6 计划）。
     */
    paging?: {
        /** 当前页码，0 起。可以越界，取用时由 `pageOf` 回环。 */
        page: number;
    };
}
