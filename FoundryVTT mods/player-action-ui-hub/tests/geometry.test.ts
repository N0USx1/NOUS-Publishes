import { describe, it, expect } from "vitest";
import { sectorPath, sectorCentroid, hitTest } from "../src/geometry";

describe("sectorPath", () => {
    it("四等分时第一个扇区从正上方开始", () => {
        const d = sectorPath({ index: 0, total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 });
        // 起点应在圆心正上方偏左 45°：cx + 90*cos(-135°) ≈ 36.36, cy + 90*sin(-135°) ≈ 36.36
        expect(d).toMatch(/^M 36\.36 36\.36 /);
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
    it("四等分第一个扇区的形心在正上方", () => {
        const p = sectorCentroid({ index: 0, total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 });
        expect(p.x).toBeCloseTo(100, 1);
        expect(p.y).toBeLessThan(100);
    });
});

describe("hitTest", () => {
    const base = { total: 4, rOuter: 90, rInner: 55, cx: 100, cy: 100 };

    it("正上方命中第 0 扇区", () => {
        expect(hitTest(base, 100, 30)).toBe(0);
    });

    it("正右方命中第 1 扇区", () => {
        expect(hitTest(base, 170, 100)).toBe(1);
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
        expect(hitTest(base, 100, 100 - 55)).toBe(0);   // 内边界
        expect(hitTest(base, 100, 100 - 90)).toBe(0);   // 外边界
    });
});
