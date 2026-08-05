import { describe, it, expect } from "vitest";
import { sectorArc, sectorCentroid, ringCaps, ringCapPath, capOvershoot } from "../src/geometry";
import type { RingSpec } from "../src/geometry";

/*
 * 2026-08-05 随几何重写（path → 画笔扫掠）一并重写。
 * 旧测试里 hitTest 那一组整组删掉 —— 那个函数从来没被 wheel-app 调用过，
 * 命中判定一直是浏览器在做（扇区是真实 SVG 元素，自己吃 hover/click）。
 */

const TAU = Math.PI * 2;
const base = (over: Partial<RingSpec> = {}): RingSpec => ({
    cx: 100, cy: 100, R: 64, W: 10, total: 4, ...over,
});

describe("sectorArc", () => {
    // ★ 语义：**整段弧**居中于正上方 —— 只有这样，arcSpan 小于整圆时
    //   缺口才会落在正下方给导航胶囊让位。整圆时第 0 扇区因此从正下方起算。
    it("整圆时第一个扇区从正下方起笔", () => {
        const { rotate } = sectorArc(base(), 0);
        // -270° ≡ 90°，SVG 里 0° 指正右、顺时针，90° 就是正下方
        expect(((rotate % 360) + 360) % 360).toBeCloseTo(90, 6);
    });

    it("dash 的两段加起来正好是中线周长", () => {
        const spec = base({ total: 5, arcSpan: TAU - 1.2, gap: 0.03 });
        const { dash } = sectorArc(spec, 2);
        const [drawn, blank] = dash.split(" ").map(Number);
        expect(drawn + blank).toBeCloseTo(TAU * spec.R, 2);
    });

    it("画出来的那一段长度 = 扫过的弧度 × 中线半径", () => {
        const spec = base({ total: 4, arcSpan: TAU, gap: 0 });
        const [drawn] = sectorArc(spec, 0).dash.split(" ").map(Number);
        expect(drawn).toBeCloseTo((TAU / 4) * spec.R, 2);
    });

    it("gap 从两侧各吃掉一半", () => {
        const gap = 0.06;
        const wide = sectorArc(base({ gap: 0 }), 1);
        const thin = sectorArc(base({ gap }), 1);
        const len = (d: string) => Number(d.split(" ")[0]);
        expect(len(wide.dash) - len(thin.dash)).toBeCloseTo(gap * 64, 2);
        // 起笔角往前挪半个 gap
        expect(thin.rotate - wide.rotate).toBeCloseTo(((gap / 2) * 180) / Math.PI, 6);
    });

    it("环宽就是描边宽 = 2W，与半径无关", () => {
        expect(sectorArc(base({ W: 10 }), 0).strokeWidth).toBe(20);
        expect(sectorArc(base({ W: 10, R: 200 }), 0).strokeWidth).toBe(20);
    });

    it("扇区数变化时每格互不相同", () => {
        for (const total of [1, 3, 8]) {
            const all = Array.from({ length: total }, (_, i) =>
                JSON.stringify(sectorArc(base({ total }), i)));
            expect(new Set(all).size).toBe(total);
        }
    });
});

describe("sectorCentroid", () => {
    it("形心落在中线上", () => {
        const spec = base({ total: 6, arcSpan: TAU - 1.3 });
        for (let i = 0; i < spec.total; i++) {
            const c = sectorCentroid(spec, i);
            expect(Math.hypot(c.x - spec.cx, c.y - spec.cy)).toBeCloseTo(spec.R, 6);
        }
    });

    it("四格整圆时第 1、2 格关于中轴对称且都在上半", () => {
        const a = sectorCentroid(base(), 1);
        const b = sectorCentroid(base(), 2);
        expect(a.x + b.x).toBeCloseTo(200, 6);
        expect(a.y).toBeLessThan(100);
        expect(b.y).toBeLessThan(100);
    });

    it("带缺口时首尾格关于中轴对称", () => {
        const spec = base({ total: 4, arcSpan: TAU - 1.1 });
        const first = sectorCentroid(spec, 0);
        const last = sectorCentroid(spec, spec.total - 1);
        expect(first.x + last.x).toBeCloseTo(200, 6);
        expect(first.y).toBeCloseTo(last.y, 6);
    });
});

describe("ringCaps", () => {
    it("两端圆头都落在中线上，且关于中轴对称", () => {
        const spec = base({ total: 5, arcSpan: TAU - 1.28 });
        const { start, end } = ringCaps(spec);
        expect(Math.hypot(start.x - 100, start.y - 100)).toBeCloseTo(spec.R, 6);
        expect(Math.hypot(end.x - 100, end.y - 100)).toBeCloseTo(spec.R, 6);
        expect(start.x + end.x).toBeCloseTo(200, 6);
        expect(start.y).toBeCloseTo(end.y, 6);
    });

    it("有缺口时两端都在下半、分居中轴两侧", () => {
        const { start, end } = ringCaps(base({ arcSpan: TAU - 1.28 }));
        expect(start.y).toBeGreaterThan(100);
        expect(end.y).toBeGreaterThan(100);
        expect(start.x).toBeLessThan(100);
        expect(end.x).toBeGreaterThan(100);
    });
});

