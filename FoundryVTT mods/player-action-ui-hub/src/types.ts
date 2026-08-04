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
}

/** 一层盘面。 */
export interface WheelLevel {
    /** 这一层的标题，显示在中心毂 */
    title: string;
    sectors: SectorData[];
    /** 是否显示返回扇区 */
    canGoBack: boolean;
}
