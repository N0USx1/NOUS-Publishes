/**
 * 纯文本工具。**不依赖任何 Foundry 全局**，所以能在 vitest 里直接单测。
 *
 * ⚠ 别把这里的函数搬回 wheel-app.ts —— 那个模块顶层就取 `foundry.applications.api`，
 *   一旦被测试导入就会 `ReferenceError: foundry is not defined`（2026-08-05 踩过）。
 *   纯逻辑与 Foundry 耦合的代码分开放，是为了让前者可测。
 */

/** 中日韩字符（含全角标点）算 1 个宽度单位，其余算半个。 */
export function charWidth(ch: string): number {
    return /[　-〿一-鿿＀-￯]/.test(ch) ? 1 : 0.5;
}

/** 一段文字的显示宽度（单位同 charWidth）。 */
export function textWidth(s: string): number {
    return [...s].reduce((n, c) => n + charWidth(c), 0);
}

/**
 * 按显示宽度断行，中英混排通用。
 *
 * ⚠ 早先的版本是**逐字断**的（为中文写的），结果英文会从单词中间劈开、
 *   还留下前导空格 —— 2026-08-05 实机看到 `"...spend ◆ to draw it"` / `" first."`。
 *   现在按 token 断：**拉丁词整体不拆**，CJK 每字自成一 token（中文本来就没词边界）。
 */
export function wrapText(text: string, maxUnits: number): string[] {
    // 切成 token：CJK 字符各自成词，空白单独成 token，其余连续非空白算一个词
    const tokens = text.match(/[　-〿一-鿿＀-￯]|\s+|[^\s　-〿一-鿿＀-￯]+/g) ?? [];

    const lines: string[] = [];
    let cur = "";
    let w = 0;

    for (const tk of tokens) {
        const tw = textWidth(tk);
        if (/^\s+$/.test(tk)) {
            // 空白：行首丢弃（避免前导空格），行中保留
            if (cur) { cur += tk; w += tw; }
            continue;
        }
        if (w + tw > maxUnits && cur) {
            lines.push(cur.trimEnd());
            cur = "";
            w = 0;
        }
        cur += tk;
        w += tw;
    }
    if (cur.trim()) lines.push(cur.trimEnd());
    return lines;
}
