import type { ActorPF2e } from "foundry-pf2e";
import { strikeSectorId, strikesOf, type WheelStrike } from "./collectors/strikes";
import { applySelfEffectAfterCast } from "./effects";
import { resolveAreaAfterCast } from "./area-effects";

/**
 * 按扇区 id 回查 strike 对象。
 *
 * ⚠ 必须**先过滤出 strike 再取下标**，与 collector 的 `.filter().map()` 顺序一致；
 *   直接在 system.actions 上枚举会让退化分支的下标对不上。
 *   ——所以直接复用 collector 的 `strikesOf`，两边永远是同一份过滤。
 */
function findStrike(actor: ActorPF2e | null | undefined, strikeId: string): WheelStrike | null {
    return strikesOf(actor).find((s, i) => strikeSectorId(s, i) === strikeId) ?? null;
}

/**
 * 把玩家在轮盘上的这一次点击，翻译成 pf2e 掷骰要的"意图事件"。
 *
 * 为什么不直接把原始点击事件递过去（源码实读 2026-08-05）：
 *
 * 1. **Ctrl 是我们的呼出键，但 pf2e 拿它当"暗骰"开关。**
 *    `sheet/helpers.ts:145` —— `if (event.ctrlKey || event.metaKey) messageMode = "gm"|"blind"`。
 *    玩家 Ctrl+点呼出轮盘后不松手直接点扇区，**每一次攻击都会变成暗骰**，
 *    而且不报错、无提示。必须把 ctrl/meta 抹掉。
 * 2. **默认要跳过加值确认框。** 轮盘存在的意义就是省掉多余那一步
 *    （§0 根理：把负担从人脑挪走）；确认框里的加值本来就由 pf2e 自动算好，
 *    诸如鼓舞类光环 buff 无论开不开框都已经在加值栈里。
 * 3. **仍要留给玩家反悔的口子**：按住 Shift 点 → 照常弹框，可临时加环境加值。
 *    这沿用 pf2e 自己"Shift 反转"的既有习惯，不另发明。
 *
 * 实现上造一个真的 `PointerEvent`：`isRelevantEvent`（helpers.ts:135）只鸭子类型地检查
 * 有没有 ctrlKey/metaKey/shiftKey 三个键，但用真事件最稳。
 *
 * ★ 2026-08-05（Task 9）由 `MouseEvent` 改成 `PointerEvent`：pf2e 的 `RollParameters.event`
 *   标的就是 `PointerEvent`（`system/rolls.ts` / 类型包 `system/rolls.d.ts:21`），
 *   而 `MouseEvent` 是它的父类、不可赋值。原来靠 globals 全 any 才没被发现。
 *   `PointerEvent` 是 `MouseEvent` 的子类，鸭子检查照样通过，运行时行为不变。
 *
 * ⚠ 掩护不受影响：Toolbelt 的 auto-cover 读的是检定上下文里的 `context.target`
 *   （其 tool.ts:307），来源是 `game.user.targets`，与事件对象无关。
 */
/**
 * @param kind 这一次是**检定**还是**伤害** —— pf2e 用**两个不同的开关**
 *   （实读 `eventToRollParams`：`type === "check" ? showCheckDialogs : showDamageDialogs`）。
 *
 * ⚠⚠ 2026-08-08 之前这里写死了 `showCheckDialogs`，于是**伤害那一路反解错了开关** ——
 *   两个设置值一样时看不出来，一旦不同就会在该跳过时弹窗、或该弹窗时跳过。
 *   ★ Nous 实机撞到的是"伤害骰没自动，反而弹出了窗口"（截图里那个 Damage Roll 对话框）。
 */
function intentEvent(realEvent: Event | null, kind: "check" | "damage" = "check"): PointerEvent {
    const skipDefault = !game.user?.settings?.[
        kind === "check" ? "showCheckDialogs" : "showDamageDialogs"];
    const userWantsDialog = !!(realEvent as MouseEvent | null)?.shiftKey;
    // skipDialog = shiftKey ? !skipDefault : skipDefault（helpers.ts:144）
    // 我们要的：默认 skipDialog=true；按住 Shift 则 false。反解出 shiftKey：
    const shiftKey = userWantsDialog ? skipDefault : !skipDefault;
    return new PointerEvent("click", { shiftKey, ctrlKey: false, metaKey: false });
}

