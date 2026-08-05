/**
 * 轮盘几何 —— 画笔扫掠模型。
 *
 * ★ 2026-08-05 重写(claude-draws skill)。环不再是"大圆减小圆"拼出来的 path,
 *   而是**一支半径 W 的笔沿着半径 R 的中线走**。换掉的理由:
 *
 *   1. **R 与 W 正交** —— 改环宽时中线不动。老的 rOuter/rInner 是耦合的,
 *      调粗细必须同时动两个数,每次都要重算。
 *   2. **端头圆角是笔尖形状,不用另画** —— path 只能靠 `stroke-linejoin:round` 蹭,
 *      圆角半径 = 半个描边宽,要做出环宽级的圆头就得把描边加到 24,那会撑大整个扇区。
 *      这是 path 方案的结构性限制,不是参数没调好。
 *   3. 分格、缝隙、缺口全由 `stroke-dasharray` 表达,一条规则覆盖。
 *
 *   角度沿用 SVG 约定:弧度制,0 指向正右,顺时针为正(y 向下)。
 */

const TAU = Math.PI * 2;

export interface RingSpec {
    /** 圆心 */
    cx: number;
    cy: number;
    /** 中线半径 —— 笔尖走的那条圆 */
    R: number;
    /** 笔半径 —— 环宽 = 2W,端头圆角半径也是它 */
    W: number;
    /** 总扇区数 */
    total: number;
    /** 扇区之间的缝隙(弧度),默认 0 */
    gap?: number;
    /**
     * 全部扇区一共占多大一段弧(弧度),默认整圆。
     *
     * ★ 小于整圆时环底会留出缺口,导航胶囊坐在那儿。扇区始终**以正上方为中心**
     *   对称铺开,所以缺口自然落在正下方。
     */
    arcSpan?: number;
    /**
     * 整段弧的中心角(弧度),默认 `-π/2` = 正上方。
     *
     * ★ 底部那条导航胶囊其实也是"一段带端帽的分段弧",只是中心在**正下方**。
     *   传 `π/2` 就能整套复用 —— 同一个 sectorArc / ringCapPath / capOvershoot,
     *   不必为它另写一套矩形几何。
     */
    center?: number;
}

export interface ArcDraw {
    /** `stroke-dasharray` 属性值:先画本扇区那一段,其余全部空掉 */
    dash: string;
    /** 外层 `<g>` 要转多少度 —— `<circle>` 从正右起笔,转过去就位 */
    rotate: number;
    /** `stroke-width`,等于环宽 */
    strokeWidth: number;
}

export interface Pt {
    x: number;
    y: number;
}

