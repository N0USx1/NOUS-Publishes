import { sectorArc, sectorCentroid, ringCapPath, capOvershoot } from "./geometry";
import type { WheelLevel, SectorData } from "./types";
import { wrapText } from "./text";
import { glyphs, reactionGlyph } from "./economy";
import { pageOf, pageCount, normalizePage } from "./paging";

const SVG_NS = "http://www.w3.org/2000/svg";
const CX = 100;
const CY = 100;
const SIZE = 320;   // 窗口边长（像素）

/*
 * ===== 环的几何：画笔扫掠（claude-draws skill，2026-08-05 重定）=====
 *
 * 只有 R_HUB / GUTTER / W 三个是**自由量**，其余全部由它们算出来。
 * 老版本把 R_OUTER 和 R_INNER 都当自由量填，两者耦合，调环宽必须同时动两个数。
 *
 * 三个数对着 mockup 逐层量测校准过（分层半径对拍）：
 *   毂 68.0% / 环内缘 73.0% / 环外缘 100%   ← 本组参数
 *   毂 67.7% / 环内缘 72.5% / 环外缘 100%   ← mockup 实测
 *
 * ★ 2026-08-05 第二轮（Nous 反馈）：R_OUTER 拉到 100，也就是**顶满 viewBox**——
 *   环的外缘就是 UI 边缘，不再留一圈空边。其余按 mockup 比例等比放大。
 *   顺带把环宽从 20 撑到 27，没有图标、走文字标签时不再挤出环外。
 */
const R_HUB  = 68;                    // 中心毂半径
const GUTTER = 5;                     // 毂与环之间的**切割**（留空，不画任何东西）
const W      = 13.5;                  // 笔半径 → 环宽 = 2W = 27
const R      = R_HUB + GUTTER + W;    // 环中线 = 86.5，笔尖走的那条圆
const R_OUTER = R + W;                // 100 —— 环的外缘
/**
 * SVG 用户坐标系的边长。★ 由 R_OUTER 定义，不是反过来 ——
 * 「环的外缘就是 UI 边缘」是设计意图（Nous 2026-08-05），写成 2×R_OUTER 之后
 * 这条意图就由几何保证了：改半径，画布跟着改，环永远贴边。
 * 旧代码写的是 `SIZE / 1.6`，那个 1.6 是个魔法数，和半径没有任何联系。
 *
 * 窗口像素 SIZE 与它的比值就是缩放（320 / 200 = 1.6×）。
 */
const VIEW = 2 * R_OUTER;

const AppV2 = foundry.applications.api.ApplicationV2;

/** 中心毂一行能放几个"全宽字"。毂半径 56、字号 5.2，留边后约 16。 */
const HUB_CHARS_PER_LINE = 16;

/*
 * ===== 中心毂的垂直节奏（2026-08-05 重排）=====
 *
 * ⚠ 上一版让职业状态行"从经济行往上凑"（`CY+20+(i-len)*6.5`），
 *   一行时算出来是 CY+13.5，正好压在 MAP 读数的 CY+16 上 —— Nous 截图里
 *   `✦ Focus 1/1` 和 `◆ +14` 叠成一团就是这么来的。
 *
 * ★ 改成**每一行各有固定槽位**，自上而下四段，互不挤占：
 *     标题块（层名 / 悬停项名 + 断行的原因）—— 块中心固定，内容多时向两侧长
 *     MAP 读数 或 页码 —— 二选一，永不同时出现（见 #arrowMode）
 *     职业状态 —— **强制一行**，多条用 " · " 接起来（毂里放不下两行）
 *     动作经济 —— 固定在最下
 *
 *   槽位固定的代价是没内容时留白，好处是**有内容时永远不会打架**，
 *   而且各行位置不随内容跳动。
 */
/** 标题+原因块的垂直中心。略高于毂心，给下面三行让路。 */
const HUB_TITLE_CENTER = CY - 4;
/** MAP 读数 / 页码 */
const HUB_VARIANT_Y = CY + 19;
/** 职业状态（单行） */
const HUB_STATE_Y = CY + 28;
/** 动作经济行（固定最下） */
const HUB_ECONOMY_Y = CY + 38;

