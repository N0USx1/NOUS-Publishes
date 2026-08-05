import type { ActorPF2e, ItemPF2e } from "foundry-pf2e";
import { WheelApp } from "./wheel-app";
import { resolveActor } from "./target";
import { collectStrikes } from "./collectors/strikes";
import { collectActions } from "./collectors/actions";
import { collectClassAbilities, className } from "./collectors/class-abilities";
import { rollStrike, execAuxiliary, useAction } from "./executor";
import { registerUsageSetting, bump as bumpUsage } from "./usage";
import * as economy from "./economy";
import type { WheelLevel } from "./types";

const MODULE_ID = "player-action-ui-hub";

// 返回不再占一个扇区：它归底部导航胶囊管（Nous 2026-08-05 mockup）。
// 胶囊点击时由 WheelApp 合成 id 为 "__back" 的 sector 回调，下面的分支照旧接得住。

// 记录鼠标位置：轮盘以鼠标为圆心弹出，而按键呼出时事件里没有坐标。
// ⚠ 放在模块顶层（不是 ready 内），因为 init 里注册的按键回调也要读它。
let lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
document.addEventListener("mousemove", (ev) => {
    lastMouse = { x: ev.clientX, y: ev.clientY };
});

/**
 * 当前是第几轮；不在战斗中返回 null。
 * ★ 战斗外没有"回合"这回事，动作经济那一行就不该画（画了是假信息）。
 */
function currentRound(actor: ActorPF2e | null): number | null {
    const combat = game.combat;
    if (!combat?.started) return null;
    const inIt = combat.combatants?.some((c) => c.actor?.id === actor?.id);
    return inIt ? (combat.round ?? null) : null;
}

/** 当前打开的轮盘；同一时刻只允许一个 */
let openWheel: WheelApp | null = null;
/**
 * 当前轮盘是为**哪个** actor 开的。
 * ⚠ 别在钩子里改用 `resolveActor()` 现算：轮盘开着的时候玩家可能已经改选了别的
 *   token，那时现算出来的不是盘面对应的角色，会拿别人的变更去刷新我们的盘。
 */
let openWheelActor: ActorPF2e | null = null;

/**
 * 由 actor 现算一层"打击"盘面；这个角色没有打击时返回 null。
 *
 * ★ 单独抽出来是因为它要被调**两次**：进入这一层时算一次，
 *   之后每次角色数据变化（拔刀/收刀）再算一次。两处必须同一份逻辑，
 *   否则刷新出来的盘面会和刚进来时长得不一样。
 */
function buildStrikeLevel(actor: ActorPF2e): WheelLevel | null {
    const strikes = collectStrikes(actor);
    if (!strikes.length) return null;
    // 翻选条的"默认文字"取本层第一个条目的；悬停到别的武器时
    // 由 WheelApp 换成那把武器自己的（不同武器加值不同，见 types.ts）。
    const labels = strikes[0]?.variantLabels ?? [];
    return {
        title: "Strikes",
        canGoBack: true,
        variant: labels.length ? { index: 0, labels } : undefined,
        sectors: strikes,
    };
}