/**
 * 执行一次打击。`map` 为 0/1/2，对应第 1/2/3 击。
 * 只调 pf2e 系统自己的函数，规则计算一概不自己做。
 */
export async function rollStrike(
    actor: ActorPF2e | null,
    strikeId: string,
    map: number,
    event: Event,
): Promise<{ degreeOfSuccess?: number } | null> {
    try {
        const strike = findStrike(actor, strikeId);
        if (!strike) {
            ui.notifications.warn("That strike is no longer available — reopen the wheel.");
            return null;
        }
        const variant = strike.variants?.[map];
        if (!variant) {
            ui.notifications.warn("That strike has no such attack in the sequence.");
            return null;
        }
        // 传的是"意图事件"而非原始点击，理由见 intentEvent 的注释：
        // 默认跳过加值框、且不让呼出用的 Ctrl 把这一击变成暗骰。
        //
        // ★ **把结果返回出去**（2026-08-05 为 Spellstrike 加的）：
        //   编排器要用这一次掷骰的成功度去决定法术怎么结算 ——
        //   规则原文是"用打击的结果同时决定打击和法术"，所以那个值必须传得出来。
        // ⚠ 实测：**选了目标才有 `degreeOfSuccess`**，没目标时是 null
        //   （没有目标就没有 DC，也就无从判成功度）。调用方要处理 null，别当成"失败"。
        // ⚠ 它的返回类型是 `string | Rolled<CheckRoll> | null` —— **字符串那支是取公式用的**，
        //   不是掷骰结果。不收紧的话 `.degreeOfSuccess` 会安静地读到 undefined。
        const rolled = await variant.roll({ event: intentEvent(event) });
        return rolled && typeof rolled === "object" ? rolled as { degreeOfSuccess?: number } : null;
    } catch (err) {
        console.error("player-action-ui-hub | rollStrike 失败", err);
        ui.notifications.error("The roll failed — see the console for details.");
        return null;
    }
}

/**
 * 掷这一击的**武器伤害**。
 *
 * ★★ Spellstrike 少的就是这一半（Nous 2026-08-07 测出来："唯独是缺少了
 *   打击本身是有伤害的，如果打击成功之后这次的打击是算伤害的"）。
 *   规则上 Spellstrike 是**一次打击**：命中就照常算武器伤害，法术伤害是**另加**的。
 *   我们原来只掷了法术那一份 —— 玩家得自己回角色卡上再点一次伤害。
 *
 * ⚠ 暴击走 `critical()`，命中走 `damage()` —— pf2e 的打击**分开提供**这两个，
 *   不像法术卡只有一个伤害按钮。有就用，不要自己去翻倍。
 * ⚠ 同样要传"意图事件"：不传的话会弹伤害加值框（与掷攻击那处同一个坑）。
 */
export async function rollStrikeDamage(
    actor: ActorPF2e | null,
    strikeId: string,
    map: number,
    event: Event,
    critical: boolean,
): Promise<boolean> {
    try {
        const strike = findStrike(actor, strikeId);
        if (!strike) return false;
        const 打 = strike as any;
        const fn = critical ? (打.critical ?? 打.damage) : 打.damage;
        if (typeof fn !== "function") return false;
        // ⚠ 这里的签名**确实是对象**（与法术的 `rollDamage` 不同，见那边的注释）；
        //   但开关同样要用 `damage` 那个 —— 原来写死 check，两个设置不一致时就会弹窗。
        await fn.call(打, { event: intentEvent(event, "damage"), mapIncreases: map });
        return true;
    } catch (err) {
        console.error("player-action-ui-hub | rollStrikeDamage 失败", err);
        return false;
    }
}

