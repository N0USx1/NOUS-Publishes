import { sectorPath, sectorCentroid } from "./geometry";
import type { WheelLevel, SectorData } from "./types";
import { wrapText } from "./text";
import { glyphs } from "./economy";

const SVG_NS = "http://www.w3.org/2000/svg";
// 比例照 Nous 2026-08-05 的 mockup 量出来（毂/外环 ≈ 0.78，环比想象中细）
const R_OUTER = 74;
// 中心毂半径。★ 2026-08-05 演进：55 → 42（给长名字让路）→ 56 → 59
// （按 mockup 实量的 0.78 比例；名字已交给毂显示，环不需要那么粗）。
const R_INNER = 50;
const CX = 100;
const CY = 100;
const SIZE = 320;   // 窗口边长（像素）

const AppV2 = foundry.applications.api.ApplicationV2;

/** 中心毂一行能放几个"全宽字"。毂半径 56、字号 5.2，留边后约 16。 */
const HUB_CHARS_PER_LINE = 16;

/**
 * 导航胶囊：**横着的一块圆角条**，坐在环底缺口里（Nous 2026-08-05 定）。
 *
 * ★ 为什么不做成弧形：弧形要拟合极坐标去还原一个只能目测的形状，我连着三版
 *   比例都没对上。矩形＋圆角没有可估错的量，而且横条比弧形段更好点中。
 */
const CAP_W = 66;        // 整条宽
const CAP_H = 19;        // 高
const CAP_R = 9;         // 圆角半径 ≈ 半高，两端就是半圆头
/**
 * 顶边 y。取 164 使胶囊上半截**嵌进环带**（环底外缘 y=174），
 * 只有下半截露在环外 —— mockup 里它是"从环底切出来的一块"，不是挂在环下面的另一个牌子。
 * 第一版取 172 就是只压了 2 个单位，看上去成了浮在环下的独立药丸。
 */
const CAP_TOP = 164;

/**
 * 环底缺口的张角（弧度）。扇区只铺 `2π - 这个值`，剩下的留给导航胶囊。
 *
 * ★ **算出来的，不是估的**：缺口两条径向切边必须在胶囊**上边角**处让开
 *   `CAP_W/2 + 留白`，否则胶囊的肩膀会压到环上。
 *   上边角离圆心的纵向距离 = CAP_TOP - CY；切边半角 θ = atan(需让开的横向距离 / 该纵距)。
 *   estimate 一个角度是当初对不上 mockup 的老毛病，这里直接解出来。
 */
const CAP_GUTTER = 1;    // 胶囊肩膀与环切边之间的留白
const GAP_ANGLE = 2 * Math.atan((CAP_W / 2 + CAP_GUTTER) / (CAP_TOP - CY));
/** 扇区实际占的弧长 */
const ARC_SPAN = Math.PI * 2 - GAP_ANGLE;

/**
 * 多久没动就自动收起（毫秒）。Nous 2026-08-05：晾着不动会挡视野。
 * 任何交互都会重新计时；执行动作后本来就会关，所以这条只对"呼出了又不用"生效。
 */
const IDLE_DISMISS_MS = 5000;

