import { sectorPath, sectorCentroid } from "./geometry";
import type { WheelLevel, SectorData } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const R_OUTER = 90;
const R_INNER = 55;
const CX = 100;
const CY = 100;
const SIZE = 320;   // 窗口边长（像素）

const AppV2 = foundry.applications.api.ApplicationV2;

/** 中心毂一行能放几个"全宽字"。毂半径 55、字号 5.5，留边后约 15。 */
const HUB_CHARS_PER_LINE = 15;

/** 把 v 夹在 [lo, hi] 内。窗口比轮盘还小时以 lo 为准（hi 会小于 lo）。 */
function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(v, hi));
}

/** 中日韩字符（含全角标点）算 1 个宽度单位，其余算半个。 */
function charWidth(ch: string): number {
    return /[　-〿一-鿿＀-￯]/.test(ch) ? 1 : 0.5;
}

/**
 * 按显示宽度断行。中英混排下按字符宽度累加，超了就换行。
 * 中文没有词边界，所以逐字断；英文单词若被拆开也可接受（毂里都是短句）。
 */
export function wrapText(text: string, maxUnits: number): string[] {
    const lines: string[] = [];
    let cur = "";
    let w = 0;
    for (const ch of text) {
        const cw = charWidth(ch);
        if (w + cw > maxUnits && cur) {
            lines.push(cur);
            cur = "";
            w = 0;
        }
        cur += ch;
        w += cw;
    }
    if (cur) lines.push(cur);
    return lines;
}

export class WheelApp extends AppV2 {
    static DEFAULT_OPTIONS = {
        id: "player-action-ui-hub-wheel",
        classes: ["pauih-wheel"],
        window: { frame: false, positioned: true },
        position: { width: SIZE, height: SIZE },
    };

    /** 当前层 */
    private level: WheelLevel;
    /** 点击扇区的回调，由外部注入 */
    private onPick: (sector: SectorData) => void;
    /** 点击盘外关闭用的监听器，记着以便解绑 */
    private outsideHandler?: (ev: MouseEvent) => void;
    /** Esc 关闭用的监听器（Foundry 不管无框窗，见 openAt 注释），记着以便解绑 */
    private escHandler?: (ev: KeyboardEvent) => void;

    constructor(level: WheelLevel, onPick: (s: SectorData) => void, options: object = {}) {
        super(options);
        this.level = level;
        this.onPick = onPick;
    }

    /** 换一层内容并重绘（钻取与双向绑定都走这里） */
    async setLevel(level: WheelLevel): Promise<void> {
        this.level = level;
        await this.render(false);
    }

    // ⚠ 计划原文写的返回类型是 Promise<HTMLElement>，tsc 报 TS2740：
    //   SVGSVGElement 不是 HTMLElement。这里按实际产物改成 SVGElement。
    //   AppV2 对 _renderHTML 的返回值不限类型，它只是原样传给 _replaceHTML。
    async _renderHTML(): Promise<SVGElement> {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", `0 0 ${SIZE / 1.6} ${SIZE / 1.6}`);
        svg.setAttribute("class", "pauih-svg");

        const total = this.level.sectors.length;
        this.level.sectors.forEach((sector, index) => {
            const spec = { index, total, rOuter: R_OUTER, rInner: R_INNER, cx: CX, cy: CY, gap: 0.02 };

            const path = document.createElementNS(SVG_NS, "path");
            path.setAttribute("d", sectorPath(spec));
            // 三态各有自己的 class：risky 不变暗，只加琥珀标记（设计定档 §6.4）
            path.setAttribute("class", `pauih-sector state-${sector.state}`);
            path.dataset.index = String(index);
            svg.appendChild(path);

            const c = sectorCentroid(spec);
            const text = document.createElementNS(SVG_NS, "text");
            text.setAttribute("x", String(c.x));
            text.setAttribute("y", String(c.y));
            text.setAttribute("class", "pauih-label");
            text.textContent = sector.label;
            text.dataset.index = String(index);
            svg.appendChild(text);

            if (sector.badge) {
                const badge = document.createElementNS(SVG_NS, "text");
                badge.setAttribute("x", String(c.x));
                badge.setAttribute("y", String(c.y + 9));
                badge.setAttribute("class", `pauih-badge state-${sector.state}`);
                badge.textContent = sector.badge;
                badge.dataset.index = String(index);
                svg.appendChild(badge);
            }
        });

        // 中心毂
        const hub = document.createElementNS(SVG_NS, "circle");
        hub.setAttribute("cx", String(CX));
        hub.setAttribute("cy", String(CY));
        hub.setAttribute("r", String(R_INNER));
        hub.setAttribute("class", "pauih-hub");
        svg.appendChild(hub);

        // 中心毂文字：一个容器，内容由 #paintHub 填，悬停时重填
        const hubText = document.createElementNS(SVG_NS, "g");
        hubText.setAttribute("class", "pauih-hub-text");
        svg.appendChild(hubText);
        this.#paintHub(hubText, null);

        return svg;
    }

