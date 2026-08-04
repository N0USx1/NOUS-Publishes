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

// src/text.ts
function charWidth(ch) {
  return /[　-〿一-鿿＀-￯]/.test(ch) ? 1 : 0.5;
}
__name(charWidth, "charWidth");
function textWidth(s) {
  return [...s].reduce((n, c) => n + charWidth(c), 0);
}
__name(textWidth, "textWidth");
function wrapText(text, maxUnits) {
  const tokens = text.match(/[　-〿一-鿿＀-￯]|\s+|[^\s　-〿一-鿿＀-￯]+/g) ?? [];
  const lines = [];
  let cur = "";
  let w = 0;
  for (const tk of tokens) {
    const tw = textWidth(tk);
    if (/^\s+$/.test(tk)) {
      if (cur) {
        cur += tk;
        w += tw;
      }
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
__name(wrapText, "wrapText");

// src/wheel-app.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var R_OUTER = 90;
var R_INNER = 42;
var CX = 100;
var CY = 100;
var SIZE = 320;
var AppV2 = foundry.applications.api.ApplicationV2;
var HUB_CHARS_PER_LINE = 12;
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}
__name(clamp, "clamp");
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
  /**
   * 点击扇区的回调，由外部注入。
   * ⚠ 第二个参数是**真实的 MouseEvent**，不是合成的：掷骰时要原样传给
   *   pf2e 的 `variant.roll({ event })`，生态里的模组（PF2e Toolbelt 自动掩护等）
   *   靠它拿检定上下文（设计定档 §6.3）。
   */
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
    if (sector) this.onPick(sector, ev);
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

// src/collector.ts
function strikeSectorId(strike, index) {
  return `strike:${strike?.item?.id ?? strike?.slug ?? index}`;
}
__name(strikeSectorId, "strikeSectorId");
function collectStrikes(actor) {
  try {
    const actions = actor?.system?.actions;
    if (!Array.isArray(actions)) return [];
    return actions.filter((a) => a?.type === "strike").map((strike, i) => {
      const ready = strike.ready !== false;
      const drawAux = (strike.auxiliaryActions ?? [])[0];
      return {
        id: strikeSectorId(strike, i),
        label: String(strike.label ?? strike.slug ?? "?"),
        cost: "1",
        // 未拔出 = gated（规则上此刻确实打不了），不是 risky
        state: ready ? "normal" : "gated",
        reason: ready ? void 0 : "Not drawn \u2014 spend \u25C6 to draw it first.",
        badge: !ready && drawAux ? "\u25C6 Draw" : void 0
      };
    });
  } catch (err) {
    console.error("player-action-ui-hub | collectStrikes \u5931\u8D25", err);
    return [];
  }
}
__name(collectStrikes, "collectStrikes");

// src/executor.ts
function findStrike(actor, strikeId) {
  const actions = actor?.system?.actions;
  if (!Array.isArray(actions)) return null;
  const strikes = actions.filter((a) => a?.type === "strike");
  return strikes.find((s, i) => strikeSectorId(s, i) === strikeId) ?? null;
}
__name(findStrike, "findStrike");
function intentEvent(realEvent) {
  const skipDefault = !game.user?.settings?.showCheckDialogs;
  const userWantsDialog = !!realEvent?.shiftKey;
  const shiftKey = userWantsDialog ? skipDefault : !skipDefault;
  return new MouseEvent("click", { shiftKey, ctrlKey: false, metaKey: false });
}
__name(intentEvent, "intentEvent");
async function rollStrike(actor, strikeId, map, event) {
  try {
    const strike = findStrike(actor, strikeId);
    if (!strike) {
      ui.notifications.warn("That strike is no longer available \u2014 reopen the wheel.");
      return;
    }
    const variant = strike.variants?.[map];
    if (!variant) {
      ui.notifications.warn("That strike has no such attack in the sequence.");
      return;
    }
    await variant.roll({ event: intentEvent(event) });
  } catch (err) {
    console.error("player-action-ui-hub | rollStrike \u5931\u8D25", err);
    ui.notifications.error("The roll failed \u2014 see the console for details.");
  }
}
__name(rollStrike, "rollStrike");
async function execAuxiliary(actor, strikeId, auxIndex) {
  try {
    const strike = findStrike(actor, strikeId);
    const aux = strike?.auxiliaryActions?.[auxIndex];
    if (!aux) {
      ui.notifications.warn("This weapon has no such action.");
      return;
    }
    await aux.execute();
  } catch (err) {
    console.error("player-action-ui-hub | execAuxiliary \u5931\u8D25", err);
    ui.notifications.error("The action failed \u2014 see the console for details.");
  }
}
__name(execAuxiliary, "execAuxiliary");

// src/main.ts
var MODULE_ID = "player-action-ui-hub";
var BACK_SECTOR = { id: "__back", label: "\u21A9 Back", cost: null, state: "normal" };
var lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
document.addEventListener("mousemove", (ev) => {
  lastMouse = { x: ev.clientX, y: ev.clientY };
});
var openWheel = null;
function openAt(x, y) {
  const actor = resolveActor();
  if (!actor) {
    ui.notifications.warn("Player Action UI Hub: no character to act with \u2014 select your token first.");
    return;
  }
  openWheel?.close();
  const level = {
    title: actor.name,
    canGoBack: false,
    sectors: [
      { id: "strikes", label: "Strikes", cost: null, state: "normal" },
      { id: "actions", label: "Actions", cost: null, state: "normal" },
      { id: "class", label: "Class", cost: null, state: "normal" },
      { id: "spells", label: "Spells", cost: null, state: "normal" }
    ]
  };
  openWheel = new WheelApp(level, (s, ev) => {
    if (s.id === "strikes") {
      const strikes = collectStrikes(actor);
      if (!strikes.length) {
        ui.notifications.info("This character has no strikes available.");
        return;
      }
      void openWheel.setLevel({
        title: "Strikes",
        canGoBack: true,
        sectors: [...strikes, BACK_SECTOR]
      });
      return;
    }
    if (s.id === "__back") {
      void openWheel.setLevel(level);
      return;
    }
    if (s.id.startsWith("strike:")) {
      if (s.state === "gated") {
        void execAuxiliary(actor, s.id, 0).then(() => openWheel?.close());
      } else {
        void rollStrike(actor, s.id, 0, ev).then(() => openWheel?.close());
      }
      return;
    }
    ui.notifications.info(`"${s.label}" is not implemented yet.`);
  });
  void openWheel.openAt(x, y);
}
__name(openAt, "openAt");
Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  game.keybindings.register(MODULE_ID, "openWheel", {
    name: "Summon Action Wheel",
    hint: "Opens the wheel at the cursor. Equivalent to Ctrl+left-click; rebind this if Ctrl+click is awkward on your setup.",
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
    title: "Strikes",
    canGoBack: false,
    sectors: [
      { id: "a", label: "Longsword", cost: "1", state: "normal" },
      { id: "b", label: "Shortbow", cost: "1", state: "normal" },
      // risky：亮度不变，只有琥珀描边与角标
      {
        id: "c",
        label: "Magic Missile",
        cost: "2",
        state: "risky",
        reason: "Stupefied 2: casting requires a DC 7 flat check or the spell is disrupted.",
        badge: "\u26A0 Flat DC 7"
      },
      // gated：变暗
      {
        id: "d",
        label: "Dagger",
        cost: "1",
        state: "gated",
        reason: "Not drawn \u2014 spend \u25C6 to draw it first.",
        badge: "\u25C6 Draw"
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
