import type { ActorPF2e, ItemPF2e } from "foundry-pf2e";
import { WheelApp } from "./wheel-app";
import { resolveActor } from "./target";
import {
    collectStrikes, collectStrikeAuxiliaries, collectActions, collectSkills, collectSkillActions,
    collectClassAbilities, className, collectSpellEntries, collectSpells, collectReactions,
    collectFreeActions, SHEET_HINT_ID, collectActivations,
} from "./collectors";
import { rollStrike, execAuxiliary, useAction, castSpell, rollSkill, sendReloadMessage,
         applyEffectTo, rollSpellSave, rollSpellDamage, spellHasDamage,
         rollSpellAttack } from "./executor";
import { registerUsageSetting, bump as bumpUsage } from "./usage";
import { classStateLines, readClassState, turnConditions, resourceLines } from "./class-state";
import { CATEGORY_ICONS } from "./icons";
import { auraPlanFor, buildAuraEffect } from "./aura-effects";
import { savePlanFor, sceneHasGrid, resolveAreaAfterCast } from "./area-effects";
import { targetingOf, castSectorId, spellSectorIdOf, CAST_PREFIX,
         actsSectorId, parseActsSectorId, ACTS_PREFIX } from "./spell-target";
import { areaBuffOf, areaPickMode, effectApplyOf } from "./area-buff";
import { maxTargetsOf, planCast, gapBefore, castKindOf, actionRangeOf } from "./spell-cast";
import { macroFor, macroForItem, levelForStep, unarmedStrikes, applyTargetPick, targetOptions,
         TARGET_DONE, TARGET_PREFIX, targetCount,
         type ActionMacro, type MacroContext } from "./macros";
import { triggerOf, requirementOf } from "./triggers";
import { collectBodies, BODY_PREFIX } from "./companions";
import { collectConditions, CONDITION_PREFIX } from "./conditions";
import { classify, matchReactions, type MessageFacts } from "./reaction-watch";
import { readAttack, nextMapIndex } from "./attacks";
import { applySelfEffect, damageTypesOf } from "./self-effect";
import { noteSpell, spellTypesThisTurn, clearSpells } from "./last-spell";
import { refocusSector, refocusedValue, REFOCUS_ID, REFOCUS_UUID } from "./refocus";
import { rechargeSector, spentNote, markSpent, recharge as 充能, RECHARGE_ID,
         spellstrikeItemOf } from "./spellstrike-charge";
import { primeActionUuids } from "./action-uuids";
import { primeSheetActions, clearSheetActions, sheetActionsOf } from "./sheet-actions";
import { primeSpellGroups, clearSpellGroups, spellGroupsOf, slotMatrix } from "./spell-slots";
import { primeStrikeDamage, clearStrikeDamage } from "./strike-damage";
import { PAGE_SIZE } from "./paging";
import { strikeSectorId, ammoSectorId, parseAmmoSectorId } from "./collectors/strikes";
import { restrictionFor, restrictionStateOf } from "./restrictions";
import * as economy from "./economy";
import type { WheelLevel, SectorData } from "./types";

const MODULE_ID = "player-action-ui-hub";
/** G10 反应提示的开关键。 */
const REACTION_PROMPT_SETTING = "reactionPrompts";

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
 * 正在走的编排（乙类动作）。null = 没在编排。
 *
 * ⚠ 每次呼出轮盘都要清掉：上一次编排走到一半被 Esc 关了，状态会留着，
 *   下次呼出的第一下点击就会被当成"编排的下一步"。
 */
let 活跃编排: { macro: ActionMacro; step: number; ctx: MacroContext } | null = null;

/**
 * 当前盘面是不是**我们开的「选目标」层**。
 *
 * ★★ 存在的理由（Nous 2026-08-08 实机）："我被夹在这个无法清除的选择框里面。"
 *   选目标层会替玩家把 token 设成 target（预选或他自己点的）。他如果**没确认就退出**，
 *   那些 target 会留在画布上 —— 而盘一关就没有取消它们的入口了。
 * ⚠ 判据必须是"**这一层是我们开的**"，不能无条件清：
 *   编排器（Spellstrike 等）也有自己的选目标步骤，玩家还可能在盘外自己选好了目标。
 *   见 `清掉预选目标()`。
 */
let 选目标层 = false;

/**
 * 退出选目标层时把预选清掉。
 * ⚠ **确认施放那条路不走这里** —— 那些目标要留给 pf2e 算 DC/命中。
 */
function 清掉预选目标(): void {
    if (!选目标层) return;
    选目标层 = false;
    (game as any).user?.updateTokenTargets?.([]);
}

/** 按扇区 id 里那一段回查打击。⚠ 与采集端共用 `strikeSectorId` 的口径。 */
function 找打击(actor: ActorPF2e, key: string): unknown {
    const all = ((actor as any)?.system?.actions ?? []).filter((x: any) => x?.type === "strike");
    return all.find((x: any, i: number) => strikeSectorId(x, i) === key) ?? null;
}

/** 装填要花几个动作 —— 系统给的 `reloadGlyph`，不是我们定的。 */
function costOfReload(strike: unknown): SectorData["cost"] {
    const n = Number((strike as any)?.ammunition?.reloadGlyph);
    return Number.isFinite(n) && n > 0 ? (String(n) as SectorData["cost"]) : "1";
}

/**
 * 装填 —— **照 pf2e 角色卡自己的做法**
 * （Nous 2026-08-08："对齐游戏里面的 sheet 中如何 reload，读他的数据来做"）。
 *
 * ★★ 实读 pf2e 8.4 的 `WeaponReloader#reloadWeapon`（系统 js 里那段，卡上那个
 *   Reload 按钮开的就是这个 ApplicationV2 弹窗）：
 *
 *       const ammo = weapon.actor.inventory.get(ammoId, { strict: true });
 *       const 空位 = Math.max(0, capacity − 已装数);
 *       if (空位 > 0) { await weapon.attach(ammo, { quantity: 1, stack: true }); … }
 *
 *   ⇒ **真正把子弹装进去的是 `weapon.attach()`**。
 *
 * ⛔⛔ 上一版写的是 `weapon.update({ "system.selectedAmmoId": ammoId })` —— **那是另一件事**：
 *   `selected` 答的是"攻击时从哪一堆扣"，`loaded` 才是"枪里现在有几发"。
 *   于是点下去弹药一发没少、`loaded` 还是空，只飘过一张 Interact 卡。
 *   ★ Nous 的原话「什么也没有做」是**字面准确**的，不是观感问题。
 *   ★ 教训：两个字段名字都沾 ammo，各自都写得成功、都不报错，
 *     **只有拿系统自己的实现对一遍才分得出哪个是真的**。
 *     "我读过角色卡代码"这句话上一版也写了 —— 声明不可回溯，所以这次把源码摘在上面。
 *
 * ⚠ `attach` **不校验兼容性**（实测：把 Clan Pistol 的弹装进 Dwarven Scattergun，它照做）。
 *   ⇒ 候选**只能从 `ammunition.compatible` 出** —— pf2e 那个弹窗列的也正是它。
 *     别在别处放宽：这道闸只有我们这一层。
 * ⚠ `ammunition.remaining` 的语义是**还能装几发**（capacity − 已装），不是"还剩多少弹药"
 *   （实读采集端：`remaining = Math.max(0, capacity − sum(loaded.quantity))`）。
 *   照名字望文生义会把"装满了"读成"没子弹了"。
 *
 * ⚠ 装填在 PF2e 里**动作上就是 Interact**（动作注册表有 interact、没有 reload），
 *   所以消息仍走 `useAction(actor, "interact")`；pf2e 那边只在战斗中发自己的 Reload 卡。
 */
async function 装填(actor: ActorPF2e, strike: unknown, ammoId: string | null,
                    cost: SectorData["cost"], ev: MouseEvent): Promise<void> {
    const weapon = (strike as any)?.item;
    // 还能装几发 —— 照 pf2e 那句 `空位 > 0 &&`
    const 空位 = Number((strike as any)?.ammunition?.remaining ?? 0);
    const ammo = ammoId
        ? ((actor as any).inventory?.get?.(ammoId) ?? (actor as any).items?.get?.(ammoId))
        : null;
    let 装上了 = false;
    try {
        if (ammo && 空位 > 0 && typeof weapon?.attach === "function") {
            await weapon.attach(ammo, { quantity: 1, stack: true });
            /*
             * ★★ **装完回读，不假定 attach 成功**。
             *   `attach` 不校验兼容性（实测把 Clan Pistol 的弹装进 Scattergun 它照做），
             *   而开火时 pf2e 问的是 `weapon.ammo` 这个 getter，它对**需要装填**的武器
             *   走的是 `subitems.filter(i => i.isAmmoFor(weapon))` —— **带兼容性检查**。
             *   ⇒ 两者判据不同：装得进去 ≠ 打得出来。
             * ★ 不回读的话，失败会一路顺到开火那一刻才炸，
             *   而那时的报错（"No ammunition is assigned to …"）指向的是角色卡，
             *   玩家根本不会想到是刚才那一下装填没成。
             *   ★ **在做错的那一步就说，不要等到用的时候才暴露。**
             */
            装上了 = !!(weapon as any).ammo;
            if (!装上了) {
                ui.notifications.warn(
                    `${(ammo as any).name} did not load into ${(weapon as any).name}.`);
            }
        } else if (ammo && 空位 <= 0) {
            /* ★ 指得到字段（remaining === 0）才敢写这句话（playbook 7.5）。
               ⚠ 而且要说**事实**："已经装满了"，不是"你不能装填"—— 后者会被读成
                 一条不存在的规则限制。 */
            ui.notifications.info(`${(weapon as any)?.name ?? "This weapon"} is already loaded.`);
        }
    } catch (err) {
        console.error("player-action-ui-hub | 装填失败", err);
    }
    const round = currentRound(actor);
    if (round !== null) economy.spend(actor.id, round, economy.costToPoints(cost));

    /*
     * —— 回执：两种卡各说各的事（Nous 2026-08-08 拿两张卡对比后提的）——
     *
     *   - **真装上了** → 照抄 pf2e 的 Reload 卡（武器图 + "X loads W with M."）。
     *     通用 Interact 卡答不出"装了哪把枪、装的什么弹"，而那是这张卡唯一要说的事。
     *   - **没装上**（没弹药 / 已经满了）→ 仍发通用 **Interact** 卡：
     *     动作确实做了，只是它不是一次装填。★ 两张卡都准确，不能拿一张顶另一张。
     *
     * ⚠ **战斗外不发聊天** —— 照 pf2e 那句 `if (!game.combat) return`：
     *   战斗外装填不占动作经济，刷一张卡是噪音。
     *   ★ 但轮盘不像角色卡那样能直接看见弹药格，所以给一条 notification 兜底：
     *     "点了没反应"正是这一轮在根除的东西，不能为了对齐又把它请回来。
     */
    if (装上了) {
        // ⚠ 名字与卡上口径一致：走 weapon.actor（见 sendReloadMessage 的注释）
        const 句 = game.i18n.format("PF2E.Actions.Interact.Reload.Description", {
            actor: ((weapon as any)?.actor ?? actor)?.name,
            weapon: (weapon as any)?.name, ammo: (ammo as any)?.name,
        });
        if (game.combat) await sendReloadMessage(actor, weapon, ammo);
        else ui.notifications.info(句);
    } else {
        await useAction(actor, "interact", ev);
    }
    回到打击层(actor);
}