    /**
     * 重画中心毂文字。
     *
     * ⚠ SVG 的 `<text>` **没有自动换行**（不像 HTML），整句塞进去会横着冲出轮盘、
     * 盖住扇区 —— 2026-08-04 实机就是这么翻车的。必须自己断行成多个 `<tspan>`。
     *
     * @param sector 悬停中的扇区；null = 没悬停，只显示层标题
     */
    #paintHub(g: SVGGElement, sector: SectorData | null): void {
        g.replaceChildren();

        const line = (text: string, y: number, cls: string): void => {
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(CX));
            t.setAttribute("y", String(y));
            t.setAttribute("class", cls);
            t.textContent = text;
            g.appendChild(t);
        };

        if (!sector) {
            line(this.level.title, CY, "pauih-hub-title");
            return;
        }

        // 有悬停：第一行项目名，下面是断好行的原因
        const reasonLines = sector.reason ? wrapText(sector.reason, HUB_CHARS_PER_LINE) : [];
        const lineHeight = 7;
        // 整块（标题 + 原因）垂直居中于毂心
        const blockHeight = (reasonLines.length ? reasonLines.length * lineHeight + 5 : 0);
        let y = CY - blockHeight / 2;

        line(sector.label, y, "pauih-hub-title");
        y += 9;
        for (const l of reasonLines) {
            line(l, y, `pauih-hub-reason state-${sector.state}`);
            y += lineHeight;
        }
    }

    _replaceHTML(result: SVGElement, content: HTMLElement): void {
        content.replaceChildren(result);
        content.addEventListener("click", this.#onClick);
        content.addEventListener("mouseover", this.#onHover);
    }

    #onClick = (ev: MouseEvent): void => {
        const el = ev.target as HTMLElement;
        const idx = el?.dataset?.index;
        if (idx === undefined) return;
        const sector = this.level.sectors[Number(idx)];
        if (sector) this.onPick(sector);
    };

    #onHover = (ev: MouseEvent): void => {
        const el = ev.target as HTMLElement;
        const idx = el?.dataset?.index;
        const g = this.element?.querySelector(".pauih-hub-text") as SVGGElement | null;
        if (!g) return;
        const sector = idx === undefined ? null : (this.level.sectors[Number(idx)] ?? null);
        this.#paintHub(g, sector);
    };

    /**
     * 在指定屏幕坐标处弹出（**以该点为圆心**），并接管 Esc 与点击盘外关闭。
     * 靠近屏幕边缘时会把盘面拉回可视区内，否则贴边呼出会有半个盘在屏幕外、扇区点不到。
     */
    async openAt(x: number, y: number): Promise<void> {
        await this.render(true);

        const margin = 4;
        const left = clamp(x - SIZE / 2, margin, window.innerWidth - SIZE - margin);
        const top = clamp(y - SIZE / 2, margin, window.innerHeight - SIZE - margin);
        this.setPosition({ left, top });

        this.outsideHandler = (ev: MouseEvent) => {
            if (!this.element?.contains(ev.target as Node)) void this.close();
        };
        // ★ Esc 必须自己接管，不能指望 Foundry。
        //   实读 client/helpers/interaction/client-keybindings.mjs:754-756：
        //   Esc 遍历 foundry.applications.instances 时有一道 `if (app.hasFrame)` 门槛，
        //   而我们是无框窗（window.frame:false）→ hasFrame 为假 → Foundry 永远不会关我们。
        //   （2026-08-04 实测确认：不挂这个监听，Esc 对轮盘完全无效。）
        this.escHandler = (ev: KeyboardEvent) => {
            if (ev.key !== "Escape") return;
            ev.preventDefault();
            ev.stopPropagation();     // 别让 Esc 继续冒泡去开主菜单
            void this.close();
        };

        // 延后一帧挂载，避免呼出那一次点击立刻把自己关掉
        setTimeout(() => {
            document.addEventListener("mousedown", this.outsideHandler!);
            document.addEventListener("keydown", this.escHandler!, { capture: true });
        }, 0);
    }

    async close(options: object = {}): Promise<this> {
        if (this.outsideHandler) {
            document.removeEventListener("mousedown", this.outsideHandler);
            this.outsideHandler = undefined;
        }
        if (this.escHandler) {
            document.removeEventListener("keydown", this.escHandler, { capture: true });
            this.escHandler = undefined;
        }
        return super.close(options) as Promise<this>;
    }
}
