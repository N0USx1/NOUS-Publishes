import { describe, it, expect } from "vitest";
import { wrapText, textWidth } from "../src/text";

describe("wrapText", () => {
    it("英文按词断，不从单词中间劈开", () => {
        const lines = wrapText("Not drawn — spend to draw it first.", 15);
        for (const l of lines) {
            // 每行都不该以空白开头或结尾
            expect(l).toBe(l.trim());
        }
        // 重新拼起来应还原原句（空白归一化后）
        expect(lines.join(" ").replace(/\s+/g, " ")).toBe("Not drawn — spend to draw it first.");
    });

    it("不产生前导空格的行（2026-08-05 实机见过的 bug）", () => {
        const lines = wrapText("Stupefied 2: casting requires a DC 7 flat check or the spell is disrupted.", 15);
        expect(lines.every(l => !/^\s/.test(l))).toBe(true);
        expect(lines.every(l => l.length > 0)).toBe(true);
    });

    it("中文逐字断（没有词边界）", () => {
        const lines = wrapText("迟钝二施法需通过平骰否则法术中断", 5);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join("")).toBe("迟钝二施法需通过平骰否则法术中断");
    });

    it("单个超长词不会丢失，自成一行", () => {
        const lines = wrapText("supercalifragilistic ok", 5);
        expect(lines.join(" ")).toContain("supercalifragilistic");
        expect(lines.join(" ")).toContain("ok");
    });

    it("空串返回空数组", () => {
        expect(wrapText("", 15)).toEqual([]);
    });
});

describe("毂内状态行的断行预算（2026-08-05 实测标定）", () => {
    // ⚠ 单位是显示宽度：拉丁 0.5 / CJK 1。实测毂内第一行约放 43 个拉丁字符 = 21.5 单位。
    const 预算 = 21;

    it("★ 两条资源接起来（31 字符）不该断 —— 它实测宽 94px，毂内可用 131px", () => {
        expect(wrapText("Focus ✦ 0/1 · Hero Points ✦ 1/3", 预算).length).toBe(1);
    });

    it("★ 三条接起来（46 字符）必须断 —— 实测宽 138px 已经溢出 131px", () => {
        expect(wrapText("Focus ✦ 0/1 · Hero Points ✦ 1/3 · Mythic ✦ 2/3", 预算).length)
            .toBeGreaterThan(1);
    });

    it("断出来的每一行都在预算内", () => {
        for (const l of wrapText("Panache ✦ active · Cursebound ✦ 2 · Rage ✦ active", 预算)) {
            expect(textWidth(l)).toBeLessThanOrEqual(预算);
        }
    });
});