/**
 * 装填完**回到打击层，不关盘**（Nous 2026-08-08）。
 *
 * > "reload 之后不要关掉 ui，回到进入 strike 之后的页面。"
 *
 * ★ 这与「准备类动作执行后不关盘」是同一条（2026-08-05 定的，那次说的是拔刀）：
 *   **装填不是一件"做完了"的事** —— 玩家装填的本意就是接着打。
 *   关掉盘等于让他把"呼出 → 进打击层"再走一遍，而那正是轮盘要省掉的动作。
 *   ⚠ 当时那条只写进了拔刀那一支，装填这一支还留着 `close()` —— 又一处
 *     "规矩定了但只落实到发现它的那一个地方"（playbook〇·五：按类修，别按条修）。
 *
 * ⚠ **顺手把 `rebuild` 接回去**：进装填分支时它被清成了 `undefined`（分支层不随数据变）。
 *   不接回来的话，回到打击层之后双向绑定是断的 —— 而装填**恰好改了武器数据**，
 *   那一格正要靠重画才更新。断了的话玩家会看到一个装填前的旧盘面，
 *   ★ 那是"看起来正确的错数"，比关掉盘更糟。
 */
function 回到打击层(actor: ActorPF2e): void {
    if (!openWheel?.rendered) return;          // 玩家已经自己关了（Esc）→ 不要把它拉回来
    const lv = buildStrikeLevel(actor);
    // 没打击可回（武器被丢了/被夺了）→ 关掉总比停在一个空层上好
    if (!lv) { openWheel.close(); return; }
    openWheel.rebuild = () => buildStrikeLevel(actor);
    void openWheel.setLevel(lv);
}

/**
 * 补上这个宏"额外算几次攻击"的那部分（G9）。
 *
 * ★ 掷出来的那次由聊天消息观测到，这里只补**规则说算但没掷**的那些
 *   —— 目前只有 Spellstrike 的第二次。见 `ActionMacro.extraAttacks`。
 */
function 补记额外攻击(actor: ActorPF2e, macro: ActionMacro): void {
    const n = macro.extraAttacks ?? 0;
    if (n <= 0) return;
    const round = currentRound(actor);
    if (round !== null) economy.noteAttack(actor.id, round, n);
}

/**
 * 这个宏跑完之后要不要记一笔"用掉了"。
 *
 * ⚠ 目前只有 Spellstrike 一条 —— 它是**唯一**系统一个字段都没记的次数限制
 *   （见 spellstrike-charge.ts 顶部的三条判据）。别顺手往这里加第二条：
 *   系统记了的一律读系统的 `frequency`。
 */
async function 记账(actor: ActorPF2e, macro: ActionMacro): Promise<void> {
    if (macro.slug === "spellstrike") await markSpent(actor);
}

/**
 * 编排推进一步：记下选择，有下一步就换层，没有就执行。
 *
 * ★ 翻选条的档位在**离开这一层之前**读走 —— 它是"这次连击从第几击开始"，
 *   而下一层没有翻选条，读晚了就没了。
 */
function 推进编排(actor: ActorPF2e, s: SectorData, ev: MouseEvent): void {
    const 状态 = 活跃编排;
    if (!状态) return;

    if (s.id === "__back") {
        // 退一步；退到头就退出编排、回到职业层
        状态.ctx.picks.pop();
        状态.step -= 1;
        if (状态.step < 0) {
            活跃编排 = null;
            const sectors = 职业层条目(actor);
            void openWheel!.setLevel({
                title: className(actor) ?? "Class", canGoBack: true, paging: { page: 0 }, sectors,
            });
            return;
        }
        const 回 = levelForStep(actor, 状态.macro, 状态.step, 状态.ctx);
        if (回) void openWheel!.setLevel(回);
        return;
    }

    状态.ctx.variantIndex = openWheel!.currentVariantIndex();

    /*
     * ★ **选目标这一步由编排器统一处理**（Nous 2026-08-05：
     *   "这种多目标的应该是要做成 ui 化 > 我们的轮盘 ui 应该会询问玩家要用那个"）。
     *   认 `tgt:` 前缀，选中即设为 Foundry 的目标 ——
     *   于是任何宏加一个选目标的步骤就能用，不用各写一份。
     * ⚠ 必须在这里设、不能拖到 `run` —— 后面的步骤（以及掷骰）都要看得见这个目标。
     */
    const 本步 = 状态.macro.steps[状态.step];
    if (本步?.multiTarget && s.id !== TARGET_DONE) {
        /*
         * ★ 多选（Nous 选的 A 方案：累加 + 确认格）：
         *   **点目标不推进，原地重画** —— 不重画的话 ◎ 记号和「选了几个」不会更新，
         *   玩家就只能凭记忆数自己选了谁，那正是多选界面最常见的毛病。
         */
        if (applyTargetPick(s.id, true)) {
            const 重画 = levelForStep(actor, 状态.macro, 状态.step, 状态.ctx);
            if (重画) void openWheel!.setLevel(重画);
        }
        return;
    }
    if (s.id === TARGET_DONE && 状态.ctx.picks.length === 状态.step) {
        // 确认格：把这一步的选择记成"当前选中的那些目标"，然后推进
        状态.ctx.picks.push([...((game as any)?.user?.targets ?? [])].map((t: any) => t.id).join(","));
        状态.step += 1;
        const 下 = levelForStep(actor, 状态.macro, 状态.step, 状态.ctx);
        if (下) { void openWheel!.setLevel(下); return; }
        const 跑2 = 状态.macro.run(actor, 状态.ctx, ev);
        补记额外攻击(actor, 状态.macro);
        void 记账(actor, 状态.macro);
        活跃编排 = null;
        void 跑2.then(() => openWheel?.close());
        return;
    }

    状态.ctx.picks.push(s.id);
    applyTargetPick(s.id);
    状态.step += 1;

    const 下一层 = levelForStep(actor, 状态.macro, 状态.step, 状态.ctx);
    if (下一层) {
        void openWheel!.setLevel(下一层);
        return;
    }
    // 步骤走完 → 执行。执行是终结动作，关盘。
    const 跑 = 状态.macro.run(actor, 状态.ctx, ev);
    补记额外攻击(actor, 状态.macro);
    void 记账(actor, 状态.macro);
    活跃编排 = null;
    void 跑.then(() => openWheel?.close());
}
/**
 * 当前轮盘是为**哪个** actor 开的。
 * ⚠ 别在钩子里改用 `resolveActor()` 现算：轮盘开着的时候玩家可能已经改选了别的
 *   token，那时现算出来的不是盘面对应的角色，会拿别人的变更去刷新我们的盘。
 */
let openWheelActor: ActorPF2e | null = null;
/**
 * 上一次呼出轮盘的屏幕坐标。换身体时拿它当新盘的圆心 ——
 * 用鼠标当下的位置会让新盘从旧盘边缘长出来，视觉上跳一下。
 */
let lastOpen = { x: 0, y: 0 };

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
    /*
     * ★ 打击之后接上**辅助动作与装填**（2026-08-05 alpha 反馈）：
     *   拔刀/收鞘/换握/丢弃/装填原来根本没有入口 —— 只有"未拔出"时那一个拔刀记号。
     *   它们排在打击**后面**：打是主线，摆弄武器是辅助，顺序反映使用频率。
     *
     * ⚠ 打击在前还带来一个必要性质：翻选条的默认文字取 `sectors[0]`，
     *   那必须是一把武器（辅助动作没有 MAP 档位）。
     */
    const sectors = [...strikes, ...collectStrikeAuxiliaries(actor)];
    // 翻选条的"默认文字"取本层第一个条目的；悬停到别的武器时
    // 由 WheelApp 换成那把武器自己的（不同武器加值不同，见 types.ts）。
    const labels = strikes[0]?.variantLabels ?? [];
    /*
     * ★ **G9：翻选条开在这回合该用的那一档**，不是永远从第 1 击开始。
     *   档位由**观测**得来（数这回合的攻击掷骰消息），不是我们记的账 ——
     *   见 attacks.ts 顶部：记账只记得住从轮盘打出去的那些。
     * ⚠ 只预选、不锁死：翻选条照旧能翻。规则里有一堆"这次不计入 MAP"的特例，
     *   我们不打算认识它们；预选错了翻一下就好，锁死就没救了。
     * ⚠ 战斗外没有回合 → 不数，回到第 1 击（与动作经济同一条边界）。
     */
    const round = currentRound(actor);
    const 起始档 = round === null ? 0 : nextMapIndex(economy.attacksThisTurn(actor.id, round));
    return {
        title: "Strikes",
        canGoBack: true,
        variant: labels.length ? { index: 起始档, labels } : undefined,
        // 武器多了之后一圈放不下，照动作层那样分页
        // ⚠ 阈值跟着 PAGE_SIZE 走，别再写死一个数 —— 改了一处忘了另一处，
        //    表现是"第 9 把武器凭空消失"，而且不报错
        paging: sectors.length > PAGE_SIZE ? { page: 0 } : undefined,
        sectors,
    };
}

/**
 * 职业层的条目 = **卡上那些** + 焦点没满时的 Refocus。
 *
 * ★ Refocus 挂在这一层，是因为焦点是职业资源（毂里那行 `Focus ✦ 1/1` 就在旁边）。
 *   ⚠ 它是这一层唯一**不来自角色卡**的条目 —— 卡上确实没有它，
 *     而纲要里有一条完整的（见 refocus.ts）。
 */
function 职业层条目(actor: ActorPF2e): SectorData[] {
    /*
     * ★ 两颗**充能键**都挂在这一层（Nous 2026-08-07：
     *   "recharge spellstrike，就像是那个 focus pool 一样……
     *    然后那个 recharge focus spell 也在 class 里面做一个充能按键"）。
     *   它们的共同形状是：**一个用光了的资源 + 一个把它拿回来的动作**。
     * ⚠ 两颗都**只在用得着时出现** —— 满的时候点了什么也不会发生，
     *   而点了没反应的格子会被读成"坏了"。
     */
    const 打击 = spellstrikeItemOf(actor);
    const 注 = spentNote(actor);
    const sectors = collectClassAbilities(actor).map(s =>
        // Spellstrike 那一格用掉之后灰显 + 说明白是**我们**在记账
        (注 && 打击 && s.id === `class:${打击.id}`) ? { ...s, ...注 } : s);

    const 出: SectorData[] = [...sectors];
    const 充 = rechargeSector(actor, (actor as any)?.items?.get?.(打击?.id ?? "")?.img);
    if (充) 出.push(充);
    const 焦 = refocusSector(
        (actor as any)?.system?.resources?.focus,
        // ⚠ 名字与图标照纲要取，不自己写死一个 —— 换语言、换版本都跟着走
        (globalThis as any).fromUuidSync?.(REFOCUS_UUID) ?? { name: "Refocus" },
    );
    if (焦) 出.push(焦);
    return 出;
}

/**
 * 现算一层**分类层**盘面。
 *
 * ★ 抽成函数是因为它要被算**两次**：呼出时先用手上的数据算一版，
 *   角色卡那份清单异步回来之后再算一版 —— 两处必须同一份逻辑，
 *   否则刷新出来的计数会和刚呼出时对不上（这正是 2026-08-07 那个 bug）。
 */