/**
 * 执行武器辅助动作（拔出/收起/换手）。
 * `auxIndex` 取 0 即"第一个辅助动作"——未拔出时实测只有 "Draw (1H)" 这一个
 * （findings-v0.1 §2）。
 */
export async function execAuxiliary(
    actor: ActorPF2e | null,
    strikeId: string,
    auxIndex: number,
): Promise<void> {
    try {
        const strike = findStrike(actor, strikeId);
        const aux = strike?.auxiliaryActions?.[auxIndex];
        if (!aux) {
            ui.notifications.warn("This weapon has no such action.");
            return;
        }
        await aux.execute();
    } catch (err) {
        console.error("player-action-ui-hub | execAuxiliary 失败", err);
        ui.notifications.error("The action failed — see the console for details.");
    }
}

/**
 * 掷一次裸技能检定。
 *
 * ★ 存在的理由是 Nous 2026-08-05 的观察：**"撬锁"玩家心里想的是"掷巧手"**。
 *   技能层的第一格给的就是这个 —— 不用先找到某个具体动作才能掷。
 *   对照表 §6：`actor.getStatistic(slug).roll({ event })`。
 */
export async function rollSkill(
    actor: ActorPF2e | null,
    slug: string,
    event: Event,
): Promise<void> {
    try {
        const stat = (actor as any)?.getStatistic?.(slug);
        if (!stat) {
            ui.notifications.warn("This character has no such skill.");
            return;
        }
        /*
         * ⚠⚠ **这条路径不能传 `event`** —— 与 `variant.roll()` 正好相反（2026-08-05 实测）。
         *
         *   四种组合逐个试出来的（`showCheckDialogs` 为真时）：
         *     只传 `skipDialog: true`              → 出结果、无框  ✓
         *     `event`(无 shift) + `skipDialog:true` → 无结果、弹框  ✗
         *     `event`(有 shift) + `skipDialog:true` → 无结果、弹框  ✗
         *     只传 `event`                          → 无结果、弹框  ✗
         *
         *   **只要 `event` 在，`skipDialog` 就完全失效**，与 shift 是什么无关 ——
         *   不是两个参数打架，是 `event` 一出现就接管了整个判断。
         *
         *   所以打击那边靠 `intentEvent` 反解 shift、这边靠 `skipDialog`，
         *   **两条路径必须分开写**。我最初照搬打击的写法，白改了两轮。
         *
         * ⚠ 不传 event 的代价：生态模组拿不到检定上下文。对技能检定可以接受 ——
         *   Toolbelt 的自动掩护只包攻击检定，与这里无关（设计定档 §6.3）。
         *   将来若有模组要听技能检定，这里要重新权衡。
         *
         * 立场不变：默认跳过加值框（省掉多余那一步），按住 Shift 才弹。
         */
        const wantsDialog = !!(event as MouseEvent | null)?.shiftKey;
        await stat.roll({ skipDialog: !wantsDialog });
    } catch (err) {
        console.error("player-action-ui-hub | rollSkill 失败", err);
        ui.notifications.error("The check failed — see the console for details.");
    }
}

/**
 * 施放一个法术。
 * 对照表 §6：`spell.spellcasting.cast(spell, {rank, slotId})`。
 *
 * ⚠ **`rank` 用 pf2e 自己算好的 `spell.rank`，我们不推算提升环位** ——
 *   实测戏法 `baseRank: 1` 而 `rank: 3`（系统自动升到角色最高环）。
 *   自己算等于把规则搬进来一份，那正是本模组明确不做的事。
 */