/**
 * 底部导航胶囊 —— **它就是一段带端帽的分段弧**，和外环同构。
 *
 * ★ 2026-08-05 第三轮（Nous：「可不可以用外圆弧度去掰弯这个胶囊」）：
 *   从横排圆角条改成弧形，跟着外环的弧度走。改完之后它与外环共用同一套
 *   `sectorArc` / `ringCapPath` / `capOvershoot`，**一个新函数都没写** ——
 *   唯一的新东西是 RingSpec 的 `center`（整段弧的中心指向正下方）。
 *
 *   顺带把几何也简化了：矩形版要先算「上边角对圆心的张角」才知道缺口开多大；
 *   弧形版全是角度加法。四个矩形量（宽 / 顶边 y / 圆角 / 肩留白）换成两个角度量。
 *
 *   ⚠ 当初放弃弧形的理由写的是「弧形要拟合极坐标去还原一个只能目测的形状，
 *     连着三版比例都没对上」—— 挡路的是**目测**，不是弧形。现在不目测了。
 */
/**
 * 扇区之间的缝（弧度）。**整个盘面只有这一个缝隙尺度** ——
 * 环与胶囊之间也用它，视觉节奏才连得上（见 GAP_ANGLE 的推导）。
 */
const SECTOR_GAP = 0.02;

/**
 * 胶囊厚度（径向）。
 *
 * ★ 2026-08-05 由 23 改为 `2 * W` —— 与环**等宽**。
 *   原来窄 4（内缘 75 vs 73、外缘 98 vs 100），加上角向的缝偏大，
 *   胶囊看着是"飘在缺口里的另一个物件"而不是环上切下来的一段（Nous 指出）。
 *   等宽之后内外缘完全对齐，接缝只剩角向那一处。
 */
const CAP_H = 2 * W;
const W_CAP = CAP_H / 2;                   // 胶囊的"笔半径"
const CAP_SEAM = 1.6;                      // 格与格之间的缝（弧长），露底作分隔
/** 胶囊墨迹一共跨多少角（**含**它自己两端的圆头） */
const CAP_INK = (56 * Math.PI) / 180;

/**
 * 环端帽往外凸多少（1 = 满半圆，小于 1 沿切向收扁）。
 * 这个旋钮管的是端头胖瘦，与缝隙是两个维度，需要时再调。
 */
const CAP_BULGE = 1;

/**
 * 环底缺口的张角。
 *
 * ★★ **解出来的，不是估的**（2026-08-05 重推，claude-draws 的规矩）。
 *
 *   上一版写的是 `CAP_INK + 2*CAP_CLEAR + 2*capOvershoot(...)`，把 `CAP_CLEAR`
 *   当成"墨迹之间的留白"来填。但那两者不是一回事 —— 实测量出来墨迹缝隙是
 *   **5.1°**，而 `CAP_CLEAR` 填的是 4°，且扇区之间的缝只有 1.15°，
 *   三个数对不上，胶囊于是看着没接上。
 *
 *   差值来自两处**被漏掉的收缩**：扇区首尾各让出 `SECTOR_GAP/2`，
 *   胶囊首尾也各让出自己那份缝的一半。把它们算进去，反解出缺口该多大：
 *
 *     环墨迹末端（距正下方） = GAP_ANGLE/2 + SECTOR_GAP/2 − capOvershoot(R, W)
 *     胶囊墨迹边界（距正下方） = CAP_INK/2 − capGapHalf
 *     令两者之差 = SECTOR_GAP（与扇区之间同一个缝）
 *
 *   ⚠ 端帽那一项仍然不能漏：圆头在笔心之外还要凸 `asin(W/R)`，每端一份。
 *     漏掉它圆头会侵进缺口压住胶囊 —— 那是更早修掉的原始 bug，别退回去。
 */