function 分类层(actor: ActorPF2e): WheelLevel {
    /*
     * 分类层带计数与空分类灰显（设计定档 §7）。
     *
     * ★ **同一份采集结果既供计数也供下钻** —— §7 明确要求，不要为计数单写一套轻量逻辑。
     *   两套逻辑必然分叉（executor 的 findStrike 当年就是这么错的）。
     *   代价是呼出时要跑四个采集器；实测 70 条动作那次也在毫秒级，可以接受。
     *
     * ⚠ 空分类**灰显但仍可点** —— 三态守则："提示不是锁"。
     *   点了给一句说明，比一个点不动的死格子强：玩家至少知道自己没点错。
     */
    const counts = {
        strikes: collectStrikes(actor).length,
        actions: collectActions(actor).length,
        skills: collectSkills(actor).length,
        class: 职业层条目(actor).length,
        spells: collectSpellEntries(actor).length,
        // ★ 反应是**横切镜头**：这里数出来的条目同时还留在职业层/动作层里。
        //   重复是特性不是 bug —— 见 collectors/reactions.ts 顶部。
        reactions: collectReactions(actor).length,
        // G8 · 我控制的其他单位（幻灵/爪牙/魔宠/同伴）。判据是**归属**不是标签。
        bodies: collectBodies(actor).length,
        // G11 · 带层数、可以减一层的条件。pf2e 一条都不自动减（实测）。
        conditions: collectConditions(actor).length,
        /*
         * ★ 卡上的「Free Actions」那一节（Nous 2026-08-07：
         *   "玩家表格上还有 free action，这个要是表格上没有我们就不显示目录"）。
         * ⚠ 与 Bodies / Conditions 同一条规矩：**空的就不画这一格**。
         *   自由动作是少数角色才有的东西（实测 5 级 Magus 一条都没有），
         *   常驻会让绝大多数人多背一个永远灰着的格子。
         */
        free: collectFreeActions(actor).length,
        /*
         * ★ **法术那一格的替补**（Nous 2026-08-07：
         *   "要是这个 class 没有 spell，就看看有没有 activation（卷轴）"）。
         *   卷轴、魔杖、药水、炼金药剂 —— 对没有法术的职业，
         *   "点一下放个效果"这件事就发生在背包里。
         */
        activations: collectActivations(actor).length,
    };
    const cat = (id: keyof typeof counts, label: string): SectorData => ({
        id,
        label,
        // 分类层用单色 SVG，与内容层的彩色贴图区分开 —— 一眼看出这是导航层
        img: CATEGORY_ICONS[id],
        /*
         * ★ 计数移到 detail：印在扇区上会挤（`Actions (25)` 比图标宽得多），
         *   而它是"想知道才看"的参考数，悬停时在毂里给就够了。
         *
         * ⚠ **空的时候只说一句**（Nous 2026-08-07）：原来同时画
         *   "0 available" 和 "Nothing available in this category right now."，
         *   **同一件事说了两遍**，而且第二遍还更长。
         *   零本来就是"没有"，再补一句解释是话多，不是清楚。
         */
        detail: counts[id] > 0 ? `${counts[id]} available` : undefined,
        cost: null,
        state: counts[id] > 0 ? "normal" : "gated",
        reason: counts[id] > 0 ? undefined : "Nothing here.",
    });
    return {
        title: actor.name,
        canGoBack: false,
        sectors: [
            /*
             * ★★ **空的分类一律不画**（Nous 2026-08-07：先是 Bodies/Free/Conditions，
             *   然后 "如果都没有，就不要显示 spell 栏了"、"reaction 也是一样的道理"）。
             *
             *   原来是"灰显但仍可点，点了给一句说明"—— 那条守则针对的是
             *   **我们算不准的判断**（够不够近、满不满足要求）。
             *   而"这个角色有没有反应"是**数出来的事实**，零就是零；
             *   摆一个永远点不出东西的格子，只是让每个人都多背一格。
             */
            ...(counts.strikes > 0 ? [cat("strikes", "Strikes")] : []),
            ...(counts.actions > 0 ? [cat("actions", "Actions")] : []),
            ...(counts.skills > 0 ? [cat("skills", "Skills")] : []),
            ...(counts.class > 0 ? [cat("class", "Class")] : []),
            /*
             * ★ 法术与激活**各是各的一格**（Nous 2026-08-07：
             *   "有卷轴和魔杖等物品的有的话也开一个"）。
             *
             *   我先做成了"二选一"——有法术就不看背包。那是错的：
             *   法师身上那张卷轴和那根魔杖**照样要点**，
             *   而按二选一的话它们只能回角色卡去找。
             *   ★ 判据回到最简单的那条：**每一格各问各的，非空就画。**
             */
            ...(counts.spells > 0 ? [cat("spells", "Spells")] : []),
            ...(counts.activations > 0 ? [cat("activations", "Items")] : []),
            ...(counts.reactions > 0 ? [cat("reactions", "Reactions")] : []),
            // ★ 卡上有自由动作才出现（见上面 counts.free 那段）
            ...(counts.free > 0 ? [cat("free", "Free")] : []),
            /*
             * ★ **只有真有其他身体时才出现这一格**（G8）。
             *   前六格是"我能做什么"，这一格问的是"**谁在做**" —— 不同的轴。
             *   常驻会让绝大多数角色多背一个永远灰着的格子，
             *   而它灰着的时候不传达任何信息（"你没有同伴"没人需要被告知）。
             *
             * ⚠ 于是分类层的**格数会变**。凡是写死"六格"的地方都会漏 ——
             *   e2e 那两条断言已经改成跟着常量走，别再写死回去。
             */
            ...(counts.bodies > 0 ? [cat("bodies", "Bodies")] : []),
            /*
             * ★ **有得减才出现**（同 Bodies 那一格的道理）：
             *   身上一个带层数的条件都没有时，这一格灰着也不传达任何信息。
             */
            ...(counts.conditions > 0 ? [cat("conditions", "Conditions")] : []),
        ],
    };
}

/**
 * 在屏幕坐标 (x, y) 处呼出分类层轮盘。
 *
 * @param 换成 指定驱动哪具身体；不给就按 `resolveActor()` 的常规规则来。
 *
 * ★ **换身体就是拿另一个 actor 重开一次分类层**（G8）。
 *   点击回调闭包里捕获的是 `actor`，所以换身体没法"就地改一改" ——
 *   硬改会留下一个仍指着旧身体的回调，而它**不报错**：
 *   盘上写着爪牙的名字，掷出去的却是主人的骰子。
 */