export async function castSpell(
    actor: ActorPF2e | null,
    entryId: string,
    spellId: string,
    /**
     * 按几环放。不给就用法术自己的 `rank`。
     * ★ Nous 2026-08-08：自选施法者的同一个法术能按好几环放，
     *   轮盘按环分页之后，**玩家点的是哪一页就是哪一环** —— 这个数从那里来。
     */
    rank?: number,
    /**
     * 准备位施法要用它认是哪个位（同一个法术可以准备在两个位上）。
     * ⚠ pf2e 的 `consume(spell, rank, slotId)` 就吃这个；不给它会去猜。
     */
    slotIndex?: number,
): Promise<void> {
    try {
        const entry = (actor as any)?.spellcasting?.get?.(entryId);
        const spell = entry?.spells?.get?.(spellId);
        if (!entry || !spell) {
            ui.notifications.warn("That spell is no longer available — reopen the wheel.");
            return;
        }
        await entry.cast(spell, {
            rank: rank ?? spell.rank,
            // ⚠ 只有真给了才传：传 undefined 与不传对 pf2e 是一回事，但传 null 不是
            ...(slotIndex === undefined ? {} : { slotId: slotIndex }),
        });

        /*
         * ★ 施放之后自动把"作用于自己"的效果套上（②段第一步）。
         *   pf2e 只在聊天卡片上给个按钮等玩家点 —— 那一步是纯机械劳动，
         *   而 Shield 这类每回合都要重来（实测持续"到你下回合开始"）。
         *
         * ⚠ **放在 cast 之后、且失败不影响施法**：骰子已经掷出去了，
         *   自动化出问题不该把已经生效的施法也搅黄。
         */
        const applied = await applySelfEffectAfterCast(actor, spell);
        if (applied) ui.notifications.info(`${applied} applied.`);

        /*
         * ★ 豁免类范围减益（路径 B）：逐个敌人掷豁免，失败的才套。
         *   **不能像 aura 那样直接套** —— Bane 的规则是"敌人必须通过 Will 豁免，否则…"，
         *   直接套等于跳过豁免。
         *
         * ⚠ 结果发到聊天栏而不是通知条：它是**多行、要留档**的东西，
         *   而且部分失败（没权限改敌人）要让 GM 看得见并接手。
         */
        const 结算 = await resolveAreaAfterCast(actor, spell);
        if (结算) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: actor as any }),
                content: `<p><strong>${spell.name}</strong></p><p>${结算}</p>`,
            });
        }
    } catch (err) {
        console.error("player-action-ui-hub | castSpell 失败", err);
        ui.notifications.error("Casting failed — see the console for details.");
    }
}

/**
 * 装填的聊天回执 —— **照抄 pf2e 的 `WeaponReloader#sendMessage`**
 * （Nous 2026-08-08 对比两张卡后提的：官方那张信息更全）。
 *
 * ★★ 差在哪（实读两条真消息）：
 *   | | 官方 | 我们（`useAction("interact")`）|
 *   |---|---|---|
 *   | style | `EMOTE`(3) | `OTHER`(0) |
 *   | 标题 | Interact ◆ **(Reload)** | Interact ◆ |
 *   | 词条 | `tags paizo-style` + `<hr class="action-divider">` | 普通 `tags`，无分隔线 |
 *   | 正文 | 武器图 + "X loads W with M." | **空** |
 *
 *   ⇒ 通用 Interact 动作卡答不出"装了哪把枪、装的什么弹"，
 *     而那正是这张卡**唯一**要说的事。
 *
 * ★ 照抄的是**数据与模板**，不是 HTML：两个 hbs 由系统提供，
 *   词条对象照 `traitSlugToObject` 的形状（`{name,label,description}`）现拼，
 *   文案走 `PF2E.Actions.Interact.Reload.Description`（"{actor} loads {weapon} with {ammo}."）。
 *   ⇒ 系统改版式或改翻译，我们跟着变；自己拼 HTML 就会在某次更新后原地过期。
 *
 * ⚠ **glyph 照它的算法**：`repeating` 特性算 3，否则取 `weapon.reload`。
 *   不能写死 1 —— 转轮枪那类是 3。
 * ⚠ 传了 `subtitle`，header 模板就不会给 glyph 加 `larger` 类 —— 官方那张正是如此，
 *   这也是"照模板"而不是"照抄 HTML"才能自动对上的地方。
 *
 * @returns 真发出去了吗（战斗外按 pf2e 的做法不发，见调用处）
 */
