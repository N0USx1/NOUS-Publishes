import { describe, it, expect } from "vitest";
import { sectorPath, sectorCentroid, hitTest } from "../src/geometry";

describe("sectorPath", () => {
    // ★ 语义 2026-08-05 改过：原先是"第 0 扇区居中于正上方"，
    //   现在是"**整段弧**居中于正上方" —— 只有这样，arcSpan 小于整圆时
    //   缺口才会落在正下方给导航胶囊让位。整圆时第 0 扇区因此从正下方起算。
    it("整圆时第一个扇区从整段弧的起点（正下方）开始", () => {
        const d = sectorPath({ index: 0, total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 });
        expect(d).toMatch(/^M 100\.00 190\.00 /);
        expect(d).toContain("A 90 90");
        expect(d).toContain("A 55 55");
        expect(d.trim().endsWith("Z")).toBe(true);
    });

    it("扇区数变化时路径数量对应", () => {
        for (const total of [1, 3, 8]) {
            const paths = Array.from({ length: total }, (_, i) =>
                sectorPath({ index: i, total, rOuter: 90, rInner: 55, cx: 100, cy: 100 }));
            expect(new Set(paths).size).toBe(total);   // 每个扇区路径互不相同
        }
    });
});

describe("sectorCentroid", () => {
    it("四格整圆时，第 1、2 格的形心关于中轴对称且都在上半", () => {
        const a = sectorCentroid({ index: 1, total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 });
        const b = sectorCentroid({ index: 2, total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 });
        expect(a.x + b.x).toBeCloseTo(200, 0);
        expect(a.y).toBeLessThan(100);
        expect(b.y).toBeLessThan(100);
    });
});

describe("hitTest", () => {
    const base = { total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 };

    it("正下方命中第 0 扇区（整段弧从正下方起算）", () => {
        expect(hitTest(base, 100, 172)).toBe(0);
    });

    it("绕一圈时四格各被命中且互不相同", () => {
        const hits = [172, 0, 0, 0].map(() => 0);
        const seen = new Set<number>();
        for (let deg = 0; deg < 360; deg += 5) {
            const a = (deg * Math.PI) / 180;
            const h = hitTest(base, 100 + 72 * Math.cos(a), 100 + 72 * Math.sin(a));
            if (h >= 0) seen.add(h);
        }
        expect([...seen].sort()).toEqual([0, 1, 2, 3]);
        expect(hits.length).toBe(4);
    });

    it("中心毂内不命中", () => {
        expect(hitTest(base, 100, 100)).toBe(-1);
    });

    it("环外不命中", () => {
        expect(hitTest(base, 100, 0)).toBe(-1);
    });

    // 边界语义：判据是 dist < rInner / dist > rOuter，故边界线上算命中。
    // 亚像素级差异，实用上无影响，此处钉住行为防将来被无意改掉。
    it("恰好落在内外边界上算命中", () => {
        expect(hitTest(base, 100, 100 + 55)).toBeGreaterThanOrEqual(0);   // 内边界
        expect(hitTest(base, 100, 100 + 90)).toBeGreaterThanOrEqual(0);   // 外边界
    });
});

describe("arcSpan（底部缺口）", () => {
    const base = { total: 4, rOuter: 90, rInner: 56, cx: 100, cy: 100, arcSpan: Math.PI * 2 - 1.1 };

    it("扇区仍以正上方为中心", () => {
        const p = sectorCentroid({ ...base, index: 0 });
        // 4 格时第 0 格居中偏左，第 1、2 格跨顶部；取整段中点验证对称
        const first = sectorCentroid({ ...base, index: 0 });
        const last = sectorCentroid({ ...base, index: 3 });
        expect(first.x + last.x).toBeCloseTo(200, 0);   // 关于 cx=100 左右对称
        expect(p.y).toBeLessThan(200);
    });

    it("正下方落在缺口里，不命中任何扇区", () => {
        expect(hitTest(base, 100, 100 + 73)).toBe(-1);
    });

    it("正上方仍然命中", () => {
        expect(hitTest(base, 100, 100 - 73)).toBeGreaterThanOrEqual(0);
    });

    it("命中下标始终在合法范围内", () => {
        for (let deg = 0; deg < 360; deg += 7) {
            const a = (deg * Math.PI) / 180;
            const hit = hitTest(base, 100 + 73 * Math.cos(a), 100 + 73 * Math.sin(a));
            expect(hit).toBeGreaterThanOrEqual(-1);
            expect(hit).toBeLessThan(base.total);
        }
    });
});