/** 把 v 夹在 [lo, hi] 内。窗口比轮盘还小时以 lo 为准（hi 会小于 lo）。 */
function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(v, hi));
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
    /**
     * 点击扇区的回调，由外部注入。
     * ⚠ 第二个参数是**真实的 MouseEvent**，不是合成的：掷骰时要原样传给
     *   pf2e 的 `variant.roll({ event })`，生态里的模组（PF2e Toolbelt 自动掩护等）
     *   靠它拿检定上下文（设计定档 §6.3）。
     */
    private onPick: (sector: SectorData, ev: MouseEvent) => void;
    /** 点击盘外关闭用的监听器，记着以便解绑 */
    private outsideHandler?: (ev: MouseEvent) => void;
    /** Esc 关闭用的监听器（Foundry 不管无框窗，见 openAt 注释），记着以便解绑 */
    private escHandler?: (ev: KeyboardEvent) => void;

    constructor(
        level: WheelLevel,
        onPick: (s: SectorData, ev: MouseEvent) => void,
        options: object = {},
    ) {
        super(options);
        this.level = level;
        this.onPick = onPick;
    }

    /**
     * 重算当前层的回调，由外部注入；**没有它就不会自动刷新**。
     * 返回 null 表示这一层已经无内容可显示（例如角色的打击全没了）→ 关盘。
     */
    rebuild?: () => WheelLevel | null;

    /** refresh 的合并闸，见 refresh() 的注释 */
    #refreshQueued = false;

    /**
     * 取动作经济现状的回调，由外部注入。
     * **不在战斗中要返回 null** —— 战斗外没有"回合"，画 ◆◆◇ 是假信息。
     */
    economy?: () => { remaining: number; canUndo: boolean } | null;

    /** 点了撤回时调用，由外部注入（真正的记账退还在外面做）。 */
    onUndo?: () => void;

    /** 无操作自动收起的计时器 */
    #idleTimer?: ReturnType<typeof setTimeout>;

    /** 换一层内容并重绘（钻取与双向绑定都走这里） */
    async setLevel(level: WheelLevel): Promise<void> {
        this.level = level;
        await this.render(false);
    }

    /**
     * 角色数据变了：重算当前层并重绘。轮盘＝角色卡的另一个实时视图，
     * 靠这个方法兑现。
     *
     * ⚠ **必须合并**：一次拔刀会连着放出好几个文档钩子
     * （物品的 equipped 变了 → updateItem，派生数据重算 → updateActor），
     * 每个都直接 render 会在同一帧里重绘好几次，白闪且互相抢。
     * 这里推迟到下一个宏任务再做，把这一串合成一次。
     *
     * 层结构不变时保留翻选条的下标——玩家翻到第 2 击，不该因为拔了把刀就跳回第 1 击。
     */
    async refresh(): Promise<void> {
        if (!this.rebuild || this.#refreshQueued) return;
        this.#refreshQueued = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
        this.#refreshQueued = false;

        // 等这一帧的工夫里可能已经关盘/回到上一层了
        if (!this.rendered || !this.rebuild) return;

        const next = this.rebuild();
        if (!next) { await this.close(); return; }
        if (this.level.variant && next.variant) next.variant.index = this.level.variant.index;
        await this.setLevel(next);
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
            const spec = { index, total, rOuter: R_OUTER, rInner: R_INNER,
                           cx: CX, cy: CY, gap: 0.02, arcSpan: ARC_SPAN };

            const path = document.createElementNS(SVG_NS, "path");
            path.setAttribute("d", sectorPath(spec));
            // 三态各有自己的 class：risky 不变暗，只加琥珀标记（设计定档 §6.4）
            path.setAttribute("class", `pauih-sector state-${sector.state}`);
            path.dataset.index = String(index);
            svg.appendChild(path);

            const c = sectorCentroid(spec);

            if (sector.img) {
                // ★ 有图标就**只画图标**：名字交给中心毂在悬停时显示，
                //   长名字因此不可能压出扇区（见 types.ts 的 img 注释）。
                const size = 18;
                const img = document.createElementNS(SVG_NS, "image");
                img.setAttribute("href", sector.img);
                img.setAttribute("x", String(c.x - size / 2));
                img.setAttribute("y", String(c.y - size / 2 - (sector.badge ? 3 : 0)));
                img.setAttribute("width", String(size));
                img.setAttribute("height", String(size));
                img.setAttribute("class", `pauih-icon state-${sector.state}`);
                img.dataset.index = String(index);
                svg.appendChild(img);
            } else {
                const text = document.createElementNS(SVG_NS, "text");
                text.setAttribute("x", String(c.x));
                text.setAttribute("y", String(c.y));
                text.setAttribute("class", "pauih-label");
                text.textContent = sector.label;
                text.dataset.index = String(index);
                svg.appendChild(text);
            }

            if (sector.badge) {
                const badge = document.createElementNS(SVG_NS, "text");
                badge.setAttribute("x", String(c.x));
                badge.setAttribute("y", String(c.y + (sector.img ? 8 : 9)));
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

        // ★ 内圈亮色描边：mockup 里最醒目的一条，把毂和扇区环分开。
        //   单独一个 circle 而不是给 hub 加 stroke —— 描边要压在扇区之上才不会被切断。
        const rim = document.createElementNS(SVG_NS, "circle");
        rim.setAttribute("cx", String(CX));
        rim.setAttribute("cy", String(CY));
        rim.setAttribute("r", String(R_INNER));
        rim.setAttribute("class", "pauih-rim");
        svg.appendChild(rim);

        // 底部导航胶囊：挂在环底缺口下方，探出环外
        this.#paintCapsule(svg);

        // 中心毂文字：一个容器，内容由 #paintHub 填，悬停时重填
        const hubText = document.createElementNS(SVG_NS, "g");
        hubText.setAttribute("class", "pauih-hub-text");
        svg.appendChild(hubText);
        this.#paintHub(hubText, null);

        return svg;
    }

    /**
     * 画底部导航胶囊（照 Nous 2026-08-05 的 mockup）。
     *
     * 三格：‹ 上一项 · ↩ 返回 · › 下一项。
     * **它是通用导航条**：上面这一层是什么，‹› 就翻什么 ——
     * 打击层翻 MAP 三段，将来条目多到要分页时就翻页。
     * 没得翻时箭头置灰不可点，但格子照画，免得胶囊忽宽忽窄。
     */
    #paintCapsule(svg: SVGElement): void {
        const v = this.level.variant;
        const canCycle = !!v && v.labels.length > 1;
        const cells = [
            { action: "prev", glyph: "‹", enabled: canCycle },
            { action: "back", glyph: "↩", enabled: this.level.canGoBack },
            { action: "next", glyph: "›", enabled: canCycle },
        ];

        const cellW = CAP_W / cells.length;
        const left = CX - CAP_W / 2;

        cells.forEach((cell, index) => {
            const x = left + index * cellW;
            // 只有两端要圆角：中间那格是直的。用 rx 会四角全圆，
            // 所以整条底下先垫一个圆角矩形，格子画在它上面、靠描边分隔。
            const r = document.createElementNS(SVG_NS, "rect");
            r.setAttribute("x", String(x));
            r.setAttribute("y", String(CAP_TOP));
            r.setAttribute("width", String(cellW));
            r.setAttribute("height", String(CAP_H));
            if (index === 0 || index === cells.length - 1) {
                r.setAttribute("rx", String(CAP_R));
                r.setAttribute("ry", String(CAP_R));
            }
            r.setAttribute("class", `pauih-cap${cell.enabled ? "" : " disabled"}`);
            if (cell.enabled) r.dataset.nav = cell.action;
            svg.appendChild(r);

            // 两端那格的圆角会把朝内那侧也削圆，补一个方块把内侧填平
            if (index === 0 || index === cells.length - 1) {
                const patch = document.createElementNS(SVG_NS, "rect");
                patch.setAttribute("x", String(index === 0 ? x + cellW - CAP_R : x));
                patch.setAttribute("y", String(CAP_TOP));
                patch.setAttribute("width", String(CAP_R));
                patch.setAttribute("height", String(CAP_H));
                patch.setAttribute("class", `pauih-cap${cell.enabled ? "" : " disabled"}`);
                if (cell.enabled) patch.dataset.nav = cell.action;
                svg.appendChild(patch);
            }

            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(x + cellW / 2));
            t.setAttribute("y", String(CAP_TOP + CAP_H / 2));
            t.setAttribute("class", `pauih-cap-glyph${cell.enabled ? "" : " disabled"}`);
            t.textContent = cell.glyph;
            svg.appendChild(t);
        });
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

        // 翻选已移到底部胶囊里，毂文字可以正正居中
        const center = CY;

        if (!sector) {
            line(this.level.title, center, "pauih-hub-title");
        } else {
            // 有悬停：第一行项目名，下面是断好行的原因
            const reasonLines = sector.reason ? wrapText(sector.reason, HUB_CHARS_PER_LINE) : [];
            const lineHeight = 7;
            // 整块（标题 + 原因）垂直居中于 center
            const blockHeight = (reasonLines.length ? reasonLines.length * lineHeight + 5 : 0);
            let y = center - blockHeight / 2;

            line(sector.label, y, "pauih-hub-title");
            y += 9;
            for (const l of reasonLines) {
                line(l, y, `pauih-hub-reason state-${sector.state}`);
                y += lineHeight;
            }
        }

        // MAP 三段的当前项，例 "◆ +9 (MAP -5)"。
        //
        // ★ **少了这一行，翻选就是完全无反馈的。** 2026-08-05 实测复现：
        //   点胶囊的 › 之后 `variant.index` 确实由 0 变成 1，但屏幕上一个像素都没变，
        //   玩家无从知道自己下一击算的是第几段 —— 而 MAP 恰恰是 PF2e 最容易算错的一处，
        //   把它显示出来正是本模组的根理（设计定档 §0）。
        //   这行原本在毂里，把翻选箭头挪进底部胶囊时被一起删掉了，是那次改版的漏网。
        //   （`.pauih-variant` 的样式当时留了下来，所以这里不需要新样式。）
        if (this.level.variant?.labels.length) {
            const v = this.level.variant;
            line(v.labels[v.index] ?? "", CY + 16, "pauih-variant");
        }

        this.#paintEconomy(g);
    }

    /**
     * 毂底的动作经济行：三个菱形 + 一个红色 « 撤回（Nous 2026-08-05 定的形态）。
     *
     * ★ **系统不记这件事**，这是我们自己的账（见 economy.ts 顶部）；
     *   **只显示不阻止**，余额为负也照实画出来。
     * ⚠ 撤回退的是**动作点记账**，不是把骰子收回来 —— 已经进聊天栏的收不回。
     */
    #paintEconomy(g: SVGGElement): void {
        const econ = this.economy?.();
        if (!econ) return;                     // 不在战斗中：没有回合，画点数是假信息

        const y = CY + 27;
        const pipDx = 8;
        const pips = glyphs(econ.remaining);
        const startX = CX - ((pips.length - 1) * pipDx) / 2 - 7;

        [...pips].forEach((ch, i) => {
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(startX + i * pipDx));
            t.setAttribute("y", String(y));
            t.setAttribute("class", `pauih-pip${ch === "◆" ? " full" : ch === "✕" ? " over" : ""}`);
            t.textContent = ch;
            g.appendChild(t);
        });

        const undo = document.createElementNS(SVG_NS, "text");
        undo.setAttribute("x", String(startX + pips.length * pipDx + 3));
        undo.setAttribute("y", String(y));
        undo.setAttribute("class", `pauih-undo${econ.canUndo ? "" : " disabled"}`);
        undo.textContent = "«";
        if (econ.canUndo) undo.dataset.nav = "undo";
        g.appendChild(undo);
    }

    /** 当前变体下标（0 = 第 1 击）；这一层没有翻选条时返回 0。 */
    currentVariantIndex(): number {
        return this.level.variant?.index ?? 0;
    }

    _replaceHTML(result: SVGElement, content: HTMLElement): void {
        content.replaceChildren(result);
        content.addEventListener("click", this.#onClick);
        content.addEventListener("mouseover", this.#onHover);
        // 重绘会换掉内容，所以监听每次都要重挂。
        // ⚠ **这里绝不能顺手续期**：重绘不只来自用户操作，双向绑定的数据刷新
        //   也会重绘。写在这里的话，角色身上有个每几秒跳一次的效果，
        //   轮盘就永远不会自动收起（2026-08-05 实测到过）。只有真实交互才续期。
        content.addEventListener("mousemove", this.#touchIdle);
    }

    /**
     * 续上"无操作自动收起"的计时（Nous 2026-08-05 提出：晾着不动会挡视野）。
     * 任何交互——移动鼠标、点击、翻页、重绘——都会重新计时。
     */
    #touchIdle = (): void => {
        if (this.#idleTimer) clearTimeout(this.#idleTimer);
        this.#idleTimer = setTimeout(() => { void this.close(); }, IDLE_DISMISS_MS);
    };

    #onClick = (ev: MouseEvent): void => {
        this.#touchIdle();
        const el = ev.target as HTMLElement;

        // —— 底部胶囊导航：‹ 上一项 · ↩ 返回 · › 下一项 ——
        const nav = el?.dataset?.nav;
        if (nav) {
            const v = this.level.variant;
            if ((nav === "prev" || nav === "next") && v && v.labels.length) {
                // 后退写成 +(n-1) 而不是 -1：JS 的 % 对负数返回负值，直接减会得到 -1。
                v.index = (v.index + (nav === "next" ? 1 : v.labels.length - 1)) % v.labels.length;
                void this.render(false);
            } else if (nav === "undo") {
                this.onUndo?.();
                void this.render(false);
            } else if (nav === "back") {
                this.onPick({ id: "__back", label: "Back", cost: null, state: "normal" }, ev);
            }
            return;
        }

        const idx = el?.dataset?.index;
        if (idx === undefined) return;
        const sector = this.level.sectors[Number(idx)];
        if (sector) this.onPick(sector, ev);
    };

    #onHover = (ev: MouseEvent): void => {
        // ⚠ 这里**不续期**空闲计时：光标停着不动时，重绘换掉脚下的节点
        //   浏览器照样会补发一次 mouseover —— 那不是"用户在操作"。
        //   只有真正的指针移动（mousemove）与点击才算（2026-08-05 实测踩到）。
        const el = ev.target as HTMLElement;
        // ⚠ 翻选条自己不触发重画：它就住在毂文字那个 <g> 里，重画会把光标脚下的
        //   节点换掉，浏览器随即再发一次 mouseover → 无限重画。
        //   （其余毂内元素都是 pointer-events:none，只有它是可点的，所以只有它有这个问题。）
        if (el?.dataset?.nav !== undefined) return;

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

        this.#touchIdle();          // 开盘即开始倒数

        // 延后一帧挂载，避免呼出那一次点击立刻把自己关掉
        setTimeout(() => {
            document.addEventListener("mousedown", this.outsideHandler!);
            document.addEventListener("keydown", this.escHandler!, { capture: true });
        }, 0);
    }

    async close(options: object = {}): Promise<this> {
        // 关了就别再自动重算：钩子还会继续放，让它们扑空即可
        this.rebuild = undefined;
        if (this.outsideHandler) {
            document.removeEventListener("mousedown", this.outsideHandler);
            this.outsideHandler = undefined;
        }
        if (this.#idleTimer) {
            clearTimeout(this.#idleTimer);
            this.#idleTimer = undefined;
        }
        if (this.escHandler) {
            document.removeEventListener("keydown", this.escHandler, { capture: true });
            this.escHandler = undefined;
        }
        return super.close(options) as Promise<this>;
    }
}