export async function sendReloadMessage(
    actor: ActorPF2e | null,
    weapon: unknown,
    ammo: unknown,
): Promise<boolean> {
    try {
        const w = weapon as any, am = ammo as any;
        /*
         * ⚠ **名字取 `weapon.actor`，不取传进来的那个**（照 pf2e 的 `let n = t.actor`）。
         *   实测差异：世界 actor 叫 "Gunslinger · Nhalmika"，而令牌上的合成 actor 叫 "Nhalmika" ——
         *   官方那张卡写的是后者。同一个人两个名字，写错了不报错，只是**看起来不像同一条消息**。
         *   ⇒ 顺着武器往上找宿主，天然拿到"这一下是谁做的"那个身份。
         */
        const ac = (w?.actor ?? actor) as any;
        if (!ac || !w || !am) return false;
        const n = w.system?.traits?.value?.includes?.("repeating") ? 3 : Number(w.reload);
        const glyph = n > 0 && Number.isInteger(n) ? String(n) : null;
        const cfg = (CONFIG as any).PF2E ?? {};
        const render = (foundry as any).applications?.handlebars?.renderTemplate
            ?? (globalThis as any).renderTemplate;
        if (typeof render !== "function") return false;

        const flavor = await render("systems/pf2e/templates/chat/action/flavor.hbs", {
            action: {
                title: "PF2E.Actions.Interact.Title",
                subtitle: "PF2E.Actions.Interact.Reload.Title",
                glyph,
            },
            // ⚠ 照 traitSlugToObject 的返回形状；label 要能被模板的 {{localize}} 吃下去
            traits: [{
                name: "manipulate",
                label: cfg.actionTraits?.manipulate ?? "manipulate",
                description: cfg.traitsDescriptions?.manipulate ?? null,
            }],
        });
        const content = await render("systems/pf2e/templates/chat/action/content.hbs", {
            imgPath: w.img,
            message: game.i18n.format("PF2E.Actions.Interact.Reload.Description", {
                actor: ac.name, weapon: w.name, ammo: am.name,
            }),
        });
        const token = ac.getActiveTokens?.(false, true)?.shift?.() ?? null;
        await (ChatMessage as any).create({
            content,
            flavor,
            speaker: (ChatMessage as any).getSpeaker({ actor: ac, token }),
            style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
        });
        return true;
    } catch (err) {
        console.error("player-action-ui-hub | 装填回执失败", err);
        return false;
    }
}

/**
 * 让**一个目标**掷这个法术的豁免。
 *
 * ★★ 签名是实测出来的（2026-08-08，Fear DC 21 打 Valeros）：
 *
 *     target.saves[statistic].roll({ dc: { value, label }, item: spell, origin: caster,
 *                                    extraRollOptions, skipDialog: true })
 *     → { degreeOfSuccess: 0, total: 11 }
 *     聊天卡："Will Saving Throw … (Fear DC 21) Result: Critical Failure by -10"
 *
 * ★ **DC 一律现读** `spell.spellcasting.statistic.dc.value`（实测 21）——
 *   不自己算、也不缓存：DC 随施法条目的熟练/属性走，抄一份出来就会腐坏。
 * ★ **豁免类型也现读** `spell.system.defense.save.statistic`（`will` / `reflex` / `fortitude`）。
 *
 * ⚠ `skipDialog: true` —— 与 `rollStrike` 那边同一条：轮盘的卖点是"点一下就成"，
 *   每个目标都弹一次加值框会把这条链拖垮。
 * ⚠ 返回 `degreeOfSuccess` 给调用方，**但目前不拿它做任何自动化**：
 *   伤害怎么按成功度打折是 pf2e 的事，我们插手就等于把规则抄一份进来。
 */
