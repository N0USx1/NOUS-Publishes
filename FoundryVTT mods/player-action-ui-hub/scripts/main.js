var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/geometry.ts
function polar(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}
__name(polar, "polar");
function sectorAngles(spec) {
  const { index, total, gap = 0 } = spec;
  const step = Math.PI * 2 / total;
  const start = -Math.PI / 2 - step / 2 + index * step;
  return { a0: start + gap / 2, a1: start + step - gap / 2 };
}
__name(sectorAngles, "sectorAngles");
function sectorPath(spec) {
  const { rOuter, rInner, cx, cy } = spec;
  const { a0, a1 } = sectorAngles(spec);
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, rOuter, a0);
  const o1 = polar(cx, cy, rOuter, a1);
  const i1 = polar(cx, cy, rInner, a1);
  const i0 = polar(cx, cy, rInner, a0);
  const f = /* @__PURE__ */ __name((n) => n.toFixed(2), "f");
  return [
    `M ${f(o0.x)} ${f(o0.y)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${f(o1.x)} ${f(o1.y)}`,
    `L ${f(i1.x)} ${f(i1.y)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${f(i0.x)} ${f(i0.y)}`,
    "Z"
  ].join(" ");
}
__name(sectorPath, "sectorPath");
function sectorCentroid(spec) {
  const { rOuter, rInner, cx, cy } = spec;
  const { a0, a1 } = sectorAngles(spec);
  return polar(cx, cy, (rOuter + rInner) / 2, (a0 + a1) / 2);
}
__name(sectorCentroid, "sectorCentroid");

