import { WheelApp } from "./wheel-app";
import type { WheelLevel } from "./types";

const MODULE_ID = "player-action-ui-hub";

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | init`);
});

Hooks.once("ready", () => {
    const mod = game.modules.get(MODULE_ID);
    console.log(`%c${MODULE_ID} | ready | v${mod?.version ?? "?"}`,
                "color:#c9a959;font-weight:bold");

    // 临时调试入口：控制台执行 pauih.demo() 弹出示例轮盘
    const demoLevel: WheelLevel = {
        title: "打  击",
        canGoBack: false,
        sectors: [
            { id: "a", label: "长剑", cost: "1", state: "normal" },
            { id: "b", label: "短弓", cost: "1", state: "normal" },
            // 走险：亮度不变，只有琥珀描边与角标
            { id: "c", label: "法术飞弹", cost: "2", state: "risky",
              reason: "迟钝 2：施法需通过 DC 7 平骰，否则法术中断", badge: "⚠ 平骰 DC7" },
            // 不满足：变暗
            { id: "d", label: "匕首", cost: "1", state: "gated",
              reason: "未拔出，先花 ◆ 拔出武器", badge: "◆ 拔出" },
        ],
    };
    (globalThis as any).pauih = {
        demo: () => {
            const w = new WheelApp(demoLevel, (s) => console.log("picked:", s.label));
            void w.openAt(window.innerWidth / 2, window.innerHeight / 2);
            return w;
        },
    };
});