export async function rollSpellSave(
    target: unknown,
    spell: unknown,
    caster: unknown,
): Promise<{ degreeOfSuccess?: number; total?: number } | null> {
    try {
        const sp = spell as any;
        const stat = String(sp?.system?.defense?.save?.statistic ?? "");
        if (!stat) return null;                       // 这个法术没有豁免
        const save = (target as any)?.saves?.[stat];
        if (!save?.roll) return null;
        const dc = Number(sp?.spellcasting?.statistic?.dc?.value);
        const r = await save.roll({
            dc: Number.isFinite(dc) ? { value: dc, label: `${String(sp?.name ?? "Spell")} DC` } : undefined,
            item: sp,
            origin: caster,
            extraRollOptions: ["magical", "spell"],
            skipDialog: true,
        });
        return r && typeof r === "object" ? r as { degreeOfSuccess?: number; total?: number } : null;
    } catch (err) {
        console.error("player-action-ui-hub | rollSpellSave 失败", (target as any)?.name, err);
        return null;
    }
}

/**
 * 掷这个法术的**命中**（attack 型：Phase Bolt / Divine Lance / Telekinetic Projectile）。
 *
 * ★ Nous 2026-08-08："attack 型比如 phase bolt 属于攻击，摇命中色子。"
 * ★ 判据是 pf2e 算好的 `spell.isAttack`（实测 Phase Bolt / Divine Lance = true，
 *   Electric Arc = false —— 后者走豁免）。**不自己看 traits 里有没有 `attack`**：
 *   那是描述性标签，`isAttack` 才是系统真正拿来分派的那个。
 *
 * ⚠ 与法术 `rollDamage` 同一个坑：`rollAttack` 也收**位置参数**（事件本身），
 *   传对象会让 `eventToRollParams` 的 `isRelevantEvent` 判定失败 ⇒ 弹对话框。
 * ⚠ 这里用 `check` 那个开关（命中是检定，不是伤害）。
 */
export async function rollSpellAttack(spell: unknown, event: Event): Promise<boolean> {
    try {
        const sp = spell as any;
        if (typeof sp?.rollAttack !== "function") return false;
        await sp.rollAttack(intentEvent(event, "check"));
        return true;
    } catch (err) {
        console.error("player-action-ui-hub | rollSpellAttack 失败", err);
        return false;
    }
}

/**
 * 掷这个法术的伤害。
 *
 * ⚠ **有没有伤害用 `getDamage()` 问，不看 `system.damage`**：
 *   实测 Fear 的 `system.damage` 是 `{}`（空对象，真值！）而 `getDamage()` 返回假 ——
 *   拿前者判会给每个无伤害法术都排一次伤害步骤。
 * ⚠ 同样传"意图事件"跳过加值框（同 rollStrike）。
 *
 * @returns 真掷出来了吗
 */
export async function rollSpellDamage(spell: unknown, event: Event): Promise<boolean> {
    try {
        const sp = spell as any;
        if (typeof sp?.rollDamage !== "function") return false;
        /*
         * ⛔⛔ **法术的 `rollDamage` 收的是位置参数，不是对象**（实读 pf2e 源码）：
         *
         *     async rollDamage(e, t) { … eventToRollParams(e, { type: "damage" }) }
         *                      ↑ event 本身          ↑ mapIncreases
         *
         *   我原来写的是 `rollDamage({ event: intentEvent(event) })` —— 那是**打击**那边的
         *   签名（`strike.damage({ event, mapIncreases })` 确实收对象）。照搬过来之后，
         *   `eventToRollParams` 里的 `isRelevantEvent(e)` 判定失败 ⇒ 退回默认 ⇒
         *   `skipDialog = !showDamageDialogs = false` ⇒ **弹出伤害对话框**。
         *   ★ 全程不报错：传错的那个对象是合法值，只是不是它要的那个东西。
         * ⚠ 同一个方法名在两个类上签名不同 —— 这类坑只能靠读源码，读不出来就别抄。
         */
        await sp.rollDamage(intentEvent(event, "damage"));
        return true;
    } catch (err) {
        console.error("player-action-ui-hub | rollSpellDamage 失败", err);
        return false;
    }
}

/** 这个法术掷得出伤害吗 —— 判据用 `getDamage()`，不看 `system.damage`（见上）。 */
export async function spellHasDamage(spell: unknown): Promise<boolean> {
    try {
        const d = await (spell as any)?.getDamage?.();
        return !!d;
    } catch {
        return false;
    }
}

