import { WheelApp } from "./wheel-app";
import { resolveActor } from "./target";
import { collectStrikes } from "./collector";
import { rollStrike, execAuxiliary } from "./executor";
import type { SectorData, WheelLevel } from "./types";

const MODULE_ID = "player-action-ui-hub";

/** 返回上一层的扇区。id 以双下划线打头，不会与真实条目的 id 撞。 */
const BACK_SECTOR: SectorData = { id: "__back", label: "↩ Back", cost: null, state: "normal" };

// 记录鼠标位置：轮盘以鼠标为圆心弹出，而按键呼出时事件里没有坐标。
// ⚠ 放在模块顶层（不是 ready 内），因为 init 里注册的按键回调也要读它。
let lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
document.addEventListener("mousemove", (ev) => {
    lastMouse = { x: ev.clientX, y: ev.clientY };
});

/** 当前打开的轮盘；同一时刻只允许一个 */
let openWheel: WheelApp | null = null;

/** 在屏幕坐标 (x, y) 处呼出分类层轮盘。 */
function openAt(x: number, y: number): void {
    const actor = resolveActor();
    if (!actor) {
        ui.notifications.warn("Player Action UI Hub: no character to act with — select your token first.");
        return;
    }
    openWheel?.close();
    const level: WheelLevel = {
        title: actor.name,
        canGoBack: false,
        sectors: [
            { id: "strikes", label: "Strikes", cost: null, state: "normal" },
            { id: "actions", label: "Actions", cost: null, state: "normal" },
            { id: "class",   label: "Class",   cost: null, state: "normal" },
            { id: "spells",  label: "Spells",  cost: null, state: "normal" },
        ],
    };
    openWheel = new WheelApp(level, (s, ev) => {
        // —— 分类层 → 打击层 ——
        if (s.id === "strikes") {
            const strikes = collectStrikes(actor);
            if (!strikes.length) {
                ui.notifications.info("This character has no strikes available.");
                return;
            }
            void openWheel!.setLevel({
                title: "Strikes",
                canGoBack: true,
                sectors: [...strikes, BACK_SECTOR],
            });
            return;
        }

        // —— 打击层 → 分类层 ——
        if (s.id === "__back") {
            void openWheel!.setLevel(level);
            return;
        }

        // —— 打击层：执行 ——
        if (s.id.startsWith("strike:")) {
            if (s.state === "gated") {
                // 「提示不是锁」：gated 一样能点。未拔出就先替玩家把武器拔出来，
                // 而不是把这一格禁掉让人无从下手。
                void execAuxiliary(actor, s.id, 0).then(() => openWheel?.close());
            } else {
                // map 先写死 0（第 1 击）；MAP 三段翻选是 Task 7 的事。
                // ★ ev 是真实点击事件，必须一路传到 variant.roll({ event })。
                void rollStrike(actor, s.id, 0, ev).then(() => openWheel?.close());
            }
            return;
        }

        ui.notifications.info(`"${s.label}" is not implemented yet.`);
    });
    void openWheel.openAt(x, y);
}

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | init`);

    // 可改绑按键：浏览器/Mac 玩家的逃生口，与 Ctrl+左键等效。
    game.keybindings.register(MODULE_ID, "openWheel", {
        name: "Summon Action Wheel",
        hint: "Opens the wheel at the cursor. Equivalent to Ctrl+left-click; rebind this if Ctrl+click is awkward on your setup.",
        editable: [{ key: "KeyR" }],
        onDown: () => {
            // ⚠ 不用 `window.event`（遗留 API，不可靠）：坐标取自模块顶层
            //   持续记录的 lastMouse。
            openAt(lastMouse.x, lastMouse.y);
            return true;
        },
        precedence: 0,
    });
});

Hooks.once("ready", () => {
    const mod = game.modules.get(MODULE_ID);
    console.log(`%c${MODULE_ID} | ready | v${mod?.version ?? "?"}`,
                "color:#c9a959;font-weight:bold");

    // 临时调试入口：控制台执行 pauih.demo() 弹出示例轮盘
    const demoLevel: WheelLevel = {
        title: "Strikes",
        canGoBack: false,
        sectors: [
            { id: "a", label: "Longsword", cost: "1", state: "normal" },
            { id: "b", label: "Shortbow", cost: "1", state: "normal" },
            // risky：亮度不变，只有琥珀描边与角标
            { id: "c", label: "Magic Missile", cost: "2", state: "risky",
              reason: "Stupefied 2: casting requires a DC 7 flat check or the spell is disrupted.",
              badge: "⚠ Flat DC 7" },
            // gated：变暗
            { id: "d", label: "Dagger", cost: "1", state: "gated",
              reason: "Not drawn — spend ◆ to draw it first.", badge: "◆ Draw" },
        ],
    };

    (globalThis as any).pauih = {
        /** 调试入口：不传坐标就用鼠标当前所在位置 */
        demo: (x?: number, y?: number) => {
            const w = new WheelApp(demoLevel, (s) => console.log("picked:", s.label));
            void w.openAt(x ?? lastMouse.x, y ?? lastMouse.y);
            return w;
        },
    };

    // —— 画布上 Ctrl+左键呼出，整串事件全吞 ——

    /** 判定：这一下是不是"呼出轮盘"。三个条件缺一不可。 */
    function isWheelSummon(ev: MouseEvent): boolean {
        return ev.button === 0                                        // 左键
            && ev.ctrlKey                                             // 按着 Ctrl
            && (ev.target as HTMLElement)?.tagName === "CANVAS";      // 落在画布上（实测 target 就是 CANVAS）
    }

    // 四个都要吞：实测一次点击放出 pointerdown → mousedown → pointerup → click，
    // 漏掉任何一个，Foundry 都会把它当普通左键处理（选中 token 等）。
    for (const type of ["pointerdown", "mousedown", "pointerup", "click"]) {
        document.addEventListener(type, (ev) => {
            const me = ev as MouseEvent;
            if (!isWheelSummon(me)) return;          // 不是我们的组合 → 原样放行，绝不误伤
            me.preventDefault();
            me.stopImmediatePropagation();           // 连同 document 上其它捕获监听一起挡
            if (type === "pointerdown") openAt(me.clientX, me.clientY);   // 只在第一个事件上开盘
        }, { capture: true });
    }
});
