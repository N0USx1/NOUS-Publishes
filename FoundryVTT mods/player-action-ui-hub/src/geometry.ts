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
}

/** 极坐标转直角坐标。angle 单位为弧度，0 指向正右，顺时针为正（SVG 坐标系 y 向下）。 */
function polar(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** 取第 index 个扇区的起止角（弧度）。第 0 个扇区以正上方为中心。 */
function sectorAngles(spec: SectorSpec): { a0: number; a1: number } {
    const { index, total, gap = 0 } = spec;
    const step = (Math.PI * 2) / total;
    // -PI/2 = 正上方；减半个 step 让第 0 个扇区以正上方为中心
    const start = -Math.PI / 2 - step / 2 + index * step;
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

/** 鼠标位置落在哪个扇区上；不在环内返回 -1。 */
export function hitTest(
    spec: Omit<SectorSpec, "index">,
    px: number,
    py: number,
): number {
    const { total, rOuter, rInner, cx, cy } = spec;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < rInner || dist > rOuter) return -1;

    const step = (Math.PI * 2) / total;
    let angle = Math.atan2(dy, dx) + Math.PI / 2 + step / 2;
    while (angle < 0) angle += Math.PI * 2;
    while (angle >= Math.PI * 2) angle -= Math.PI * 2;
    return Math.floor(angle / step);
}