/**
 * 把一个 spell effect **批量贴到选中的目标身上**（Nous 2026-08-08 的
 * "自动给所有友军贴 buff" 那一步）。
 *
 * ★★ **effect 从 UUID 现读、每次现取一份**：
 *   `fromUuid` 拿到的是纲要里的原件，必须 `toObject()` 复制之后再往 actor 上放 ——
 *   直接塞原件等于把纲要文档挂进角色，pf2e 会在派生数据那一步炸。
 * ★ 记来源（`flags.pf2e.rulesSelections` 不动，只补 `origin`）：
 *   effect 上带着"谁放的、哪个法术"，玩家事后才认得出这一层光环是哪来的。
 *
 * ⚠ **一个失败不拖垮其余**：五个人贴四个成了一个没成，那也比整批回滚强 ——
 *   回滚等于把已经生效的 buff 又撤了，而战斗里那一下是不可逆的观感。
 *   ⇒ 逐个 try，最后汇总报数。
 * ⚠ 已经有同名 effect 的**跳过**：重复贴会叠两层同名光环，
 *   而 pf2e 的多数 buff 不叠加 —— 叠出来的第二层是纯粹的假状态。
 *
 * @returns 真贴上了几个 / 一共几个
 */
export async function applyEffectTo(
    targets: unknown[],
    effectUuid: string,
    origin?: { actor?: unknown; spellName?: string },
): Promise<{ ok: number; total: number }> {
    const total = targets.length;
    if (!total || !effectUuid) return { ok: 0, total };
    let ok = 0;
    try {
        const 原件: any = await fromUuid(effectUuid);
        if (!原件?.toObject) {
            ui.notifications.warn("That spell effect could not be found.");
            return { ok: 0, total };
        }
        const 名字 = String(原件.name ?? "");
        for (const t of targets) {
            try {
                const actor: any = (t as any)?.actor ?? t;
                if (!actor?.createEmbeddedDocuments) continue;
                // 已经有同名 effect ⇒ 跳过（多数 buff 不叠加，叠出来是假状态）
                const 已有 = (actor.itemTypes?.effect ?? [])
                    .some((e: any) => String(e?.name ?? "") === 名字);
                if (已有) continue;
                const obj = 原件.toObject();
                obj.flags = obj.flags ?? {};
                obj.flags.pf2e = obj.flags.pf2e ?? {};
                if ((origin?.actor as any)?.uuid) {
                    obj.flags.pf2e.origin = { actor: (origin!.actor as any).uuid };
                }
                await actor.createEmbeddedDocuments("Item", [obj]);
                ok++;
            } catch (err) {
                // 单个失败不拖垮其余 —— 名字带上，好查是谁没成
                console.error("player-action-ui-hub | 贴效果失败", (t as any)?.name, err);
            }
        }
    } catch (err) {
        console.error("player-action-ui-hub | applyEffectTo 失败", err);
    }
    return { ok, total };
}

/**
 * 执行一个通用/技能动作。
 * 对照表 §6：`game.pf2e.actions.get(slug).use({ actors, event })`。
 *
 * ⚠ 同样传"意图事件"而不是原始点击 —— 理由与 `rollStrike` 完全一致：
 *   呼出轮盘用的 Ctrl 会被 pf2e 读成暗骰开关（`sheet/helpers.ts:145`）。
 */
export async function useAction(
    actor: ActorPF2e | null,
    slug: string,
    event: Event,
): Promise<void> {
    try {
        // ⚠ 局部豁免同 collectors/actions.ts：类型包没有声明 `game.pf2e.actions`
        const action = (game as any).pf2e?.actions?.get(slug);
        if (!action) {
            ui.notifications.warn("That action is not available in this world.");
            return;
        }
        await action.use({ actors: actor ? [actor] : [], event: intentEvent(event) });
    } catch (err) {
        console.error("player-action-ui-hub | useAction 失败", err);
        ui.notifications.error("The action failed — see the console for details.");
    }
}