// src/wheel-app.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var R_OUTER = 90;
var R_INNER = 55;
var CX = 100;
var CY = 100;
var SIZE = 320;
var AppV2 = foundry.applications.api.ApplicationV2;
var HUB_CHARS_PER_LINE = 15;
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}
__name(clamp, "clamp");
function charWidth(ch) {
  return /[　-〿一-鿿＀-￯]/.test(ch) ? 1 : 0.5;
}
__name(charWidth, "charWidth");
function wrapText(text, maxUnits) {
  const lines = [];
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
__name(wrapText, "wrapText");
var WheelApp = class extends AppV2 {
  static {
    __name(this, "WheelApp");
  }
  static DEFAULT_OPTIONS = {
    id: "player-action-ui-hub-wheel",
    classes: ["pauih-wheel"],
    window: { frame: false, positioned: true },
    position: { width: SIZE, height: SIZE }
  };
  /** 当前层 */
  level;
  /** 点击扇区的回调，由外部注入 */
  onPick;
  /** 点击盘外关闭用的监听器，记着以便解绑 */
  outsideHandler;
  /** Esc 关闭用的监听器（Foundry 不管无框窗，见 openAt 注释），记着以便解绑 */
  escHandler;
  constructor(level, onPick, options = {}) {
    super(options);
    this.level = level;
    this.onPick = onPick;
  }
  /** 换一层内容并重绘（钻取与双向绑定都走这里） */
  async setLevel(level) {
    this.level = level;
    await this.render(false);
  }
  // ⚠ 计划原文写的返回类型是 Promise<HTMLElement>，tsc 报 TS2740：
  //   SVGSVGElement 不是 HTMLElement。这里按实际产物改成 SVGElement。
  //   AppV2 对 _renderHTML 的返回值不限类型，它只是原样传给 _replaceHTML。
  async _renderHTML() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${SIZE / 1.6} ${SIZE / 1.6}`);
    svg.setAttribute("class", "pauih-svg");
    const total = this.level.sectors.length;
    this.level.sectors.forEach((sector, index) => {
      const spec = { index, total, rOuter: R_OUTER, rInner: R_INNER, cx: CX, cy: CY, gap: 0.02 };
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", sectorPath(spec));
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
    const hub = document.createElementNS(SVG_NS, "circle");
    hub.setAttribute("cx", String(CX));
    hub.setAttribute("cy", String(CY));
    hub.setAttribute("r", String(R_INNER));
    hub.setAttribute("class", "pauih-hub");
    svg.appendChild(hub);
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
  #paintHub(g, sector) {
    g.replaceChildren();
    const line = /* @__PURE__ */ __name((text, y2, cls) => {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(CX));
      t.setAttribute("y", String(y2));
      t.setAttribute("class", cls);
      t.textContent = text;
      g.appendChild(t);
    }, "line");
    if (!sector) {
      line(this.level.title, CY, "pauih-hub-title");
      return;
    }
    const reasonLines = sector.reason ? wrapText(sector.reason, HUB_CHARS_PER_LINE) : [];
    const lineHeight = 7;
    const blockHeight = reasonLines.length ? reasonLines.length * lineHeight + 5 : 0;
    let y = CY - blockHeight / 2;
    line(sector.label, y, "pauih-hub-title");
    y += 9;
    for (const l of reasonLines) {
      line(l, y, `pauih-hub-reason state-${sector.state}`);
      y += lineHeight;
    }
  }
  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.addEventListener("click", this.#onClick);
    content.addEventListener("mouseover", this.#onHover);
  }
  #onClick = /* @__PURE__ */ __name((ev) => {
    const el = ev.target;
    const idx = el?.dataset?.index;
    if (idx === void 0) return;
    const sector = this.level.sectors[Number(idx)];
    if (sector) this.onPick(sector);
  }, "#onClick");
  #onHover = /* @__PURE__ */ __name((ev) => {
    const el = ev.target;
    const idx = el?.dataset?.index;
    const g = this.element?.querySelector(".pauih-hub-text");
    if (!g) return;
    const sector = idx === void 0 ? null : this.level.sectors[Number(idx)] ?? null;
    this.#paintHub(g, sector);
  }, "#onHover");
  /**
   * 在指定屏幕坐标处弹出（**以该点为圆心**），并接管 Esc 与点击盘外关闭。
   * 靠近屏幕边缘时会把盘面拉回可视区内，否则贴边呼出会有半个盘在屏幕外、扇区点不到。
   */
  async openAt(x, y) {
    await this.render(true);
    const margin = 4;
    const left = clamp(x - SIZE / 2, margin, window.innerWidth - SIZE - margin);
    const top = clamp(y - SIZE / 2, margin, window.innerHeight - SIZE - margin);
    this.setPosition({ left, top });
    this.outsideHandler = (ev) => {
      if (!this.element?.contains(ev.target)) void this.close();
    };
    this.escHandler = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      void this.close();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", this.outsideHandler);
      document.addEventListener("keydown", this.escHandler, { capture: true });
    }, 0);
  }
  async close(options = {}) {
    if (this.outsideHandler) {
      document.removeEventListener("mousedown", this.outsideHandler);
      this.outsideHandler = void 0;
    }
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler, { capture: true });
      this.escHandler = void 0;
    }
    return super.close(options);
  }
};

// src/target.ts
function resolveActor() {
  const controlled = canvas?.tokens?.controlled?.[0]?.actor;
  if (controlled) return controlled;
  const bound = game?.user?.character;
  if (bound) return bound;
  return null;
}
__name(resolveActor, "resolveActor");

// src/main.ts
var MODULE_ID = "player-action-ui-hub";
var lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
document.addEventListener("mousemove", (ev) => {
  lastMouse = { x: ev.clientX, y: ev.clientY };
});
var openWheel = null;
function openAt(x, y) {
  const actor = resolveActor();
  if (!actor) {
    ui.notifications.warn("\u6CA1\u6709\u53EF\u64CD\u4F5C\u7684\u89D2\u8272\uFF1A\u8BF7\u5148\u9009\u4E2D\u4F60\u7684 token");
    return;
  }
  openWheel?.close();
  const level = {
    title: actor.name,
    canGoBack: false,
    sectors: [
      { id: "strikes", label: "\u6253\u51FB", cost: null, state: "normal" },
      { id: "actions", label: "\u52A8\u4F5C", cost: null, state: "normal" },
      { id: "class", label: "\u804C\u4E1A", cost: null, state: "normal" },
      { id: "spells", label: "\u6CD5\u672F", cost: null, state: "normal" }
    ]
  };
  openWheel = new WheelApp(level, (s) => {
    console.log("\u5206\u7C7B:", s.id);
  });
  void openWheel.openAt(x, y);
}
__name(openAt, "openAt");
Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  game.keybindings.register(MODULE_ID, "openWheel", {
    name: "\u547C\u51FA\u52A8\u4F5C\u8F6E\u76D8",
    hint: "\u5728\u9F20\u6807\u4F4D\u7F6E\u5F39\u51FA\u8F6E\u76D8\u3002\u4E0E Ctrl+\u5DE6\u952E\u7B49\u6548\uFF0C\u4F9B\u4E0D\u4FBF\u4F7F\u7528 Ctrl+\u70B9\u51FB\u7684\u73A9\u5BB6\u6539\u7ED1\u3002",
    editable: [{ key: "KeyR" }],
    onDown: /* @__PURE__ */ __name(() => {
      openAt(lastMouse.x, lastMouse.y);
      return true;
    }, "onDown"),
    precedence: 0
  });
});
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  console.log(
    `%c${MODULE_ID} | ready | v${mod?.version ?? "?"}`,
    "color:#c9a959;font-weight:bold"
  );
  const demoLevel = {
    title: "\u6253  \u51FB",
    canGoBack: false,
    sectors: [
      { id: "a", label: "\u957F\u5251", cost: "1", state: "normal" },
      { id: "b", label: "\u77ED\u5F13", cost: "1", state: "normal" },
      // 走险：亮度不变，只有琥珀描边与角标
      {
        id: "c",
        label: "\u6CD5\u672F\u98DE\u5F39",
        cost: "2",
        state: "risky",
        reason: "\u8FDF\u949D 2\uFF1A\u65BD\u6CD5\u9700\u901A\u8FC7 DC 7 \u5E73\u9AB0\uFF0C\u5426\u5219\u6CD5\u672F\u4E2D\u65AD",
        badge: "\u26A0 \u5E73\u9AB0 DC7"
      },
      // 不满足：变暗
      {
        id: "d",
        label: "\u5315\u9996",
        cost: "1",
        state: "gated",
        reason: "\u672A\u62D4\u51FA\uFF0C\u5148\u82B1 \u25C6 \u62D4\u51FA\u6B66\u5668",
        badge: "\u25C6 \u62D4\u51FA"
      }
    ]
  };
  globalThis.pauih = {
    /** 调试入口：不传坐标就用鼠标当前所在位置 */
    demo: /* @__PURE__ */ __name((x, y) => {
      const w = new WheelApp(demoLevel, (s) => console.log("picked:", s.label));
      void w.openAt(x ?? lastMouse.x, y ?? lastMouse.y);
      return w;
    }, "demo")
  };
  function isWheelSummon(ev) {
    return ev.button === 0 && ev.ctrlKey && ev.target?.tagName === "CANVAS";
  }
  __name(isWheelSummon, "isWheelSummon");
  for (const type of ["pointerdown", "mousedown", "pointerup", "click"]) {
    document.addEventListener(type, (ev) => {
      const me = ev;
      if (!isWheelSummon(me)) return;
      me.preventDefault();
      me.stopImmediatePropagation();
      if (type === "pointerdown") openAt(me.clientX, me.clientY);
    }, { capture: true });
  }
});
//# sourceMappingURL=main.js.map