function openAt(x: number, y: number, 换成?: ActorPF2e): void {
    lastOpen = { x, y };
    const actor = 换成 ?? resolveActor();
    if (!actor) {
        ui.notifications.warn("Player Action UI Hub: no character to act with — select your token first.");
        return;
    }
    /*
     * ★ **先把角色卡那份清单取回来**（Nous 2026-08-07："照角色卡搬"）。
     * ⚠ 它是异步的（实测 2.6ms），而这里不能变成 async ——
     *   呼出必须在这一下事件里同步开盘，否则会和"吞掉整串点击事件"那套打架。
     *   所以：先用手上的（可能是上一次的）画一版，取回来之后再刷新一次。
     *   ⚠ 刷新前要确认盘还开着**而且还是同一个角色**，
     *     否则玩家已经换了目标，我们会拿旧清单去盖新盘。
     */
    void Promise.all([primeSheetActions(actor), primeSpellGroups(actor), primeStrikeDamage(actor)]).then(() => {
        if (!openWheel?.rendered || openWheelActor?.id !== (actor as any).id) return;
        /*
         * ⚠⚠ **重画不够，要重新采一次**（2026-08-07 实机看出来的）：
         *   分类层那几个计数是**开盘那一刻算好写进 sector.detail 的字符串**，
         *   而卡上那份清单是这之后才回来的。`refresh()` 只是拿同一份 level 再画一遍，
         *   于是 Actions 明明列了 8 条，毂里却写着 "4 available"。
         *   ★ 它不报错，只是数字偏小 —— 而"偏小的计数"比没有计数更糟：
         *     玩家会据此以为那一格没什么东西，根本不点进去。
         * ⚠ 只在**还停在分类层**时重建：已经下钻了就别把人踢回去
         *   （分类层是唯一 `canGoBack === false` 的那一层）。
         */
        if (openWheel.atRoot) void openWheel.setLevel(分类层(actor));
        else void openWheel.refresh();
    });
    openWheel?.close();
    openWheelActor = actor;
    const level = 分类层(actor);
    活跃编排 = null;
    openWheel = new WheelApp(level, (s, ev) => {
        /*
         * —— 编排中（乙类动作）——
         *
         * ★ 必须在**所有其它分支之前**：编排的步骤里列的是打击、法术这些东西，
         *   扇区 id 与普通层完全一样。不先拦，点第一击就会被打击层的分支接走、
         *   直接掷出去，编排到此为止 —— 而且不报错。
         */
        if (活跃编排) {
            推进编排(actor, s, ev);
            return;
        }

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
                // ⚠ 精简之后绝大多数角色一页就装下了 —— 装得下就**不画**翻页条
                //   （画一条永远两头都灰的翻页条，等于告诉玩家"这里还有别的"，而并没有）
                paging: sectors.length > PAGE_SIZE ? { page: 0 } : undefined,
                sectors,
            });
            return;
        }

        // —— 分类层 → 激活层（卷轴 / 魔杖 / 药水 / 药剂）——
        if (s.id === "activations") {
            const sectors = collectActivations(actor);
            if (!sectors.length) {
                ui.notifications.info("Nothing in your pack to activate.");
                return;
            }
            openWheel!.rebuild = () => {
                // ★ 用掉一张卷轴之后要重画：次数印在扇区上，用完那一格就该消失
                const 新 = collectActivations(actor);
                return 新.length
                    ? { title: "Items", canGoBack: true,
                        paging: 新.length > PAGE_SIZE ? { page: 0 } : undefined, sectors: 新 }
                    : null;
            };
            void openWheel!.setLevel({
                title: "Items", canGoBack: true,
                paging: sectors.length > PAGE_SIZE ? { page: 0 } : undefined, sectors,
            });
            return;
        }

        /*
         * —— 激活层：用掉它 ——
         *
         * ★ 消耗品走 pf2e 自己的 `consume()` —— 扣次数、用完销毁、
         *   卷轴还会替你把里面那个法术放出来，一样都不用我们重做。
         * ⚠ 穿戴类魔法物品没有 `consume()`，退回 `rollItemMacro`（贴激活卡）。
         */
        if (s.id.startsWith("activate:")) {
            const item: any = actor.items.get(s.id.slice("activate:".length));
            if (!item) {
                ui.notifications.warn("That item is no longer in your pack — reopen the wheel.");
                return;
            }
            const round = currentRound(actor);
            if (round !== null) economy.spend(actor.id, round, economy.costToPoints(s.cost));
            const 跑 = typeof item.consume === "function"
                ? item.consume()
                : (game as any).pf2e.rollItemMacro(item.uuid);
            void Promise.resolve(跑).then(() => openWheel?.close());
            return;
        }

        // —— 分类层 → 自由动作层 ——
        if (s.id === "free") {
            const sectors = collectFreeActions(actor);
            if (!sectors.length) {
                ui.notifications.info("This character has no free actions.");
                return;
            }
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({
                title: "Free Actions",
                canGoBack: true,
                paging: sectors.length > PAGE_SIZE ? { page: 0 } : undefined,
                sectors,
            });
            return;
        }

        /*
         * —— 动作层末位：去开角色卡 ——
         *
         * ★ 这一格答的是"**我要的动作不在这里怎么办**"。
         *   答案不是我们把 70 条通用动作全摆出来（点了只会贴一段说明），
         *   而是把他领到唯一能一次配好的地方 —— alpha 反馈原话：
         *   "players can just add which actions they want… Just that actions tab
         *    on the character sheet."
         * ⚠ 开卡是终结动作，关盘：卡窗口会盖住轮盘，留着只会互相挡。
         */
        /*
         * —— 职业层：Refocus ——
         *
         * ★ 卡片照纲要那条发（一个字不编），点数**我们自己加**：
         *   pf2e 对 Refocus 零自动化（只有 restForTheNight 会填满池子）。
         * ⚠ 加点数是写 actor，所以毂里那句话已经预告过"Restores 1 Focus Point"——
         *   未经预告地改玩家的资源，比不改更糟。
         */
        /*
         * —— 职业层：Spellstrike 充能 ——
         *
         * ★ 规则原文："recharge your Spellstrike as a single action, which has the
         *   concentrate trait" —— 所以照常扣一个动作点。
         * ⚠ 这本账是**我们自己记的**（pf2e 零建模），所以灰显那句话也自报了家门。
         */
        if (s.id === RECHARGE_ID) {
            const round = currentRound(actor);
            if (round !== null) economy.spend(actor.id, round, economy.costToPoints(s.cost));
            // ⚠ 不关盘：充完多半是要接着打，双向绑定会把 Spellstrike 由灰转亮
            void 充能(actor);
            return;
        }

        if (s.id === REFOCUS_ID) {
            const pool = (actor as any)?.system?.resources?.focus;
            void (async () => {
                try {
                    /*
                     * ⚠⚠ **纲要里的条目不能 `toMessage()`** —— pf2e 那个方法第一行就是
                     *   `if (!this.actor) throw ErrorPF2e("Cannot create message for unowned item")`。
                     *   实测：它静默失败，聊天栏里最后一条还是上一次的卡（我第一版就是这么错的）。
                     * ★ 改用 `@Embed[uuid]` —— Foundry 自己的嵌入语法，
                     *   渲染出来的是**系统那条 Refocus 的原文**（要求 + 规则），一个字不用我们编。
                     */
                    const TE: any = (foundry as any).applications.ux.TextEditor.implementation
                                 ?? (foundry as any).applications.ux.TextEditor;
                    await ChatMessage.create({
                        content: await TE.enrichHTML(`@Embed[${REFOCUS_UUID}]`),
                        speaker: ChatMessage.getSpeaker({ actor: actor as any }),
                    });
                } catch (err) {
                    console.error("player-action-ui-hub | 贴 Refocus 卡片失败", err);
                }
                await (actor as any).update?.({ "system.resources.focus.value": refocusedValue(pool) });
                openWheel?.close();
            })();
            return;
        }

        if (s.id === SHEET_HINT_ID) {
            void (actor as any).sheet?.render?.(true);
            openWheel?.close();
            return;
        }

        // —— 分类层 → 职业层 ——
        if (s.id === "class") {
            const sectors = 职业层条目(actor);
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

        /*
         * —— 分类层 → 反应层 ——
         *
         * ★ 这一层的用途是"**我还有哪些反应，触发条件各是什么**"。
         *   丙类调研 §4.2 实测：16 条反应的触发事件 pf2e 根本不广播
         *   （含最常用的 Reactive Strike），自动开窗口无解 ——
         *   于是把这一半交回玩家：摆出来 + 摆出触发条件，他自己判断时机。
         *
         * ⚠ 空的时候那句话要说清"**是这个角色没有**"，不是"功能坏了"：
         *   实测 5 级 Magus 一条反应都没有，这一格经常是空的。
         */
        if (s.id === "reactions") {
            const sectors = collectReactions(actor);
            if (!sectors.length) {
                ui.notifications.info("This character has no reactions.");
                return;
            }
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({
                title: "Reactions", canGoBack: true, paging: { page: 0 }, sectors,
            });
            return;
        }

        /*
         * —— 分类层 → 身体层（G8）——
         *
         * ★ 这一层列的是"**我控制的其他单位**"：幻灵 / 爪牙 / 魔宠 / 动物同伴。
         *   它们在系统里各不相同，但对轮盘是同一个问题 ——
         *   这一步不是我做，是我控制的另一具身体做。
         * ⚠ 我们**不替他认哪一个是幻灵**（一个玩家可能拥有两个 PC，系统也无从回答）。
         *   让他自己选，我们照他选的执行 —— 与目标选择同一条路。
         */
        if (s.id === "bodies") {
            const sectors = collectBodies(actor);
            if (!sectors.length) {
                ui.notifications.info("You don't control any other creature.");
                return;
            }
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({
                title: "Bodies", canGoBack: true, paging: { page: 0 }, sectors,
            });
            return;
        }

        // —— 身体层：换一具身体重开分类层 ——
        if (s.id.startsWith(BODY_PREFIX)) {
            const 目标 = (game as any).actors?.get(s.id.slice(BODY_PREFIX.length));
            if (!目标) {
                ui.notifications.warn("That creature is no longer available — reopen the wheel.");
                return;
            }
            /*
             * ★ 用**上一次呼出的坐标**重开，不是鼠标现在的位置：
             *   玩家点的是盘上的一格，鼠标此刻在扇区上 ——
             *   拿它当圆心会让新盘从旧盘的边缘长出来，跳一下。
             */
            openAt(lastOpen.x, lastOpen.y, 目标);
            return;
        }

        /*
         * —— 分类层 → 条件层（G11）——
         *
         * ★ 实测 pf2e **一条条件都不自动递减**（frightened 2 跨完整一轮仍是 2），
         *   而"自动帮他减"= 替系统判规则 + 未经请求写 actor。
         *   Nous 选的是**一键**：摆出来点一下，仍然是"玩家发出的指令"。
         */
        if (s.id === "conditions") {
            const sectors = collectConditions(actor);
            if (!sectors.length) {
                ui.notifications.info("Nothing on you has a counter to reduce.");
                return;
            }
            openWheel!.rebuild = () => {
                // ★ 减完要重画：层数印在扇区上，不重画就还是旧数字
                const 新 = collectConditions(actor);
                return 新.length ? { title: "Conditions", canGoBack: true, paging: { page: 0 }, sectors: 新 } : null;
            };
            void openWheel!.setLevel({
                title: "Conditions", canGoBack: true, paging: { page: 0 }, sectors,
            });
            return;
        }

        // —— 条件层：减一层 ——
        if (s.id.startsWith(CONDITION_PREFIX)) {
            const slug = s.id.slice(CONDITION_PREFIX.length);
            /*
             * ⚠ 用 pf2e 自己的 `decreaseCondition` —— 减到 0 时它会**把条目删掉**，
             *   而且会带上系统该做的联动。自己改 `value` 会留下一个 0 层的僵尸条件。
             * ⚠ **不关盘**：减层数常常要连点几下（stunned 3 → 0），
             *   关掉就得重新呼出三次。重画由上面那个 rebuild 负责。
             */
            void (actor as any).decreaseCondition?.(slug);
            return;
        }

        // —— 分类层 → 技能层 ——
        if (s.id === "skills") {
            const sectors = collectSkills(actor);
            if (!sectors.length) {
                ui.notifications.info("This character has no skills.");
                return;
            }
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({
                title: "Skills", canGoBack: true, paging: { page: 0 }, sectors,
            });
            return;
        }

        // —— 技能层 → 该技能的检定与动作 ——
        if (s.id.startsWith("skill:")) {
            const slug = s.id.slice("skill:".length);
            const sectors = collectSkillActions(actor, slug);
            if (!sectors.length) {
                ui.notifications.info("Nothing available for that skill.");
                return;
            }
            void openWheel!.setLevel({
                title: s.label, canGoBack: true, paging: { page: 0 }, sectors,
            });
            return;
        }

        // —— 技能层：掷裸检定 ——
        if (s.id.startsWith("skillcheck:")) {
            const slug = s.id.slice("skillcheck:".length);
            // ⚠ 裸检定**不扣动作点**：掷一次技能本身不是一个动作，
            //   花几个动作取决于你用它做什么（那由具体动作决定）。
            void rollSkill(actor, slug, ev).then(() => openWheel?.close());
            return;
        }

        // —— 分类层 → 法术条目层 ——
        if (s.id === "spells") {
            const sectors = collectSpellEntries(actor);
            if (!sectors.length) {
                ui.notifications.info("This character has no spells to cast.");
                return;
            }
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel({ title: "Spells", canGoBack: true, sectors });
            return;
        }

        // —— 法术条目层 → 具体法术层（**一页一环**）——
        if (s.id.startsWith("spellentry:")) {
            const entryId = s.id.slice("spellentry:".length);
            const 建法术层 = (): WheelLevel | null => {
                const d = collectSpells(actor, entryId);
                if (!d.sectors.length) return null;
                return {
                    title: s.label,
                    canGoBack: true,
                    // ★ 有分组就按环分页（毂里画点阵，当前那一列高亮）；
                    //   退化路径没有分组，退回按 PAGE_SIZE 切
                    paging: d.groups.length ? { page: 0, groups: d.groups }
                          : d.sectors.length > PAGE_SIZE ? { page: 0 } : undefined,
                    sectors: d.sectors,
                    // ⚠ `current` 由 wheel-app 按当前页的组标签现算 —— 这里只给列
                    ...(d.columns.length ? { slots: { columns: d.columns, current: -1 } } : {}),
                };
            };
            const level = 建法术层();
            if (!level) {
                ui.notifications.info("That spellcasting entry has no spells.");
                return;
            }
            /*
             * ★ 放完一个法术要重画（Nous 2026-08-08："如果有更改也是重绘新的法术上去"）：
             *   位少了一个、准备位用掉了 —— 那一环的余量与条目都得跟着变。
             * ⚠ 分组是**异步取回来缓存**的，重画前得先重取；
             *   重取由文档钩子那边负责（见 ready 里的 REFRESH_HOOKS），这里只管现算。
             */
            openWheel!.rebuild = 建法术层;
            void openWheel!.setLevel(level);
            return;
        }

        // —— 任意层 → 分类层 ——
        if (s.id === "__back") {
            /*
             * ⚠ **从选目标层退出要把预选清掉**（Nous 2026-08-08：
             *   "我被夹在这个无法清除的选择框里面"）。
             *   他没确认就退了 ⇒ 那些 target 是我们替他点的，不该留在画布上；
             *   而退出之后盘上已经没有取消它们的入口了。
             * ★ `清掉预选目标` 自己判"这一层是不是我们开的" —— 不能无条件清：
             *   编排器也有选目标步骤，玩家还可能在盘外自己选好了目标。
             */
            清掉预选目标();
            // 分类层是四个写死的格子，没有随角色变的东西 → 撤掉重算回调
            openWheel!.rebuild = undefined;
            void openWheel!.setLevel(level);
            return;
        }

        /*
         * —— 打击层：辅助动作（拔刀/收鞘/换握/丢弃）——
         *
         * ★ **执行后不关盘**：摆弄武器不是"做完了"的事，玩家的本意是接着打。
         *   双向绑定会把刚拔出来的那把由灰转正常，下一下就能点它攻击。
         *
         * ⚠ 必须排在 `strike:` 分支**之前** —— `startsWith("strike:")` 匹配不到
         *   `aux:strike:...`，但顺序写反了以后加别的前缀容易踩。
         */
        if (s.id.startsWith("aux:")) {
            const [, ...rest] = s.id.split(":");
            const auxIndex = Number(rest.pop());
            const strikeId = rest.join(":");
            const round = currentRound(actor);
            if (round !== null) economy.spend(actor.id, round, economy.costToPoints(s.cost));
            void execAuxiliary(actor, strikeId, auxIndex);
            return;
        }

        // —— 打击层：装填 ——
        /*
         * —— 装填：先问装哪一发（Nous 2026-08-07）——
         *
         * > "这个 sheet 里面可以选择上子弹，我们的 ui 里面没反应。
         * >  我建议我们做成 spell strike 那样有分支 ui 继续点击，这里就是要上什么弹药。"
         *
         * ★★ 候选**不是我们挑的** —— `strike.ammunition.compatible` 就是角色卡上
         *   那个下拉的内容，系统已经算好成 `{ id, label }`，照着摆就行。
         * ★ 选中 = 把 `selectedAmmoId` 写到武器上 —— 这也是**角色卡自己的做法**
         *   （实测卡上那段代码就是 `weapon.update({ system: { selectedAmmoId } })`）。
         */
        if (s.id.startsWith("reload:")) {
            const strike = 找打击(actor, s.id.slice("reload:".length));
            const 候选: any[] = (strike as any)?.ammunition?.compatible ?? [];
            /*
             * ★★ **只要背包里有弹药就展开，一种也展开**（Nous 2026-08-08："别搞特例了"）。
             *
             *   上一版是 `候选.length > 1`，理由写的是"只有一种就直接用它，
             *   不为了统一多问一步"。⚠ 那个理由**只在我这边成立** ——
             *   它省的是一次点击，付的却是「同一格点下去，有时展开一层、有时直接执行完」。
             *   玩家看到的是**一个行为不定的按钮**，而他并不知道自己背包里有几种弹药。
             *   ★ Nous 报的症状正是这个：
             *   > "没有任何 ui 展开要装填什么，就只是弹出一下 reload 动作标签，
             *   >  但是什么也没有做，然后 ui 就认为完成就消失了。"
             *   —— 少的那一步不是"省了"，是**整件事看起来没发生**。
             *   ⇒ 判据（playbook 12.6 的同一条）：同一格的行为要么每次都展开，
             *     要么每次都不展开；**用"背后有几个候选"去改变前台行为，玩家读不到**。
             */
            if (候选.length > 0) {
                /*
                 * 开分支层问装哪一发（同 Spellstrike 的形状，也同 pf2e 那个装填弹窗）。
                 * ⚠ `remaining` = **还能装几发**，不是"还剩多少弹药"（见 `装填` 顶部）。
                 *   装满了这几格就是 gated —— 那是**系统断言的事实**不是我们的推断，
                 *   照 playbook 14 的分界：系统说的照做，我们推的才只提示。
                 * ⚠ 理由只说事实，不写"你不能装填"那种听着像规则限制的话。
                 * ☐ 待办：pf2e 在 `loaded.max > 1`（弹匣类）时还有一个"全装"按钮
                 *   （`reloadWeapon(id, true)`，一次装 `min(空位, 弹药数)` 发）。
                 *   现在一次只装一发，弹匣武器要点几次 —— 等真有人用弹匣再做。
                 */
                const 空位 = Number((strike as any)?.ammunition?.remaining ?? 0);
                openWheel!.rebuild = undefined;
                void openWheel!.setLevel({
                    title: `${s.label.replace(/ · Reload$/, "")} · Load`,
                    canGoBack: true,
                    paging: 候选.length > PAGE_SIZE ? { page: 0 } : undefined,
                    sectors: 候选.map((c): SectorData => ({
                        // ★ 编码走同一对函数，别在这里手拼（见 ammoSectorId 的注释）
                        id: ammoSectorId(s.id.slice("reload:".length), String(c.id)),
                        // ★ label 直接用系统给的，它自带背包里还有多少（"Arrows (20)"）——
                        //   而"还剩几发"正是选装哪一发时要看的数，不用我们再拼一个
                        label: String(c.label ?? "?"),
                        img: (actor as any).items?.get(c.id)?.img,
                        cost: null,
                        state: 空位 > 0 ? "normal" : "gated",
                        reason: 空位 > 0 ? undefined : "Already loaded.",
                    })),
                });
                return;
            }
            /*
             * 背包里一种兼容弹药都没有 —— 展开一个空层没有意义（空分类一律不画）。
             * ⚠ 但**必须说一句**：上一版这里静悄悄地发一个 Interact 就关盘，
             *   玩家看到的是"点了、弹了个标签、什么也没发生"。
             *   ★ 这句话指得到一个具体字段（`strike.ammunition.compatible` 是空的），
             *     所以它是事实不是猜测（playbook 7.5：指不出字段就别写那句话）。
             * ★★ 措辞**用 pf2e 自己的**（`PF2E.Item.Weapon.Reloader.EmptyMessage` ——
             *   它那个装填弹窗在同一种情况下显示的就是这一句）。
             *   同一件事在轮盘和角色卡上说同一句话，玩家不用学两遍；
             *   而且它跟着系统的翻译走，我们不必自己维护多语言。
             * ⚠ Interact 照发不误：玩家可能本来就是想做别的 Interact，
             *   我们不替他判断"这次装填有没有意义"。
             */
            ui.notifications.info(game.i18n.localize("PF2E.Item.Weapon.Reloader.EmptyMessage"));
            void 装填(actor, strike, null, s.cost, ev);
            return;
        }

        // —— 选定弹药 → 装填 ——
        /*
         * ⛔⛔ **`strikeKey` 自己带一个冒号**（`strikeSectorId` 返回的是
         *   `strike:<itemId>`），所以这个 id 长这样：
         *
         *       ammo:strike:<武器id>:<弹药id>
         *
         *   上一版写的是 `const [, strikeKey, ammoId] = s.id.split(":")` ——
         *   于是 `strikeKey` 拿到 `"strike"`、`ammoId` 拿到**武器自己的 id**。
         *   后果是一串"看起来各自合理"的失败：
         *     `找打击(actor,"strike")` → null → 空位算成 0 → 弹「已经装填了」；
         *     同时按武器 id 去背包里找弹药 → 找不到 → 一发也没装。
         *   ★ Nous 报的「说是填了但是没有真的填，还会说已经装填了」是**同一个 bug 的两端**。
         *   ⚠ 全程不报错：两个分支各自都是合法的 JS，只是拿到的东西不是那个东西。
         *
         * ★ 正解与 `aux:` 那支**同构**（它早就写对了，见上面那段注释）：
         *   **变长的那段放中间，定长的放末尾** —— 先 `pop()` 取末段，再 `join(":")` 还原中段。
         *   ⚠ 前提是弹药 id 里没有冒号（Foundry 的文档 id 是 16 位字母数字）。
         *   ⛔ 以后再往 id 里拼字段，一律照这个形状，别再用固定下标解构。
         */
        if (s.id.startsWith("ammo:")) {
            const 解 = parseAmmoSectorId(s.id);
            if (!解) return;                       // 编解码不成对时**停在这里**，别拿半个 id 往下走
            const { strikeKey, ammoId } = 解;
            const strike = 找打击(actor, strikeKey);
            // ⚠ 这一步的消耗跟着**装填**那一格走，不是这一格 —— 分支只是问，没有额外代价
            const cost = costOfReload(strike);
            void 装填(actor, strike, ammoId, cost, ev);
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
                const 点数 = economy.costToPoints(s.cost);
                if (round !== null) economy.spend(actor.id, round, 点数);
                /*
                 * ★★ **掷骰没发生就不关盘、也不记账**（Nous 2026-08-08）：
                 *   > "尝试用这个没填的开炮会反馈失败，然后关掉 ui（ui 认为行为已经结束了）。"
                 *
                 * ★ 判据是现成的：实读 pf2e 的 `variant.roll()` —— 弹药不够时它
                 *   `ui.notifications.warn(NoAmmo/InsufficientAmmo)` 之后 **`return null`**。
                 *   `rollStrike` 已经把它原样传出来了（见 executor.ts 那句三元），
                 *   ⇒ **null = 这一击根本没打出去**。原来无条件 `.then(() => close())`，
                 *     等于把系统明说的失败当成了"做完了"。
                 * ⚠ 动作点要退：记账在掷骰**之前**（要赶在 pf2e 发消息之前），
                 *   没打出去就得还回去 —— 否则一次失败的点击白吃一个动作，
                 *   而玩家看着毂底的菱形少一个，会以为自己真的打了。
                 * ⚠ 盘**留着**：失败时玩家正要去补救（装填、换武器），
                 *   这跟"准备类动作不关盘"是同一条 —— 关掉等于让他重走一遍呼出。
                 */
                void rollStrike(actor, s.id, map, ev).then((掷了) => {
                    if (掷了) { openWheel?.close(); return; }
                    if (round !== null) economy.refund(actor.id, round, 点数);
                    void openWheel?.refresh();
                });
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

        /*
         * —— 职业层 / 反应层：执行 ——
         *
         * ★ **两层共用同一条执行路径**：反应层里的条目就是别处那些条目，
         *   只是换了个镜头看它们。分两份写必然分叉 ——
         *   编排器分派、反应池扣减、rollItemMacro 都得跟着改两遍，
         *   而漏改的那一份不会报错，只会行为不一样。
         *
         * ⚠ 反应层里的**法术**用的是 `spell:` 前缀（见 collectReactions），
         *   由下面的施法分支接走 —— 施法要扣法术位，那套逻辑只该有一份。
         */
        if (s.id.startsWith("class:") || s.id.startsWith("reaction:")) {
            const itemId = s.id.slice(s.id.indexOf(":") + 1);
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

            /*
             * ★ 我们接管了的动作（乙类）走编排器：它不是"点一下就完了"，
             *   而是"再问你两件事然后按规则跑"。
             *   pf2e 对这些动作**一行代码都没有**（实测连击是零规则元素的纯说明 feat），
             *   点原生的那条只会把说明贴进聊天栏。
             */
            /*
             * ★ 先认 slug 再认**特性**：指挥官那几十条战术共享 `tactic` 特性，
             *   一条宏就覆盖全部（见 macroForItem）。
             */
            const macro = macroForItem({ slug: (item as any).slug, traits: (item as any).system?.traits?.value ?? [] });
            if (macro) {
                const 起始上下文: MacroContext = { picks: [], variantIndex: 0, itemId: item.id };
                const 起步 = levelForStep(actor, macro, 0, 起始上下文);
                if (!起步) {
                    ui.notifications.info("Nothing available to use with that ability right now.");
                    return;
                }
                活跃编排 = { macro, step: 0, ctx: 起始上下文 };
                openWheel!.rebuild = undefined;
                void openWheel!.setLevel(起步);
                return;
            }

            /*
             * 对照表 §6：职业能力走 rollItemMacro（贴出使用卡）。
             *
             * ★ **卡贴完还要真的把 effect 挂上**（Nous 2026-08-07：
             *   "使用本身不会 apply effect，这个 ui 应该做到点击直接 apply effect"）。
             *   系统把这一步做成了卡上的一颗按钮 —— 对角色卡合适，
             *   对轮盘不合适：轮盘的整个卖点就是"点一下就成"。
             * ★ 伤害类型这类选择题**先替他答**：答案取自这回合最后一个法术
             *   （Arcane Cascade 的规则原文就是这么写的），没有就退回武器伤害。
             *   ⚠ 候选是**一个清单不是一条规则**：填得进哪道题由 effect 自己的选项决定，
             *     我们不认识"哪个条目该问什么"（见 self-effect.ts 的 answerChoices）。
             */
            const 候选答案 = [...spellTypesThisTurn(actor.id, round), "weapon-damage"];
            void (game as any).pf2e.rollItemMacro(item.uuid)
                .then(() => applySelfEffect(actor, item, 候选答案))
                .then(() => openWheel?.close());
            return;
        }

        /*
         * —— 选目标那一层里点了某个 token ——
         *
         * ★ 累加/再点取消，然后**就地重画**：`◎` 标记和"选了几个"必须当场更新，
         *   否则玩家只能靠记忆数自己点过谁 —— 而这一层存在的全部理由就是"别搞错"。
         * ⚠ 必须排在别的分支之前：`tgt:` 与其它前缀不冲突，但顺序错了会被兜底那句接走。
         */
        if (s.id.startsWith(TARGET_PREFIX) && s.id !== TARGET_DONE) {
            applyTargetPick(s.id, true);
            void openWheel?.refresh();
            return;
        }

        // —— 选目标层：确认施放 ——
        /*
         * ★★ **确认才跑骰**（Nous 2026-08-08）：代价不对称 ——
         *   多按一次确认花一次点击，点错目标花掉的是一个法术位和一段没法回滚的战斗状态。
         * ★ 零目标也让点：那就是他说的"**跳过此选择**"。三态守则「提示不是锁」——
         *   有些法术本来就不需要目标，或者玩家想先放模板再说，我们不替他拦。
         */
        /*
         * —— 多动作型：玩家点了「投几个动作」——
         *
         * ★ Nous 2026-08-08："多动作型：法术可以重复施法 = 玩家投入的动作数量
         *   → ui 询问需要多少动作，点击数量确定（查 force barrage）"
         * ★ 记下选择，然后**照常往下走**（该选目标的还要选目标）。
         * ⚠⚠ 动作数会改变**伤害掷几次**（Force Barrage 一发一掷）——
         *   而 pf2e 对这条规则**没有任何自动化**（实测 rules 为空、只给一发 1d4+1）。
         *   ⇒ 所以它只在玩家**显式选过**之后才生效，我们绝不替他推断。
         */
        let 投入动作: number | null = null;
        if (s.id.startsWith(ACTS_PREFIX)) {
            const 解 = parseActsSectorId(s.id);
            if (!解) return;
            投入动作 = 解.n;
            s = { ...s, id: 解.spellSectorId, cost: String(解.n) as SectorData["cost"] };
        }

        let 已确认目标 = false;
        if (s.id.startsWith(CAST_PREFIX)) {
            const 回 = spellSectorIdOf(s.id);
            if (!回) return;
            // 换回 `spell:` 那一串，走下面**同一套**施放逻辑，不另写一份
            s = { ...s, id: 回 };
            已确认目标 = true;
            // ⚠ 确认之后这些目标**要留给 pf2e**（算 DC / 命中），所以只撤标志、不清目标
            选目标层 = false;
        }

        // —— 法术层：施放 ——
        if (s.id.startsWith("spell:")) {
            /*
             * id 形如 `spell:<entryId>:<spellId>[:<castRank>:<slotIndex>]`。
             * ⚠ 后两段**可能没有**：反应层里的法术走的是三段那版（见 collectors/reactions.ts），
             *   退化路径也是。所以按位置取，缺了就交给 pf2e 用法术自己的环。
             */
            const [, entryId, spellId, rankStr, slotStr] = s.id.split(":");

            /*
             * ★★ **先问目标，再跑骰**（Nous 2026-08-08）。
             *   判据走 `targetingOf`（只看引擎字段，不解析英文），三种走向：
             *     - `pick` → 开一层选目标，点确认才施放；
             *     - `area` → 范围法术，目标由模板圈定，直接交给 pf2e；
             *     - `none` → 自身法术，没什么可选。
             * ⚠ 只在**还没确认过**时拦（确认格已经把 id 换回来了，不会二次进入）。
             * ⚠ 这一层要能**就地重画**：选中标记和计数靠 rebuild 更新，所以接上 rebuild，
             *   而不是画一次死的。
             */
            const 法术: any = (actor as any).items?.get?.(spellId);

            /*
             * ★★ **先分类，再决定 UI 管不管**（Nous 2026-08-08 的收窄：
             *   "还需要一个默认型：0 → 直接接线 cast，ui 什么都不管
             *    （基本上所有的 spell，我们不管）"）。
             *
             *   ⚠ 这一条纠正的是我做过头的那一版：原来**所有**"有目标+有射程"的法术
             *   （全库 75 条）都会弹选目标层，而绝大多数法术根本不需要轮盘插手 ——
             *   多一层确认对它们纯粹是多一次点击。
             * ★ 分类逻辑在 `castKindOf`（纯函数、可测），这里只按结果分派。
             */
            /*
             * ★★ **用掉的位：不进编排，直接交给 pf2e 拒绝**（Nous 2026-08-08）：
             *   > "这个成了，但是还能点击，问我去选择谁，这个 guard 的位置不对，
             *   >  应该就在这个的 ui 后面（因为 sheet 上就是置灰了的直接没点，说已经用了）"
             *
             *   ⚠ 我原来把闸门放在**流程末端**（走完选目标、确认，再由 pf2e 拒绝）——
             *   于是玩家要先被问一遍"选谁"，选完才被告知这个位早就用掉了。
             *   ★ 角色卡的行为是**点了直接说"已经用了"**，根本不进流程。
             *     两级门在同一件事上，先到的那一级才是玩家感知到的门 ——
             *     门开在后面等于没开。
             * ⚠ 仍然**让点**（提示不是锁）：拒绝那句话由 pf2e 自己说
             *   （"Cannot cast X: slot is already expended."），
             *   我们不复述、也不自己判 —— 复述就成了第二份会分叉的规则。
             */
            const 已用掉 = s.state === "gated";

            const 类型 = castKindOf({
                isAttack: (法术 as any)?.isAttack === true,
                saveStatistic: (法术 as any)?.system?.defense?.save?.statistic ?? null,
                timeValue: (法术 as any)?.system?.time?.value ?? null,
                effectApplyTo: effectApplyOf(法术)?.applyTo ?? null,
                targeting: targetingOf(法术),
            });

            /*
             * —— 多动作型：先问投几个动作 ——
             * ⚠ 排在**所有其它分支之前**：动作数改变法术本身的效果（射几发），
             *   先定它，后面的目标/伤害才有依据。
             */
            const 动作范围 = !已用掉 && 投入动作 === null && 类型 === "multi-action"
                ? actionRangeOf((法术 as any)?.system?.time?.value) : null;
            if (动作范围) {
                openWheel!.rebuild = undefined;
                void openWheel!.setLevel({
                    title: `${String(法术?.name ?? "Spell")} · Actions`,
                    canGoBack: true,
                    sectors: Array.from(
                        { length: 动作范围.max - 动作范围.min + 1 },
                        (_, k): SectorData => {
                            const n = 动作范围.min + k;
                            return {
                                id: actsSectorId(n, s.id),
                                // 环上只放数字，句子在毂里（一格宽放不下一句话）
                                label: "◆".repeat(n),
                                hubLabel: n === 1 ? "1 action" : `${n} actions`,
                                cost: String(n) as SectorData["cost"],
                                state: "normal",
                                tone: "confirm",
                                hubNotes: [`Spend ${n} — ${n} shard${n > 1 ? "s" : ""}`],
                            };
                        }),
                });
                return;
            }

            /*
             * —— 范围贴 buff：放范围 → 过目 → 确认 → 批量贴（Nous 2026-08-08）——
             *
             * ★ 只走**登记过**的那几条（`SPELL_EFFECT_APPLY`）。为什么必须登记：
             *   扫遍 1993 个法术都找不出"该贴友军还是敌军"的结构化判据
             *   （详见 area-buff.ts 顶部那张表）。没登记的一律走 pf2e 原路。
             * ★ 挑人分两条（`areaPickMode`）：有网格按半径**替他预选**，
             *   无网格**全列出来让他自己点** —— 无网格下距离不可信，
             *   给一份看起来正常的错名单比让他多点几下坏得多。
             * ⚠ 一律要**确认**才贴：他的原话是"这种批量覆盖肯定会出错"。
             */
            const 范围buff = (已用掉 || 已确认目标 || 类型 !== "area-buff") ? null : areaBuffOf(法术);
            if (范围buff) {
                const 区 = 法术?.system?.area ?? null;
                const 有网格 = Number((canvas as any)?.scene?.grid?.type ?? 0) > 0;
                const 模式 = areaPickMode(区, 有网格);
                const 半径 = Number(区?.value ?? 0);
                const 我: any = ((canvas as any)?.tokens?.placeables ?? [])
                    .find((t: any) => t?.actor?.id === (actor as any).id);

                // ★ 预选：只在算得准时做。清空是必要的（同下面选目标那条，理由一样）
                (game as any).user?.updateTokenTargets?.([]);
                if (模式 === "auto" && 我?.distanceTo) {
                    const 中: any[] = ((canvas as any)?.tokens?.placeables ?? []).filter((t: any) => {
                        if (!t?.actor || t.isVisible === false) return false;
                        // ⚠ 自己只在增益类里算目标（"you and allies"）；减益类要排掉
                        const 是我 = t.actor.id === (actor as any).id;
                        if (是我 && 范围buff.side !== "allies") return false;
                        const 敌 = (actor as any)?.isEnemyOf?.(t.actor) === true;
                        if (!是我 && (范围buff.side === "allies" ? 敌 : !敌)) return false;
                        return Math.round(我.distanceTo(t)) <= 半径;
                    });
                    for (const t of 中) t.setTarget(true, { releaseOthers: false });
                }

                const 侧 = 范围buff.side === "allies" ? "allies" : "enemies";
                const 建范围层 = (): WheelLevel => ({
                    title: `${String(法术?.name ?? "Spell")} · ${区?.label ?? "Area"}`,
                    canGoBack: true,
                    sectors: [
                        /*
                         * ★ 增益类**把自己也列进来**：Bless / Anthem 的目标原文是
                         *   "you and allies"，而预选按距离算时自己恒为 0 ft、必然入选 ——
                         *   名单里不列自己就会出现"界面上看不到、却真被贴上效果"的人。
                         * ⚠ 减益类不列自己：Bane 是 "enemies in the area"，自己不该在内。
                         */
                        ...targetOptions(actor, 侧 as never, true, 范围buff.side === "allies"),
                        {
                            id: castSectorId(s.id),
                            // ⚠ 扇区上只放**一个记号**，句子在毂里（见下面 hubLabel）
                            label: "↵",
                            hubLabel: "Apply to selected",
                            cost: s.cost,
                            state: "normal",
                            tone: "confirm",
                            hubNotes: [
                                `${targetCount()} will get the effect`,
                                模式 === "auto"
                                    ? `Auto-picked within ${半径} ft`
                                    : "No grid — pick them yourself",
                            ],
                        },
                    ],
                });
                选目标层 = true;
                openWheel!.rebuild = 建范围层;
                void openWheel!.setLevel(建范围层());
                return;
            }

            /*
             * ★ 只有**认得出的类型**才开选目标层：
             *   `attack`（要掷命中）/ `save`（要让目标掷豁免）/ `effect`（要贴给谁）。
             *   ⛔ `default` 一律直接施放 —— UI 什么都不管，那是绝大多数法术。
             */
            const 要选目标 = !已用掉
                && (类型 === "attack" || 类型 === "save" || 类型 === "effect");
            if (!已确认目标 && 要选目标 && targetingOf(法术) === "pick") {
                /*
                 * ★★ **进这一层先把已选目标清空**（Nous 2026-08-08：
                 *   "清空选择这是必要的，如果错了的后果会很大"）。
                 *
                 * ★ 我原来的想法是"不清空，只是强制过一次确认" —— 被否了，而他是对的：
                 *   沿用旧选择时，**默认值本身就是个陷阱**。玩家上一发法术选的目标还挂着，
                 *   这一层一打开就已经"看起来选好了"，确认那一下于是变成盖章而不是判断。
                 *   ⇒ 代价不对称：清空最多让他多点一次；沿用错的会烧掉一个法术位，
                 *     而那要休息才回得来（UI playbook 〇·六：沉的东西宁可笨拙）。
                 * ⚠ 清的是**我们这一步的输入**，不是画布状态的破坏 ——
                 *   玩家紧接着就在同一层里重新点，不存在"清了却没法选回来"。
                 */
                (game as any).user?.updateTokenTargets?.([]);

                /*
                 * ★ 目标上限（Nous 2026-08-08："我现在可以随便选，然而这个法术只能选择最大 2 个"）。
                 *   取自目标文本里最大的那个数（`1 or 2 creatures` → 2），
                 *   **取不到就不限制** —— 见 spell-cast.ts 里那三条兜底。
                 * ⚠ 是**提示不是锁**（playbook 13）：超了照旧能点，只是把话说明白。
                 *   规则里有太多"每提升 2 环多 1 个目标"，写死上限迟早拦掉合法操作。
                 */
                const 上限 = maxTargetsOf((法术 as any)?.system?.target?.value);
                const 建目标层 = (): WheelLevel => ({
                    title: `${String(法术?.name ?? "Spell")} · Target`,
                    canGoBack: true,
                    sectors: [
                        ...targetOptions(actor, "any", false),
                        {
                            /*
                             * ⛔ **扇区上一个记号，句子在毂里**（Nous 2026-08-08 实机截图：
                             *   "Cast without target" 横着冲出轮盘）。
                             *   病因是我给这一格设了 `tone: "link"` —— 而
                             *   `.pauih-label.tone-link` 的字号是 **20.5px**，
                             *   那是为**画一个 `+` 号**定的（"边盘上面就只放一个蓝色的加号，
                             *   本来就没地方放"）。我拿它去写一句 19 个字符的话。
                             * ★ 一格宽 46.6 单位：8.5px 的常规标签也只放得下 ~11 个字符，
                             *   所以句子**本来就不该上扇区** —— 用 `hubLabel` 放毂里。
                             */
                            id: castSectorId(s.id),
                            label: "↵",
                            hubLabel: targetCount() > 0 ? "Cast at selected" : "Cast without target",
                            cost: s.cost,
                            // ★ 超过上限只**变色提示**，照旧可点（提示不是锁）
                            state: 上限 !== null && targetCount() > 上限 ? "risky" : "normal",
                            tone: "confirm",
                            hubNotes: [
                                上限 !== null
                                    ? `${targetCount()} / ${上限} targets`
                                    : (targetCount() === 1 ? "1 target selected"
                                                           : `${targetCount()} targets selected`),
                                上限 !== null && targetCount() > 上限
                                    ? `⚠ This spell targets up to ${上限}`
                                    : "",
                            ].filter(Boolean),
                        },
                    ],
                });
                选目标层 = true;
                openWheel!.rebuild = 建目标层;
                void openWheel!.setLevel(建目标层());
                return;
            }
            const rank = Number(rankStr);
            const slot = Number(slotStr);
            const round = currentRound(actor);
            if (round !== null) {
                if (s.cost === "reaction") economy.spendReaction(actor.id, round);
                else economy.spend(actor.id, round, economy.costToPoints(s.cost));
            }
            /*
             * ★★ **贴 effect 在施放之后**（Nous 2026-08-08 的最后一步）：
             *   先让 pf2e 把法术正常放出去（扣位、发卡、跑它自己的规则），
             *   再把效果挂到刚才确认过的那几个人身上。
             * ⚠ 顺序不能反：贴在前的话，法术万一被 pf2e 拦下（位不够、条件不满足），
             *   buff 已经挂上去了 —— 那是**没花代价却拿到了收益**，比不贴糟得多。
             * ⚠ 目标取**当下**的 `game.user.targets`，不缓存确认那一刻的名单：
             *   两者之间玩家可能又调整过，以画布上的实际选择为准。
             */
            /*
             * ⚠ 单体增益（Haste / Heroism）也要贴 —— 这一支原来是**断的**：
             *   目标选完、法术放出去了，`Spell Effect: Haste` 却从来没挂上，
             *   玩家还得自己去纲要里拖一次。而且**不报错**，法术卡照常发，看着像成了。
             * ★ 所以这里用 `effectApplyOf`（范围 + 单体都收），不是只收范围那个。
             *   目标一律取当下的 `game.user.targets` —— 范围那条预选过、单体那条玩家点过，
             *   到这一步两者的输入形状是一样的。
             */
            /*
             * ⚠ `self` 这一类**不经过确认层**（它的 `targetingOf` 是 `none`，没有目标可选），
             *   所以判据不能只看 `已确认目标` —— 那样 Sure Strike 永远贴不上。
             */
            const 待贴 = (() => {
                const r = effectApplyOf(法术);
                if (!r) return null;
                if (r.applyTo === "self") return r;      // 自身法术：直接挂
                return 已确认目标 ? r : null;             // 其余必须过确认那一步
            })();
            void castSpell(actor, entryId, spellId,
                           Number.isFinite(rank) ? rank : undefined,
                           Number.isFinite(slot) ? slot : undefined)
                .then(async () => {
                    /*
                     * —— 施法编排：豁免 → 伤害 → 效果，**每条消息之间隔开** ——
                     *
                     * ★ Nous 2026-08-08：
                     *   > "被选择的对象不会自动去摇色子 save DC21 basic reflex，
                     *   >  然后也不会自动去摇色子算伤害，（而且和 spell strike 那个一样，
                     *   >  所有的 chatlog 会一并蹦出，最好是每一条间隔 2s）"
                     *
                     * ★ 步骤序列由 `planCast` 排（纯逻辑、可测），这里只负责执行 ——
                     *   顺序与节奏的规则写在那边，别在这个回调里再写一份。
                     */
                    const 目标们 = [...((game as any).user?.targets ?? [])];
                    const 有豁免 = !!(法术 as any)?.system?.defense?.save?.statistic;
                    // ★ 攻击型走 pf2e 算好的 `isAttack`，不看 traits 里有没有 "attack"
                    const 是攻击 = (法术 as any)?.isAttack === true;
                    const 有伤害 = await spellHasDamage(法术);
                    const 计划 = planCast({
                        targetCount: 目标们.length,
                        hasSave: 有豁免,
                        isAttack: 是攻击,
                        hasDamage: 有伤害,
                        // ★ 只有玩家显式选过动作数才多掷（见 CastPlanInput.damageCount）
                        damageCount: 投入动作 ?? 1,
                        hasEffect: !!待贴,
                    });

                    for (let i = 0; i < 计划.length; i++) {
                        const 步 = 计划[i];
                        // ⚠ 间隔由 `gapBefore` 算：不发消息的步骤不白等
                        const 等 = gapBefore(计划, i);
                        if (等 > 0) await new Promise(r => setTimeout(r, 等));
                        if (步.kind === "cast") continue;            // 上面那句 castSpell 就是它
                        if (步.kind === "save") {
                            const t = 目标们[步.targetIndex ?? 0];
                            if (t) await rollSpellSave((t as any)?.actor ?? t, 法术, actor);
                        } else if (步.kind === "attack") {
                            /*
                             * ⚠ 命中是**我**掷的，所以不用逐个换目标 —— pf2e 从
                             *   `game.user.targets` 自己取当前目标。多目标时每个各掷一次，
                             *   这里靠 `planCast` 排出的步数控制次数。
                             */
                            await rollSpellAttack(法术, ev);
                        } else if (步.kind === "damage") {
                            await rollSpellDamage(法术, ev);
                        } else if (步.kind === "effect" && 待贴) {
                            // ★ `self` 贴给施法者本人；其余贴给当下选中的那些
                            const 收 = 待贴.applyTo === "self" ? [actor] : 目标们;
                            const r = await applyEffectTo(收, 待贴.effectUuid, { actor });
                            // ★ 报数：批量操作**必须说清到底动了几个**
                            //   （跳过的多半本来就挂着同名 effect，见 applyEffectTo）
                            if (r.total) {
                                ui.notifications.info(
                                    `${String(法术?.name ?? "Spell")}: applied to ${r.ok}/${r.total}.`);
                            }
                        }
                    }
                })
                .then(() => openWheel?.close());
            return;
        }

        ui.notifications.info(`"${s.label}" is not implemented yet.`);
    });
    openWheel.economy = () => {
        const round = currentRound(actor);
        if (round === null) return null;
        // ★ 动作数按**当前状态**算：缓慢/震慑扣、迅捷加（2026-08-05 alpha 反馈）。
        //   压制关系由 pf2e 解析好了，我们只读 conditions.active（见 turnConditions）。
        const cond = turnConditions(actor);
        return {
            remaining: economy.remaining(actor.id, round, cond),
            total: economy.actionsThisTurn(cond),
            notes: cond.notes,
            canUndo: economy.canUndo(actor.id, round),
            reactionsLeft: economy.reactionsLeft(actor.id, round),
        };
    };
    openWheel.classState = () => classStateLines(readClassState(actor));
    /*
     * ★ 关盘时收拾盘外状态。**三条关盘的路都汇到这里**（Esc / 返回退到底 / 执行完自动关）——
     *   挂在各个调用点上迟早漏一条，而漏掉的那条会把选中的目标留在画布上，
     *   且那时已经没有取消它们的入口了。
     */
    openWheel.onClosed = () => 清掉预选目标();
    /*
     * 点毂里那几行说明 → 开游戏自己的说明窗。
     * ⚠ 走 `fromUuid`（异步）—— 纲要条目 `fromUuidSync` 只给索引，没有 sheet。
     * ⚠ **不关盘**：看完说明多半还要接着点那一格。
     */
    /*
     * 点毂里那个名字 → **把完整说明发到聊天栏**（Nous 2026-08-08：
     * "第二变成在 chat 里面打开"）。
     *
     * ★ 比开条目面板好在两处：说明**留在那儿**（不用一边看一边操作），
     *   而且同桌的人也看得到 —— GM 说"这个技能干嘛的"时正好用。
     * ⚠ 拥有者的条目走 `toMessage()`（系统自己那张卡）；
     *   纲要里的条目**没有 actor，`toMessage` 会抛**（2026-08-07 已经踩过一次），
     *   退回 `@Embed` 渲染同一份原文。
     */
    openWheel.onInfo = (uuid: string) => {
        void (async () => {
            try {
                const doc: any = await (globalThis as any).fromUuid(uuid);
                if (doc?.actor && typeof doc.toMessage === "function") { await doc.toMessage(); return; }
                const TE: any = (foundry as any).applications.ux.TextEditor.implementation
                             ?? (foundry as any).applications.ux.TextEditor;
                await ChatMessage.create({
                    content: await TE.enrichHTML(`@Embed[${uuid}]`),
                    speaker: ChatMessage.getSpeaker({ actor: actor as any }),
                });
            } catch (err) {
                console.error("player-action-ui-hub | 发说明到聊天栏失败", err);
            }
        })();
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
    /*
     * G10 的开关。**默认开**（Nous 要的就是"弹窗 ui 询问玩家"），
     * 但它会打断别人的回合，所以必须给得掉 —— 会主动弹出来的东西一律要有开关。
     */
    game.settings.register(MODULE_ID, REACTION_PROMPT_SETTING, {
        name: "Offer reactions when something happens",
        hint: "When a roll in chat matches one of your reactions' trigger text, pop the wheel with just those reactions. It never judges distance or line of sight — you do.",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
    });

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

    /*
     * 通用动作 slug → 纲要 uuid 的对照表，取一次缓存起来（见 action-uuids.ts）。
     * ⚠ 不 await：取不到只是"说明不可点"，不该拖住整个 ready。
     */
    void primeActionUuids();

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
        /**
         * 给游戏内冒烟测试用的纯函数出口。
         *
         * ⚠ 暴露的是**真实执行路径上的那几个**，不是给测试另写一份 ——
         *   另写一份就是又造一个会腐坏的副本，测的还是副本不是产品。
         */
        _test: { auraPlanFor, buildAuraEffect, savePlanFor, sceneHasGrid, resolveAreaAfterCast,
                 macroFor, levelForStep, unarmedStrikes,
                 readClassState, classStateLines,
                 collectStrikeAuxiliaries, collectClassAbilities, className, collectActions,
                 triggerOf, requirementOf, targetOptions, applyTargetPick, TARGET_DONE, macroForItem,
                 collectReactions, collectBodies,
                 readAttack, nextMapIndex, attacksThisTurn: economy.attacksThisTurn,
                 noteAttack: economy.noteAttack,
                 collectConditions, restrictionFor, restrictionStateOf,
                 提示反应, classify, matchReactions,
                 primeSheetActions, sheetActionsOf, resourceLines,
                 primeSpellGroups, spellGroupsOf, slotMatrix, collectSpells },
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
            /*
             * ⚠ 角色数据一变，卡上那份清单就旧了 —— **先清缓存再刷新**。
             *   不清的话拔完刀重画出来的还是"未拔出"那一版，而且不报错。
             */
            clearSheetActions();
            clearSpellGroups();
            clearStrikeDamage();
            if (!openWheel?.rendered || !openWheelActor) return;
            // updateActor 给的就是 Actor；物品钩子给的是 Item，从它身上找宿主
            const changed = doc?.documentName === "Actor" ? doc : (doc?.actor ?? doc?.parent);
            if (!changed?.id || changed.id !== openWheelActor.id) return;   // 别人的角色变了不关我们的事
            /*
             * ⚠ 法术分组是**异步**取回来的，刚被上面那行清掉了 ——
             *   不先重取就直接重画，法术层会掉进"拿不到分组"的退化路径，
             *   一页一环当场变回一刀切九个。**清了必须补上**。
             */
            void Promise.all([primeSpellGroups(openWheelActor), primeStrikeDamage(openWheelActor)])
                .then(() => openWheel?.refresh());
        });
    }

    /*
     * —— G9 · 数攻击掷骰，据此定 MAP 档位 ——
     *
     * ★ 挂在**聊天消息**上，不挂在我们自己掷骰那一处：
     *   挂在掷骰处只数得到从轮盘打出去的那些，玩家从角色卡点一下就漏 ——
     *   于是轮盘显示的 MAP 变成**一个看起来正确的错数**，比不显示更糟。
     *
     * ⚠ 战斗外不数：没有"回合"这回事，MAP 也就无处归属
     *   （与动作经济同一条边界，`currentRound` 返回 null）。
     */
    /*
     * —— 记下这回合最后施放的法术是什么伤害类型 ——
     *
     * ★ 挂在**聊天消息**上，与数攻击同一个理由：从角色卡施的法也要数得到。
     *   只从我们自己的施法路径记，玩家在卡上点一下我们就漏 ——
     *   而漏掉的后果是 Arcane Cascade 预填了一个**上一次**的伤害类型，
     *   看着像"填对了"，其实是旧的。
     * ⚠ 战斗外不记：规则限定"同一个回合"，没有回合就没有这回事。
     */
    Hooks.on("createChatMessage", (message: unknown) => {
        try {
            const origin = (message as any)?.flags?.pf2e?.origin;
            if (origin?.type !== "spell" || typeof origin?.uuid !== "string") return;
            const spell = (globalThis as any).fromUuidSync?.(origin.uuid);
            const actorId = (message as any)?.speaker?.actor;
            const round = currentRound(((game as any).actors?.get(actorId)) ?? null);
            if (!actorId || round === null) return;
            noteSpell(String(actorId), round, damageTypesOf(spell));
        } catch (err) {
            console.error("player-action-ui-hub | 记法术伤害类型失败", err);
        }
    });

    Hooks.on("createChatMessage", (message: unknown) => {
        const 观测 = readAttack(message);
        if (!观测) return;
        const actor = (game as any).actors?.get(观测.actorId);
        const round = currentRound(actor ?? null);
        if (round === null) return;
        economy.noteAttack(观测.actorId, round);
        // 盘开着且正是这个角色 → 让翻选条跟着跳到新档位
        if (openWheel?.rendered && openWheelActor?.id === 观测.actorId) void openWheel.refresh();
    });

    /*
     * —— 回合开始：动作点与 MAP 一起清零 ——
     *
     * ★★ **规则是"你自己的回合开始时重置"，不是"换一轮时"**。
     *   原来只靠账本发现 `round` 变了才清 —— 先手的角色差不多对得上，
     *   后手的角色会把上一轮末尾的攻击带进自己的新回合，
     *   于是**第一击就被算成第二击**。它不报错，只是数字偏一档。
     *
     * ★ 实测 pf2e **完全没有 MAP 自动化**：`calculateMAPs` 只返回 `{map1:-5, map2:-10}`
     *   这三个选项，全系统搜不到任何"本回合打了几次"的计数
     *   （`attacksThisTurn|attackCount|timesAttacked|priorAttacks` 零命中）。
     *   所以这件事只有我们在记，那就得记对时点。
     *
     * ⚠ 实测钩子签名是 `(combatant, encounter, userId)` —— 第一个参数是**战斗员**不是 actor。
     */
    Hooks.on("pf2e.startTurn", (combatant: any, encounter: any) => {
        const actorId = combatant?.actor?.id;
        const round = Number(encounter?.round ?? game.combat?.round);
        if (!actorId || !Number.isFinite(round)) return;
        economy.resetTurn(actorId, round);
        if (openWheel?.rendered && openWheelActor?.id === actorId) void openWheel.refresh();
    });

    /*
     * —— 换选令牌 → 轮盘跟着换人（Nous 2026-08-08）——
     *
     * ★ 这条是**盘常驻之后才成立的**：以前点画布就把盘关了，跟不跟根本无从谈起。
     *   > "这个功能在玩家上没什么用，但是在 gm 手上效果就大很多了。"
     *   GM 一个人要开十几个怪，逐个"关盘 → 选令牌 → 再呼出"是纯机械劳动。
     *
     * ★★ **挂 `controlToken` 而不是别的**（Nous 提醒后查证的分界）：
     *   Foundry 里「控制」与「选中/指定目标」是两件事 ——
     *   - **控制**（左键）：只有你拥有的令牌才控制得了，GM 才能控制全部；
     *   - **指定目标**（右键 / T）：谁都能对任何令牌做，**不放 `controlToken`**。
     *   玩家施法要点别人当目标，走的是后者 —— 所以这个钩子**碰不到**那条路，
     *   盘不会因为"我选了队友当目标"就换人。
     *   ⚠ 换成 `targetToken` 或画布点击就正好踩中它，那才是玩家侧的灾难。
     *
     * ⚠ 权限不用我们判：控制得了就说明有权限，这是引擎给的事实。
     * ⚠ 换人 = **重开分类层**（走 openAt），不是就地改 actor ——
     *   点击回调里捕获的是旧 actor，就地改会留下一个指着旧身体的回调（G8 那条老坑）。
     */
    Hooks.on("controlToken", (token: any, controlled: boolean) => {
        if (!controlled || !openWheel?.rendered) return;
        const 新 = token?.actor;
        if (!新?.id || 新.id === openWheelActor?.id) return;
        openAt(lastOpen.x, lastOpen.y, 新);
    });

    /*
     * 战斗开始/结束时把账全清。
     * ⚠ 账本不再按轮自动清（见 economy.ts 的 ledgerFor），所以**必须**有这一处，
     *   否则上一场战斗的攻击数会跟着角色带进下一场。
     */
    for (const h of ["combatStart", "deleteCombat"]) {
        // ⚠ 法术记录与账本同生同灭：只清一个，另一个会把上一场的答案带进新战斗
        Hooks.on(h, () => { economy.clearAll(); clearSpells(); });
    }

    /*
     * —— G10 · 反应窗口提示 ——
     *
     * ★ 我们**只观测事件、只摆选项**：把触发词对得上的反应弹出来问一句。
     *   距离、光环、视线一概不判 —— 那是规则，归玩家（见 reaction-watch.ts 顶部）。
     */
    Hooks.on("createChatMessage", (message: unknown) => {
        try { 提示反应(message); } catch (err) {
            console.error("player-action-ui-hub | 反应提示失败", err);
        }
    });
});