/** 在屏幕坐标 (x, y) 处呼出分类层轮盘。 */
function openAt(x: number, y: number): void {
    const actor = resolveActor();
    if (!actor) {
        ui.notifications.warn("Player Action UI Hub: no character to act with — select your token first.");
        return;
    }
    openWheel?.close();
    openWheelActor = actor;
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
            const strikeLevel = buildStrikeLevel(actor);
            if (!strikeLevel) {
                ui.notifications.info("This character has no strikes available.");
                return;
            }
            // ★ 双向绑定的接线口：交给轮盘一份"重算这一层"的做法，
            //   之后角色一变（拔刀/收刀）它就照这个重画自己。
            openWheel!.rebuild = () => buildStrikeLevel(actor);
            void openWheel!.setLevel(strikeLevel);
            return;
        }

        // —— 分类层 → 动作层 ——
        if (s.id === "actions") {
            const sectors = collectActions(actor);
            if (!sectors.length) {
                ui.notifications.info("No general actions are available.");
                return;
            }
            // 动作层不随角色数据变（熟练度不会在一回合里改），不接 rebuild
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({
                title: "Actions",
                canGoBack: true,
                paging: { page: 0 },
                sectors,
            });
            return;
        }

        // —— 分类层 → 职业层 ——
        if (s.id === "class") {
            const sectors = collectClassAbilities(actor);
            if (!sectors.length) {
                ui.notifications.info("This character has no class abilities to use.");
                return;
            }
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({
                title: className(actor) ?? "Class",
                canGoBack: true,
                paging: { page: 0 },
                sectors,
            });
            return;
        }

        // —— 打击层 → 分类层 ——
        if (s.id === "__back") {
            // 分类层是四个写死的格子，没有随角色变的东西 → 撤掉重算回调
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel(level);
            return;
        }

        // —— 打击层：执行 ——
        if (s.id.startsWith("strike:")) {
            if (s.state === "gated") {
                // 「提示不是锁」：gated 一样能点。未拔出就先替玩家把武器拔出来，
                // 而不是把这一格禁掉让人无从下手。
                //
                // ★ **准备类动作执行后不关盘**（Nous 2026-08-05）：拔刀不是一件
                //   "做完了"的事，玩家的本意是接着打。盘留着，让双向绑定把这一格
                //   由灰转正常，下一下就能点它攻击。终结类（掷骰）才关。
                void execAuxiliary(actor, s.id, 0);
            } else {
                // 打第几击由毂底的翻选条决定（没有翻选条时是 0 = 第 1 击）。
                // ★ ev 是真实点击事件，必须一路传到 executor（它再翻成意图事件）。
                const map = openWheel!.currentVariantIndex();
                // 记账：花掉这次打击的动作点（★只记不拦，见 economy.ts）
                const round = currentRound(actor);
                if (round !== null) economy.spend(actor.id, round, economy.costToPoints(s.cost));
                void rollStrike(actor, s.id, map, ev).then(() => openWheel?.close());
            }
            return;
        }

        // —— 动作层：执行 ——
        if (s.id.startsWith("action:")) {
            const slug = s.id.slice("action:".length);
            // ★ 记一笔使用 —— 下次这个动作会往前排。排序依据来自玩家真实做过的事，
            //   而不是我们猜的清单（见 usage.ts 顶部）。
            bumpUsage(slug);
            const round = currentRound(actor);
            if (round !== null) economy.spend(actor.id, round, economy.costToPoints(s.cost));
            // 终结类动作：执行完这一步就做完了，关盘
            void useAction(actor, slug, ev).then(() => openWheel?.close());
            return;
        }

        // —— 职业层：执行 ——
        if (s.id.startsWith("class:")) {
            const itemId = s.id.slice("class:".length);
            const item = actor.items.get(itemId);
            if (!item) {
                ui.notifications.warn("That ability is no longer available — reopen the wheel.");
                return;
            }
            const round = currentRound(actor);
            if (round !== null) {
                // ★ 反应走**另一个池**：它不占常规动作（规则事实，见 economy.ts）
                if (s.cost === "reaction") economy.spendReaction(actor.id, round);
                else economy.spend(actor.id, round, economy.costToPoints(s.cost));
            }
            // 对照表 §6：职业能力走 rollItemMacro（selfEffect / TokenMark 自动生效）
            void (game as any).pf2e.rollItemMacro(item.uuid).then(() => openWheel?.close());
            return;
        }

        ui.notifications.info(`"${s.label}" is not implemented yet.`);
    });
    openWheel.economy = () => {
        const round = currentRound(actor);
        if (round === null) return null;
        return {
            remaining: economy.remaining(actor.id, round),
            canUndo: economy.canUndo(actor.id, round),
            reactionsLeft: economy.reactionsLeft(actor.id, round),
        };
    };
    openWheel.onUndo = () => {
        const round = currentRound(actor);
        if (round !== null) economy.undoLast(actor.id, round);
    };
    void openWheel.openAt(x, y);
}

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | init`);

    // 动作使用记录：排序要靠它，必须在任何采集之前注册好
    registerUsageSetting();

    // 可改绑按键：浏览器/Mac 玩家的逃生口，与 Ctrl+左键等效。
    game.keybindings.register(MODULE_ID, "openWheel", {
        name: "Summon Action Wheel",
        hint: "Opens the wheel at the cursor. Equivalent to Ctrl+left-click; rebind this if Ctrl+click is awkward on your setup.",
        // modifiers 显式给空数组：省略它在运行时等价
        // （client/helpers/interaction/client-keybindings.mjs:261
        //   `binding.modifiers = this.#validateModifiers(binding.modifiers ?? [])`），
        // 但类型包把它标成必填，写全比开豁免干净。
        editable: [{ key: "KeyR", modifiers: [] }],
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

    // —— 双向绑定：角色数据变了就重画开着的盘面 ——
    //
    // pf2e 没有"状态已落地"这种自定义钩子，只能用 Foundry 核心的文档钩子。
    // 四个全挂：findings-v0.1 §6 记的是"拔刀触发哪个钩子未测"，与其先猜一个，
    // 不如都听——WheelApp.refresh() 自带合并，重复触发只会重画一次。
    const REFRESH_HOOKS = ["updateActor", "updateItem", "createItem", "deleteItem"];
    for (const h of REFRESH_HOOKS) {
        Hooks.on(h, (doc: ActorPF2e | ItemPF2e) => {
            if (!openWheel?.rendered || !openWheelActor) return;
            // updateActor 给的就是 Actor；物品钩子给的是 Item，从它身上找宿主
            const changed = doc?.documentName === "Actor" ? doc : (doc?.actor ?? doc?.parent);
            if (!changed?.id || changed.id !== openWheelActor.id) return;   // 别人的角色变了不关我们的事
            void openWheel.refresh();
        });
    }
});
