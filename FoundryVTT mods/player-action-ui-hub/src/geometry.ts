export interface SectorSpec {
    /** 第几个扇区，0 起 */
    index: number;
    /** 总扇区数 */
    total: number;
    /** 外半径 */
    rOuter: number;
    /** 内半径（中心毂边缘） */
    rInner: number;
    /** 圆心 */
    cx: number;
    cy: number;
    /** 扇区之间的缝隙（弧度），默认 0 */
    gap?: number;
    /**
     * 全部扇区一共占多大一段弧（弧度），默认整圆 2π。
     *
     * ★ 小于 2π 时环底会留出一个缺口，导航胶囊坐在那儿
     *   （Nous 2026-08-05 的 mockup）。扇区始终**以正上方为中心**对称铺开，
     *   所以缺口自然落在正下方。
     */
    arcSpan?: number;
}

/** 极坐标转直角坐标。angle 单位为弧度，0 指向正右，顺时针为正（SVG 坐标系 y 向下）。 */
function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/**
 * 取第 index 个扇区的起止角（弧度）。
 * 全部扇区**以正上方为中心**对称铺开；`arcSpan` 小于整圆时，
 * 剩下的缺口自然落在正下方，留给导航胶囊。
 */
function sectorAngles(spec: SectorSpec): { a0: number; a1: number } {
    const { index, total, gap = 0, arcSpan = Math.PI * 2 } = spec;
    const step = arcSpan / total;
    // -PI/2 = 正上方；整段弧以它为中心，故起点回退半段弧
    const start = -Math.PI / 2 - arcSpan / 2 + index * step;
    return { a0: start + gap / 2, a1: start + step - gap / 2 };
}

/** 生成一个环形扇区的 SVG path 的 d 属性。 */
export function sectorPath(spec: SectorSpec): string {
    const { rOuter, rInner, cx, cy } = spec;
    const { a0, a1 } = sectorAngles(spec);
    const largeArc = a1 - a0 > Math.PI ? 1 : 0;

    const o0 = polar(cx, cy, rOuter, a0);
    const o1 = polar(cx, cy, rOuter, a1);
    const i1 = polar(cx, cy, rInner, a1);
    const i0 = polar(cx, cy, rInner, a0);

    const f = (n: number) => n.toFixed(2);
    return [
        `M ${f(o0.x)} ${f(o0.y)}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${f(o1.x)} ${f(o1.y)}`,
        `L ${f(i1.x)} ${f(i1.y)}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${f(i0.x)} ${f(i0.y)}`,
        "Z",
    ].join(" ");
}

/** 扇区的视觉中心，用来摆图标与文字。 */
export function sectorCentroid(spec: SectorSpec): { x: number; y: number } {
    const { rOuter, rInner, cx, cy } = spec;
    const { a0, a1 } = sectorAngles(spec);
    return polar(cx, cy, (rOuter + rInner) / 2, (a0 + a1) / 2);
}

/** 鼠标位置落在哪个扇区上；不在环内或落进底部缺口返回 -1。 */
export function hitTest(
    spec: Omit<SectorSpec, "index">,
    px: number,
    py: number,
): number {
    const { total, rOuter, rInner, cx, cy, arcSpan = Math.PI * 2 } = spec;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < rInner || dist > rOuter) return -1;

    const step = arcSpan / total;
    // 换算成"从整段弧起点量起"的角度
    let angle = Math.atan2(dy, dx) - (-Math.PI / 2 - arcSpan / 2);
    while (angle < 0) angle += Math.PI * 2;
    while (angle >= Math.PI * 2) angle -= Math.PI * 2;
    if (angle >= arcSpan) return -1;          // 落在底部缺口里
    return Math.min(Math.floor(angle / step), total - 1);
}

// ⚠ 这里原本还有一套「弧形胶囊」（capsuleCellPath/capsuleCentroid），
//   2026-08-05 按 Nous 的要求改成环下方的**横排圆角矩形**后删除。
//   横排矩形由 wheel-app 直接画 <rect rx>，不需要极坐标拟合 ——
//   把形状塞进极坐标正是当初对不上 mockup 的根因。