const CAP_GAP_HALF = (CAP_SEAM / R) / 2;
const GAP_ANGLE = 2 * (
    CAP_INK / 2 - CAP_GAP_HALF          // 胶囊墨迹占的半角
    + SECTOR_GAP                        // 要留的缝，与扇区之间一致
    + capOvershoot(R, W, CAP_BULGE)     // 环端帽多占的
    - SECTOR_GAP / 2                    // 扇区首尾自己让出的那半个缝
);
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
    economy?: () => {
        remaining: number;
        canUndo: boolean;
        /** 本轮还剩几个反应；省略表示不画反应记号 */
        reactionsLeft?: number;
    } | null;

    /** 点了撤回时调用，由外部注入（真正的记账退还在外面做）。 */
    onUndo?: () => void;

    /**
     * 取职业状态行的回调，由外部注入。返回空数组 = 这一格不出现。
     * ⚠ 与 economy 不同，它**不受"在不在战斗中"限制** ——
     *   专注点余量在战斗外一样有意义。
     */
    classState?: () => string[];

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
        svg.setAttribute("viewBox", `0 0 ${VIEW} ${VIEW}`);
        svg.setAttribute("class", "pauih-svg");

        /*
         * ★ **几何位置与数据下标是两回事**，这里必须分开：
         *   - `pos`   = 这一格在**当前页**里排第几，几何（角度、端帽）用它；
         *   - `index` = 它在 `level.sectors` **全量**里的下标，`data-index` 存它。
         *
         *   混用会静默错位：第 2 页第 1 格的 pos 是 0，若把 0 写进 data-index，
         *   点它执行的就是第 1 页的第 1 个。分派逻辑读的是 data-index，
         *   所以这么分开之后 `#onClick`／`#onHover` 一行都不用改。
         */
        const visible = this.#visibleSectors();
        const total = visible.length;
        const ring = { cx: CX, cy: CY, R, W, total, gap: SECTOR_GAP, arcSpan: ARC_SPAN };

        visible.forEach(({ sector, index }, pos) => {
            /*
             * 一个扇区 = 一段描边弧。整组包在 <g> 里，是为了让**首尾扇区的圆头端帽**
             * 跟着本扇区一起 hover／变色 —— 端帽是独立元素，靠 group hover 联动。
             */
            const group = document.createElementNS(SVG_NS, "g");
            /* ★ 状态也挂在组上：risky 的发光要**包住整条扇区连同端帽的外轮廓**。
               挂在各自元素上的话，两者的接缝处会各自描一圈，内部冒出发光边。 */
            const group_cls = `pauih-sector-g state-${sector.state}`;
            group.setAttribute("class", group_cls);

            const draw = sectorArc(ring, pos);
            const spin = document.createElementNS(SVG_NS, "g");
            spin.setAttribute("transform", `rotate(${draw.rotate} ${CX} ${CY})`);

            const arc = document.createElementNS(SVG_NS, "circle");
            arc.setAttribute("cx", String(CX));
            arc.setAttribute("cy", String(CY));
            arc.setAttribute("r", String(R));
            arc.setAttribute("stroke-width", String(draw.strokeWidth));
            arc.setAttribute("stroke-dasharray", draw.dash);
            // 三态各有自己的 class：risky 不变暗，只加琥珀标记（设计定档 §6.4）
            arc.setAttribute("class", `pauih-sector state-${sector.state}`);
            arc.dataset.index = String(index);
            spin.appendChild(arc);
            group.appendChild(spin);

            /*
             * 环的最外两端补圆头。扇区一律 butt（相邻圆头会各凸出 asin(W/R)，
             * 把缝隙吃掉粘成一片），只有首尾这两处该是圆的。
             *
             * ⚠ 补的是**半圆**不是整圆：底色半透明（--background 自带 0.9 alpha），
             *   整圆有一半压在弧上，两层叠加会更深，端帽上浮出一道弧形接缝。
             */
            // 端帽只补在**这一页**的首尾两格上（用 pos，不是全量下标）
            if (pos === 0 || pos === total - 1) {
                const cap = document.createElementNS(SVG_NS, "path");
                cap.setAttribute("d", ringCapPath(ring, pos === 0 ? "start" : "end", CAP_BULGE));
                cap.setAttribute("class", `pauih-sector-cap state-${sector.state}`);
                cap.dataset.index = String(index);
                group.appendChild(cap);
            }

            svg.appendChild(group);

            const c = sectorCentroid(ring, pos);

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
                // ★ 状态直接挂在 label 上，不靠 CSS 兄弟选择器。
                //   扇区包进 <g> 之后 `.pauih-sector ~ .pauih-label` 的兄弟关系就断了，
                //   那种写法会**静默失效**（灰显不再变色，且没有任何报错）。
                text.setAttribute("class", `pauih-label state-${sector.state}`);
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
        hub.setAttribute("r", String(R_HUB));
        hub.setAttribute("class", "pauih-hub");
        svg.appendChild(hub);

        /*
         * ⚠ 毂与环之间那圈**什么都不画**。
         *
         *   Nous 2026-08-05：「这个白圈应该只是一个切割，而不是真的白圈。」
         *   mockup 是浅背景，那圈本来就是背景本身透出来 —— 它是**空的**，
         *   不是一个浅色的环。所以这里留空，让底下的毛玻璃／场景透上来，
         *   GUTTER 只负责把毂和环隔开。
         *   （上一版画成了 opacity .7 的亮环，方向反了。）
         */

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
        // ⚠ 判据要跟着 #arrowMode 走，不能只看 variant ——
        //   否则动作层（有分页、无 MAP）的箭头会是灰的、点不动。
        const canCycle = this.#arrowMode() !== "none";
        /*
         * ⚠ 顺序是**反的**：角度从正上方顺时针增大，所以在底部一带，
         *   下标越大越靠左。要让 ‹ 出现在左边，它就得排在数组最后。
         */
        const cells = [
            { action: "next", glyph: "›", enabled: canCycle },
            { action: "back", glyph: "↩", enabled: this.level.canGoBack },
            { action: "prev", glyph: "‹", enabled: canCycle },
        ];

        /*
         * 胶囊 = 一段分成三格的弧，和外环同一条中线（所以贴合是几何保证的，不是调出来的）。
         * 笔心跨度要从墨迹跨度里扣掉它自己两端的圆头 —— 和外环那条约束同源。
         */
        const bar = {
            cx: CX,
            cy: CY,
            R,
            W: W_CAP,
            total: cells.length,
            gap: CAP_SEAM / R,                       // 缝按弧长给，换算成角
            arcSpan: CAP_INK - 2 * capOvershoot(R, W_CAP),
            center: Math.PI / 2,                     // 整段弧的中心指向正下方
        };

        cells.forEach((cell, index) => {
            const group = document.createElementNS(SVG_NS, "g");
            group.setAttribute("class", `pauih-cap-g${cell.enabled ? "" : " disabled"}`);

            const draw = sectorArc(bar, index);
            const spin = document.createElementNS(SVG_NS, "g");
            spin.setAttribute("transform", `rotate(${draw.rotate} ${CX} ${CY})`);

            const arc = document.createElementNS(SVG_NS, "circle");
            arc.setAttribute("cx", String(CX));
            arc.setAttribute("cy", String(CY));
            arc.setAttribute("r", String(R));
            arc.setAttribute("stroke-width", String(draw.strokeWidth));
            arc.setAttribute("stroke-dasharray", draw.dash);
            arc.setAttribute("class", "pauih-cap");
            if (cell.enabled) arc.dataset.nav = cell.action;
            spin.appendChild(arc);
            group.appendChild(spin);

            // 两端补半圆帽（同外环：整圆会和弧身叠出更深的一块）
            if (index === 0 || index === cells.length - 1) {
                const end = document.createElementNS(SVG_NS, "path");
                end.setAttribute("d", ringCapPath(bar, index === 0 ? "start" : "end"));
                end.setAttribute("class", "pauih-cap-end");
                if (cell.enabled) end.dataset.nav = cell.action;
                group.appendChild(end);
            }
            svg.appendChild(group);

            const c = sectorCentroid(bar, index);
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(c.x));
            t.setAttribute("y", String(c.y));
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

        const center = HUB_TITLE_CENTER;

        if (!sector) {
            line(this.level.title, center, "pauih-hub-title");
        } else {
            /*
             * 有悬停：项目名 + 补充信息 + 断好行的原因。
             *
             * ★ `detail`（技能修正值这类参考数）显示在这里，**不印在扇区上** ——
             *   扇区底下挂一行小字既挤又难认（Nous 2026-08-05 截图指出）。
             *   毂本来就是信息呈现区，悬停看它就够了。
             */
            const detailLines = sector.detail ? [sector.detail] : [];
            const reasonLines = sector.reason ? wrapText(sector.reason, HUB_CHARS_PER_LINE) : [];
            const lineHeight = 7;
            const extra = detailLines.length + reasonLines.length;
            const blockHeight = extra ? extra * lineHeight + 5 : 0;
            let y = center - blockHeight / 2;

            line(sector.label, y, "pauih-hub-title");
            y += 9;
            for (const d of detailLines) {
                line(d, y, "pauih-hub-detail");
                y += lineHeight;
            }
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
        //
        // 分页层则在同一位置显示页码 —— 两者不会同时出现：
        // 箭头归谁管由 #arrowMode 决定，这里跟着它走，**读数和箭头永远说的是同一件事**。
        // （分开判断的话会出现"箭头在翻页、读数却显示 MAP"这种自相矛盾的状态。）
        const mode = this.#arrowMode();
        if (mode === "page") {
            const total = this.#pageCount();
            line(`${normalizePage(this.level.paging!.page, total) + 1} / ${total}`,
                 HUB_VARIANT_Y, "pauih-variant");
        } else if (this.level.variant?.labels.length) {
            const v = this.level.variant;
            line(v.labels[v.index] ?? "", HUB_VARIANT_Y, "pauih-variant");
        }

        /*
         * 职业状态区（设计定档 §7）——**只在有内容时出现**。
         *
         * ★ 这是"甲类空白"的落点：panache 有没有、专注还剩几点这类东西
         *   在 pf2e 里不是 item，列表型 HUD 结构上做不了，而毂天生是块屏。
         * ⚠ 没内容时一行都不画，且**不占位**：下面的动作经济行位置固定，
         *   所以状态行往上排，有几行画几行。
         */
        // ⚠ **强制拼成一行**：毂里放不下两行状态（放下也会压到 MAP 读数或经济行）。
        //   多条状态用 " · " 接起来，宁可挤一点也不让它们互相盖住。
        const state = this.classState?.() ?? [];
        if (state.length) line(state.join(" · "), HUB_STATE_Y, "pauih-class-state");

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

        const y = HUB_ECONOMY_Y;
        const pipDx = 8;
        const pips = glyphs(econ.remaining);
        /*
         * ★ 反应记号用**另一个字形** ⟳/⟲，不是第四个 ◆（Nous 2026-08-05 定）。
         *   反应不占常规动作，画成第四个菱形会让人以为这回合有四个动作 ——
         *   那正是"把规则简化错了"的样子。
         *   `reactionsLeft` 为 undefined 表示这个来源还没接反应池，那就整个不画。
         */
        const hasReaction = econ.reactionsLeft !== undefined;
        // 整行（动作记号 + ⟳ + 撤回）居中：先算总宽，再定起点
        const cells = pips.length + (hasReaction ? 1 : 0);
        const startX = CX - ((cells - 1) * pipDx) / 2 - 7;

        [...pips].forEach((ch, i) => {
            const t = document.createElementNS(SVG_NS, "text");
            t.setAttribute("x", String(startX + i * pipDx));
            t.setAttribute("y", String(y));
            t.setAttribute("class", `pauih-pip${ch === "◆" ? " full" : ch === "✕" ? " over" : ""}`);
            t.textContent = ch;
            g.appendChild(t);
        });

        if (hasReaction) {
            const left = econ.reactionsLeft!;
            const t = document.createElementNS(SVG_NS, "text");
            // 与动作记号之间留半格，读作"另一个池"而不是同一串的第四个
            t.setAttribute("x", String(startX + pips.length * pipDx + pipDx / 2));
            t.setAttribute("y", String(y));
            t.setAttribute("class", `pauih-reaction${left > 0 ? " full" : ""}`);
            t.textContent = reactionGlyph(left);
            g.appendChild(t);
        }

        const undo = document.createElementNS(SVG_NS, "text");
        undo.setAttribute("x", String(startX + cells * pipDx + (hasReaction ? pipDx / 2 : 0) + 3));
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

    /**
     * 当前页要画的扇区，**带上它们在全量里的下标**。
     * 没有分页状态时就是全部（下标即位置）。
     */
    #visibleSectors(): { sector: SectorData; index: number }[] {
        const all = this.level.sectors.map((sector, index) => ({ sector, index }));
        return this.level.paging ? pageOf(all, this.level.paging.page) : all;
    }

    /** 这一层总共几页；没有分页状态时恒为 1。 */
    #pageCount(): number {
        return this.level.paging ? pageCount(this.level.sectors.length) : 1;
    }

    /**
     * 胶囊的 `‹ ›` 现在管什么。**分页优先于 MAP 翻选** ——
     * 两者抢同一对箭头，一层不该同时开（见 types.ts 的 paging 注释）。
     */
    #arrowMode(): "page" | "variant" | "none" {
        if (this.level.paging && this.#pageCount() > 1) return "page";
        if ((this.level.variant?.labels.length ?? 0) > 1) return "variant";
        return "none";
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
            if (nav === "prev" || nav === "next") {
                const delta = nav === "next" ? 1 : -1;
                const mode = this.#arrowMode();
                if (mode === "page" && this.level.paging) {
                    // 直接加减一，越界由 pageOf 回环 —— 边界判断收在 paging.ts 里
                    this.level.paging.page += delta;
                    void this.render(false);
                } else if (mode === "variant" && this.level.variant) {
                    const v = this.level.variant;
                    // 后退写成 +(n-1) 而不是 -1：JS 的 % 对负数返回负值，直接减会得到 -1。
                    v.index = (v.index + (delta === 1 ? 1 : v.labels.length - 1)) % v.labels.length;
                    void this.render(false);
                }
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