describe("ringCapPath", () => {
    it("半圆的两端正好落在环的内外缘上（与弧的平头零重叠）", () => {
        const spec = base({ total: 4, arcSpan: TAU - 1.28 });
        const d = ringCapPath(spec, "start");
        const nums = d.match(/-?\d+\.?\d*/g)!.map(Number);
        const [ox, oy] = [nums[0], nums[1]];
        const [ix, iy] = [nums[nums.length - 2], nums[nums.length - 1]];
        expect(Math.hypot(ox - 100, oy - 100)).toBeCloseTo(spec.R + spec.W, 2);
        expect(Math.hypot(ix - 100, iy - 100)).toBeCloseTo(spec.R - spec.W, 2);
    });

    it("两端帽朝相反方向凸出（sweep 相反）", () => {
        const spec = base({ total: 4, arcSpan: TAU - 1.28 });
        expect(ringCapPath(spec, "start").trim().endsWith("Z")).toBe(true);
        // A 段的最后一个 flag 就是 sweep
        const sweepOf = (d: string) => d.split("A")[1].trim().split(/\s+/)[4];
        expect(sweepOf(ringCapPath(spec, "start"))).toBe("0");
        expect(sweepOf(ringCapPath(spec, "end"))).toBe("1");
    });

    it("径向半径恒等于半个环宽，bulge 只收切向那一轴", () => {
        const spec = base({ total: 4, arcSpan: TAU - 1.28 });
        const radii = (d: string) => d.split("A")[1].trim().split(/\s+/).slice(0, 2).map(Number);
        const [r1, t1] = radii(ringCapPath(spec, "start", 1));
        const [r2, t2] = radii(ringCapPath(spec, "start", 0.6));
        expect(r1).toBeCloseTo(spec.W, 3);
        expect(r2).toBeCloseTo(spec.W, 3);          // ← 径向不随 bulge 变
        expect(t1).toBeCloseTo(spec.W, 3);
        expect(t2).toBeCloseTo(spec.W * 0.6, 3);    // ← 收的是切向
    });

    it("端帽收窄时，它多占的角也跟着变小", () => {
        expect(capOvershoot(86.5, 13.5, 0.6)).toBeLessThan(capOvershoot(86.5, 13.5, 1));
        expect(capOvershoot(86.5, 13.5, 1)).toBeCloseTo(Math.asin(13.5 / 86.5), 12);
    });

    it("圆帽圆心就是 ringCaps 给的点", () => {
        const spec = base({ total: 4, arcSpan: TAU - 1.28 });
        const d = ringCapPath(spec, "start");
        const nums = d.match(/-?\d+\.?\d*/g)!.map(Number);
        const mid = { x: (nums[0] + nums[nums.length - 2]) / 2, y: (nums[1] + nums[nums.length - 1]) / 2 };
        const { start } = ringCaps(spec);
        expect(mid.x).toBeCloseTo(start.x, 2);
        expect(mid.y).toBeCloseTo(start.y, 2);
    });
});

describe("capOvershoot —— 缺口必须把圆头算进去（2026-08-05 回归）", () => {
    /*
     * ⚠ 这一组钉的是本次修掉的 bug：老代码算缺口时**只让开了导航胶囊**，
     *   没让开两端圆头，结果圆头凸进缺口压住胶囊肩膀。
     */
    it("等于 asin(W/R)，不是 atan", () => {
        expect(capOvershoot(64, 10)).toBeCloseTo(Math.asin(10 / 64), 12);
        expect(capOvershoot(64, 10)).toBeGreaterThan(Math.atan(10 / 64));
    });

    it("笔越粗、半径越小，占的角越大", () => {
        expect(capOvershoot(64, 20)).toBeGreaterThan(capOvershoot(64, 10));
        expect(capOvershoot(32, 10)).toBeGreaterThan(capOvershoot(64, 10));
    });

    it("W 追平 R 时退化为直角，不会 NaN", () => {
        expect(capOvershoot(10, 10)).toBeCloseTo(Math.PI / 2, 12);
        expect(Number.isNaN(capOvershoot(10, 20))).toBe(false);
    });

    it("按「让开量 + 圆头」定出的 arcSpan，圆头墨迹正好停在让开边界上", () => {
        const R = 64, W = 10;
        const clearHalf = 0.4884;                       // 胶囊要求让开的半角（弧度）
        const arcSpan = TAU - 2 * (clearHalf + capOvershoot(R, W));
        const { start } = ringCaps(base({ R, W, total: 4, arcSpan }));

        // 圆头圆心的角度，换算成「距正下方多少」
        const fromBottom = Math.abs(Math.atan2(start.x - 100, start.y - 100));
        // 圆头朝缺口凸出，所以墨迹边界比圆心角更**靠近**正下方 —— 是减不是加。
        expect(fromBottom - capOvershoot(R, W)).toBeCloseTo(clearHalf, 6);
        // 圆心本身则要退到让开量之外
        expect(fromBottom).toBeCloseTo(clearHalf + capOvershoot(R, W), 6);
    });

    it("漏算圆头时，墨迹会侵进让开区（老 bug 的形状）", () => {
        const R = 64, W = 10;
        const clearHalf = 0.4884;
        const buggy = TAU - 2 * clearHalf;              // ← 只让开胶囊，没算圆头
        const { start } = ringCaps(base({ R, W, total: 4, arcSpan: buggy }));
        const fromBottom = Math.abs(Math.atan2(start.x - 100, start.y - 100));
        // 圆心只退到让开边界上，圆头再往里凸 —— 墨迹于是压过界，正是老 bug 的形状
        expect(fromBottom).toBeCloseTo(clearHalf, 6);
        expect(fromBottom - capOvershoot(R, W)).toBeLessThan(clearHalf);
    });
});