/** 极坐标转直角坐标。 */
function polar(cx: number, cy: number, r: number, angle: number): Pt {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/**
 * 第 index 个扇区的起止角(弧度)。
 * 全部扇区以正上方为中心对称铺开,`arcSpan` 小于整圆时缺口落在正下方。
 */
function sectorAngles(spec: RingSpec, index: number): { a0: number; a1: number } {
    const { total, gap = 0, arcSpan = TAU, center = -Math.PI / 2 } = spec;
    const step = arcSpan / total;
    // 整段弧以 center 为中心铺开,故起点回退半段弧(默认 center = 正上方)
    const start = center - arcSpan / 2 + index * step;
    return { a0: start + gap / 2, a1: start + step - gap / 2 };
}

/**
 * 第 index 个扇区要怎么画。
 *
 * 用法:`<g transform="rotate(rotate cx cy)"><circle r=R stroke-width=… dasharray=…/></g>`
 * —— 一个 `<circle>` 加两个属性,不生成任何路径坐标。
 */
export function sectorArc(spec: RingSpec, index: number): ArcDraw {
    const { R, W } = spec;
    const { a0, a1 } = sectorAngles(spec, index);
    const circumference = TAU * R;
    const drawn = (a1 - a0) * R;
    return {
        dash: `${drawn.toFixed(3)} ${(circumference - drawn).toFixed(3)}`,
        rotate: (a0 * 180) / Math.PI,
        strokeWidth: 2 * W,
    };
}

/** 扇区的视觉中心(落在中线上),用来摆图标与文字。 */
export function sectorCentroid(spec: RingSpec, index: number): Pt {
    const { a0, a1 } = sectorAngles(spec, index);
    return polar(spec.cx, spec.cy, spec.R, (a0 + a1) / 2);
}

/**
 * 环两端的圆头圆心 —— 第一个扇区的起点、最后一个扇区的终点,都落在中线上。
 *
 * ★ 为什么端头要单独画:`stroke-linecap` 管的是**整条路径的两端**,一条路径没法
 *   一端圆、一端平。而分格之后,只有环的最外两端该是圆的,扇区之间必须是平的
 *   (否则相邻圆头各凸出 atan(W/R),会把缝隙吃掉粘成一片)。
 *   所以扇区一律 `butt`,两端各补一个半径 W 的圆。
 */
export function ringCaps(spec: RingSpec): { start: Pt; end: Pt } {
    const first = sectorAngles(spec, 0);
    const last = sectorAngles(spec, spec.total - 1);
    return {
        start: polar(spec.cx, spec.cy, spec.R, first.a0),
        end: polar(spec.cx, spec.cy, spec.R, last.a1),
    };
}

/**
 * 端头圆帽的路径 —— **只画露在弧外面的那半个圆**。
 *
 * ★ 为什么不能直接画整圆:扇区的底色是半透明的（Foundry 的 `--background`
 *   自带 0.9 alpha）。整圆有一半压在弧上，两层半透明叠加会明显更深，
 *   端帽上于是浮出一道弧形接缝。画半圆则与弧的平头**正好接上、零重叠**，
 *   颜色自然连成一片。
 *
 * 半圆的直径就是环的截面（从 R-W 到 R+W 的那条径向线），圆弧朝弧的外侧凸出。
 */
export function ringCapPath(
    spec: RingSpec,
    which: "start" | "end",
    bulge = 1,
): string {
    const { cx, cy, R, W } = spec;
    const angles = which === "start"
        ? sectorAngles(spec, 0).a0
        : sectorAngles(spec, spec.total - 1).a1;

    // 径向单位向量：半圆的直径沿着它，两端分别落在 R+W 与 R-W 上
    const nx = Math.cos(angles);
    const ny = Math.sin(angles);
    const outer = { x: cx + (R + W) * nx, y: cy + (R + W) * ny };
    const inner = { x: cx + (R - W) * nx, y: cy + (R - W) * ny };

    /*
     * sweep：从外点绕到内点，要经过弧**外侧**那一边。
     * 起点帽凸向角度减小的方向（逆时针，sweep 0），终点帽凸向角度增大的方向（顺时针，1）。
     */
    const sweep = which === "start" ? 0 : 1;
    const f = (n: number) => n.toFixed(3);
    /*
     * `bulge` 控制端帽往外凸多少：1 = 满半圆，小于 1 就沿切向收扁成半椭圆
     * （径向那条直径始终等于环宽，收的只是凸出量）。
     * 端帽多占的角度随之变小，所以 capOvershoot 也要吃同一个 bulge，
     * 否则缺口会按满半圆去让位，白白空出一截。
     */
    /*
     * A 命令的 rx/ry 是**旋转之后**那对轴。这里把椭圆的 x 轴转到径向上，于是：
     *   rx = W        径向半径 —— 必须正好是半个环宽，才接得住 R±W 那两个端点
     *   ry = W·bulge  切向半径 —— 这才是"凸多少"，收它才是收凸出量
     * 写反的话收的就成了径向，端帽会比环窄一圈、从环上脱出来。
     */
    const radialR = W;
    const tangentR = W * bulge;
    const rot = (angles * 180) / Math.PI;
    return `M ${f(outer.x)} ${f(outer.y)} A ${f(radialR)} ${f(tangentR)} ${f(rot)} 0 ${sweep} ${f(inner.x)} ${f(inner.y)} Z`;
}

/**
 * 圆头在笔心之外多占的角度(弧度)。
 *
 * ★ 排布必须把这一项算进去:环底缺口要同时让开导航胶囊**和**两端圆头,
 *   否则圆头会侵进缺口、压住胶囊。老代码的 GAP_ANGLE 只算了胶囊,漏的就是这项。
 *
 * ⚠ 用 `asin` 不是 `atan`。圆头是一个半径 W、圆心落在半径 R 上的圆,
 *   从圆心看它的最大张角出现在视线与该圆**相切**处,即 `asin(W/R)`。
 *   `atan(W/R)` 只是"沿切向前进 W"对应的角,是个常见的近似,略小一点
 *   (R=64/W=10 时 8.88° vs 8.98°)。差值在这个尺度上只有 0.1 单位弧长,
 *   但既然是排布的硬约束,取严格上界更稳。
 */
export function capOvershoot(R: number, W: number, bulge = 1): number {
    return Math.asin(Math.min(1, (W * bulge) / R));
}