/**
 * 一条聊天消息进来 → 该不该弹反应。
 *
 * ⚠ 四道闸，每一道都是为了**不打断玩家**，而不是为了"合规则"：
 *   ① 开关关了；② 盘已经开着（弹出去会顶掉他正在做的事）；
 *   ③ 找不到"我"；④ 本轮反应已经用掉了。
 *   ⛔ 第④条**只压制提示，不压制能力** —— 反应分类那一格永远在。
 */
function 提示反应(message: unknown): void {
    if (!game.settings.get(MODULE_ID, REACTION_PROMPT_SETTING)) return;
    if (openWheel?.rendered) return;

    const me = resolveActor();
    if (!me) return;

    const ctx = (message as any)?.flags?.pf2e?.context;
    if (!ctx) return;

    /*
     * ⚠⚠ `context.target.actor` 是 **uuid**（实测 `Scene.x.Token.y.Actor.z`），不是裸 id；
     *   而且**未关联令牌**的 actor 是合成的，`game.actors.get()` 根本查不到它。
     *   两个坑都**不报错**，表现都是"反应提示从来不弹"——看着像功能没做。
     *   所以这里一次性解析成 actor **文档**，后面全用文档，不再拿 id 去查表。
     */
    const 目标 = 解析目标(ctx.target);
    const facts: MessageFacts = {
        type: ctx.type ?? null,
        rollerId: ctx.actor ?? (message as any)?.speaker?.actor ?? null,
        targetId: (目标 as any)?.id ?? null,
        outcome: ctx.outcome ?? null,
    };

    // 敌我只对"这一条消息的目标"回答得了 —— classify 也只会问它
    const 敌我 = (actorId: string): boolean =>
        !!目标 && actorId === (目标 as any).id && (me as any).isEnemyOf?.(目标) !== true;

    const kinds = classify(facts, { meId: (me as any).id, isAlly: 敌我 });
    if (!kinds.length) return;

    // ④ 本轮反应用完了就不打扰（只影响提示，不影响他自己去点）
    const round = currentRound(me);
    if (round !== null && economy.reactionsLeft((me as any).id, round) <= 0) return;

    /*
     * 候选取自**反应分类那一份采集**（不另写一套）：它已经把触发条件解析好了，
     * 匹配直接对着 `detail` 做。两份采集必然分叉 —— 职业层当年就是这么错的。
     */
    const 候选 = matchReactions(
        collectReactions(me).map(s => ({ ...s, trigger: s.detail ?? null })),
        kinds,
    );
    if (!候选.length) return;

    // 先按常规呼出（这一步把点击回调接到 me 身上），再换成只有候选的那一层
    openAt(lastMouse.x, lastMouse.y);
    if (!openWheel) return;
    openWheel.rebuild = undefined;
    void openWheel.setLevel({
        title: "Reaction?",
        canGoBack: true,
        paging: 候选.length > PAGE_SIZE ? { page: 0 } : undefined,
        sectors: 候选.map(({ trigger, ...s }) => s),
    });
}

/**
 * 把 `context.target` 解析成 actor 文档。
 *
 * ⚠ 实测那里放的是 uuid：`{ actor: "Scene.x.Token.y.Actor.z", token: "Scene.x.Token.y" }`。
 *   拿字符串直接和 `actor.id` 比永远不相等；按最后一段截也不对 ——
 *   未关联令牌的合成 actor 不在 `game.actors` 里，查表会得到 undefined。
 *   `fromUuidSync` 两种情况都吃得下，所以只走它。
 */
function 解析目标(target: unknown): unknown {
    const t = target as any;
    const uuid = t?.actor ?? t?.token ?? null;
    if (typeof uuid !== "string" || !uuid) return null;
    try {
        const doc = (globalThis as any).fromUuidSync?.(uuid);
        // token uuid 解出来是 TokenDocument，actor 挂在它下面
        return doc?.actor ?? doc ?? null;
    } catch { return null; }
}
