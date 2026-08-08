import type { ActorPF2e, CharacterStrike } from "foundry-pf2e";
import type { SectorData } from "../types";
import { strikeDamageOf } from "../strike-damage";

/**
 * 我们眼里的一条打击。
 *
 * ★ 为什么落在 `CharacterStrike` 而不是 `AttackAction`（Task 9）：
 *   基类 `StrikeData` 上**没有** `auxiliaryActions`（那是 pf2e 只给 PC 的东西，
 *   `types/pf2e/module/actor/character/data.d.ts:380`）。用基类就得到处 `as any` 才能读它，
 *   反而把闸拆得更碎。用这个别名，则 `ready` / `item.img` / `variants[].label` /
 *   `auxiliaryActions[].execute()` 全部受闸管。
 *
 * ⚠ 运行时它也可能是 NPC 的打击（NPC 没有 auxiliaryActions）——所以读那个字段的地方
 *   一律保留 `?? []` 的兜底，不能因为类型上是必填就把兜底删掉。
 */
export type WheelStrike = CharacterStrike;

/**
 * `system.actions` 里挑出打击。
 *
 * ★ **唯一一处**把 pf2e 的宽类型收窄到 `WheelStrike` 的地方（Task 9）。
 *   收窄本身靠的是 `type === "strike"` 这个 pf2e 自己的判别字段
 *   （`actor/data/base.d.ts:255` 写死 `type: "strike"`），
 *   多出来的那一步（StrikeData → CharacterStrike）是为了拿到 auxiliaryActions，
 *   见 WheelStrike 的注释。收在这一个函数里，别处就不必再各自 cast。
 */
function isStrike(action: unknown): action is WheelStrike {
    return (action as { type?: unknown } | null)?.type === "strike";
}

/** 从 actor 身上取出全部打击；不是能打击的角色就返回空数组。 */
export function strikesOf(actor: ActorPF2e | null | undefined): WheelStrike[] {
    const actions = actor?.system?.actions;
    if (!Array.isArray(actions)) return [];
    return actions.filter(isStrike);
}

/**
 * 扇区 id ↔ strike 的对应关系。
 *
 * ⚠ 采集（collector）与执行（executor）**必须调同一个函数**算这个 id，
 *   各写各的迟早会在退化分支上分叉（例如没有 item.id 也没有 slug 时退到下标），
 *   那时回查静默落空、点了没反应。
 *
 * @param index 在**已过滤出的 strike 列表**里的下标，不是 system.actions 的原始下标
 */
export function strikeSectorId(strike: WheelStrike, index: number): string {
    return `strike:${strike?.item?.id ?? strike?.slug ?? index}`;
}

/**
 * 弹药扇区的 id —— `ammo:<strikeKey>:<ammoId>`。
 *
 * ⛔⛔ **`strikeKey` 自己带一个冒号**（上面那个函数返回的是 `strike:<itemId>`），
 *   所以这个 id 一共有三个冒号。按固定下标解构会静默切错：
 *
 *       "ammo:strike:AbC123:XyZ789".split(":")
 *       → const [, strikeKey, ammoId] = …   // strikeKey="strike"，ammoId=武器id ✗
 *
 *   2026-08-08 就是这么坏的，而且**两个分支各自都合法、都不报错**：
 *   回查打击落空 → 空位算成 0 → 弹「已经装填了」；
 *   按武器 id 去背包找弹药 → 找不到 → 一发也没装。
 *   Nous 报的「说是填了但是没有真的填，还会说已经装填了」是同一个 bug 的两端。
 *
 * ★ 与 `strikeSectorId` 同一条道理：**编码和解码必须是一对函数**，
 *   各写各的迟早在退化分支上分叉，而分叉的表现是"点了没反应"不是报错。
 */
export function ammoSectorId(strikeKey: string, ammoId: string): string {
    return `ammo:${strikeKey}:${ammoId}`;
}

/**
 * 解回 `{ strikeKey, ammoId }`；不是这种 id 就返回 null。
 *
 * ⚠ **变长的那段在中间** —— 先 `pop()` 取定长的末段，再 `join(":")` 还原中段。
 *   这与 `aux:` 那支的做法一致（那处早就写对了）。
 * ⚠ 前提：弹药 id 里没有冒号（Foundry 文档 id 是 16 位字母数字）。
 *   ⇒ 以后往 id 里再拼字段，**新字段只能加在末尾且不含冒号**，否则这里要一起改。
 */
export function parseAmmoSectorId(id: string): { strikeKey: string; ammoId: string } | null {
    if (!id.startsWith("ammo:")) return null;
    const rest = id.slice("ammo:".length).split(":");
    if (rest.length < 2) return null;             // 至少要有 strikeKey 和 ammoId 两段
    const ammoId = rest.pop() ?? "";
    const strikeKey = rest.join(":");
    return strikeKey && ammoId ? { strikeKey, ammoId } : null;
}

/**
 * 从 actor 采集打击，转成盘面扇区。**只读，绝不写 actor。**
 *
 * ⛔ 门禁判据用 `strike.ready`，**绝不能用 `strike.canAttack`**：
 *    findings-v0.1 §2 实测——武器收在鞘里（`ready: false`）时 `canAttack` 依然是 `true`。
 *    名字像"能不能打"，语义却不是，用了会让收鞘武器显示成可用。
 */
/**
 * 一件武器的**辅助动作**（拔刀 / 收鞘 / 换握 / 丢弃）与**装填**。
 *
 * ★★ **为什么要单独有这个**（2026-08-05 alpha 反馈："Can you reload a weapon on this
 *   menu, not seeing it… Gunslinger reload, unsheathen weapon"）：
 *   原来只在武器**未拔出**时取 `auxiliaryActions[0]` 当"拔刀"用，
 *   于是**已拔出时的辅助动作全部看不见**。实测同一把武器：
 *     未拔出 → `[Draw]`；已拔出 → `[Sheathe(1), Drop(0)]`；火器 → 还多一个 `Change Grip (2H)`。
 *   这些是 pf2e 现成给的、随状态变的清单，我们只取了其中一个。
 *
 * ★ **装填不在 `auxiliaryActions` 里**（实测 Arquebus 的辅助只有换握/收鞘/丢弃）。
 *   PF2e 的装填**就是 Interact**（动作注册表里有 `interact`，没有 `reload`；
 *   compendium 里那条 `Reload!` 是**指挥官战术**，不是通用装填，别拿它顶）。
 *   判据是武器自己的 `system.reload.value`（Arquebus 实测为 `"1"`）——
 *   有这个值才需要装填，所以这一格**只对需要装填的武器出现**。
 */
export function collectStrikeAuxiliaries(actor: ActorPF2e | null | undefined): SectorData[] {
    try {
        const out: SectorData[] = [];
        strikesOf(actor).forEach((strike, i) => {
            const strikeId = strikeSectorId(strike, i);
            const 武器名 = String(strike.label ?? strike.slug ?? "?");
            (strike.auxiliaryActions ?? []).forEach((aux: any, ai: number) => {
                /*
                 * ⚠ **Drop 不给格子**（Nous 2026-08-07："不需要 drop 快捷键"）。
                 *   它在角色卡上有，但它是"出事了才做"的动作，
                 *   放进一圈只有八格的轮盘里，等于用一个常用位置换一个几乎不用的动作。
                 *   ⚠ 判据是 pf2e 自己的 label —— 这里**不做正则**，就认这一个词；
                 *     它变了我们最多是多显示一格，不会错杀别的。
                 */
                if (String(aux?.label ?? "").trim() === "Drop") return;
                out.push({
                    id: `aux:${strikeId}:${ai}`,
                    // 带上武器名：多把武器时光写 "Sheathe" 分不清是哪把
                    label: `${武器名} · ${String(aux?.label ?? "?")}`,
                    /*
                     * ★ 图标要留（Nous 2026-08-08："那些特别类型的 strike 的 icon 全部都丢失了"）。
                     *   我上一版为了让蓝字显出来把图标去了 —— **那是把两件事绑在了一起**：
                     *   环上认的是图标，"这不是攻击"由**毂里的名字变蓝**来说。
                     *   去掉图标换一个颜色，等于用一个更重要的东西换一个次要的。
                     */
                    img: strike.item?.img ?? undefined,
                    infoUuid: (strike as any).item?.uuid,
                    cost: costOf(aux?.actions),
                    state: "normal",
                    /*
                     * ★ 亮蓝 = **点了不掷骰**（Nous 2026-08-08）：
                     *   打击层里混着"打出去"和"摆弄武器"两类，
                     *   不给区分就只能靠读名字 —— 而这里正是每回合要快的地方。
                     */
                    tone: "aux",
                });
            });
            // 需要装填的武器才给这一格
            /*
             * ★★ **装填这一格全部照角色卡的那份数据**（Nous 2026-08-07 第二次指出）。
             *
             *   实测 `strike.ammunition` 就是角色卡自己用的那个对象：
             *   `{ compatible: [], selected: null, loaded: [], requiresReload: true,
             *      reloadGlyph: "1", capacity: 1, remaining: 1 }`
             *
             *   ⚠⚠ 我原来的两个判据**都是自己造的，而且都错了**：
             *   ① 用 `item.system.reload.value` 认"要不要装填" ——
             *      长剑那个值是字符串 `"-"`，于是每把近战武器都多一格；
             *   ② 根本没判**有没有弹药**。角色卡把 Reload 灰掉并写着
             *      "No Compatible Ammo in Inventory"，而轮盘照样让你点，
             *      点完还真发一条 Interact 到聊天栏 —— **UI 给了假的成功反馈**。
             *
             *   `requiresReload` 和 `compatible` 都是系统算好的，照抄就不会再错。
             */
            const ammo: any = (strike as any)?.ammunition;
            if (ammo?.requiresReload) {
                // 卡上的判据：库存里有没有能装的弹药（选中的那份也算）
                const 有弹药 = (ammo.compatible?.length ?? 0) > 0 || ammo.selected != null;
                const 消耗 = Number(ammo.reloadGlyph);
                /*
                 * ★ **枪里现在装着什么** —— 印在装填这一格上（Nous 2026-08-08 点名要的）。
                 *   打击格上只放得下 `◈已装/容量`（badge 不断行也不截断，见那边的注释），
                 *   而"装的是哪一种"放在**你要去操作它的那一格**上正合适：
                 *   看打击格是为了决定打不打，看这一格是为了决定装不装（playbook 12.7 的分层）。
                 *
                 * ⚠ 名字**截到括号前**："Rounds (Dwarven Scattergun)" → "Rounds"。
                 *   括号里那段是武器型号，而这一格的标题已经写着是哪把武器了 —— 重复的信息
                 *   在这里的代价是横着顶出扇区。
                 * ⚠ 数量照 pf2e 在 `roll()` 里的算法：弹匣类（`uses.max > 1`）读 `uses.value`，
                 *   否则读 `quantity`。两者混用会在弹匣武器上报错数。
                 */
                const 装着: any = (strike as any)?.item?.ammo ?? null;
                const 弹数 = 装着
                    ? Number(Number(装着.system?.uses?.max) > 1
                        ? 装着.system?.uses?.value : 装着.system?.quantity) || 0
                    : 0;
                out.push({
                    id: `reload:${strikeId}`,
                    label: `${武器名} · Reload`,
                    img: strike.item?.img ?? undefined,
                    infoUuid: (strike as any).item?.uuid,
                    cost: costOf(Number.isFinite(消耗) ? 消耗 : 1),
                    // ⛔ 这一格也有图标 —— 图标下面同样不写字（Nous 2026-08-08）
                    badge: undefined,
                    // ★ 全部进毂：装的是什么、还剩几发
                    hubNotes: [装着
                        ? `◈ ${String(装着.name ?? "?")} ×${弹数}`
                        : "⌀ Not loaded"],
                    // 装填也不掷骰，与拔刀收鞘同一类
                    tone: "aux",
                    // ★ 没弹药就灰 + ⛔ + 说明为什么 —— 这一条**不是我们判的规则**，
                    //   是角色卡自己就这么显示的
                    state: 有弹药 ? "normal" : "gated",
                    reason: 有弹药
                        ? "Reloading is an Interact action in PF2e."
                        : "No compatible ammunition in your inventory.",
                });
            }
        });
        return out;
    } catch (err) {
        console.error("player-action-ui-hub | collectStrikeAuxiliaries 失败", err);
        return [];
    }
}

/*
 * ⛔ 这里原来有一对 `BADGE_UNITS` / `装填角标()`，是给"印在扇区上的装填角标"做宽度收敛的。
 *   2026-08-08 Nous 判定图标下面一律不写字、数值全进毂之后，那条路整条不要了，
 *   连同它的宽度预算一起删掉 —— **留着一个没人调用的截断器，下一个人会以为扇区还在显示什么**。
 *   ★ 量出来的那两个数没有白费，它们搬进了毂里那一行的预算（wheel-app 的 `HUB_NOTE_UNITS`）。
 */

/** 辅助动作的消耗：实测 `Drop` 是 0（自由动作），其余是 1。 */
function costOf(n: unknown): SectorData["cost"] {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return v === 0 ? "free" : String(v) as SectorData["cost"];
}

export function collectStrikes(actor: ActorPF2e | null | undefined): SectorData[] {
    try {
        /*
         * ★★ **没拔出来的武器不列打击**（Nous 2026-08-07）：
         *
         *   > "不能直接 strike，必须先拔出武器才能攻击，
         *   >  然后放回去之后不应该显示攻击（因为没有拔出）。"
         *
         *   原来是灰显但**仍可点** —— 那是三态守则"提示不是锁"的用法，
         *   但它在这里用错了：三态守则挡的是**规则判断**（够不够近、满不满足要求），
         *   那些我们算不准，所以只提示。而"武器在不在手上"**不是判断，是事实**，
         *   pf2e 自己给了 `ready`。拿一个确定的事实去做"提示不是锁"，
         *   结果就是让玩家掷出一次收在鞘里的攻击。
         *
         * ⚠ 拔刀的入口**没有消失**：未拔出时 `auxiliaryActions` 变成 `["Draw (1H)"]`
         *   （实测），而辅助动作是另一批扇区，就排在打击后面。
         *
         * ⛔ 门禁判据用 `strike.ready`，**绝不能用 `strike.canAttack`**：
         *    findings-v0.1 §2 实测——收在鞘里（`ready: false`）时 `canAttack` 依然是 `true`。
         */
        return strikesOf(actor).filter(s => s.ready !== false).map((strike, i): SectorData => {
            /*
             * —— 装填状态：印在打击格上（Nous 2026-08-08）——
             *
             * > "这个上面攻击不显示这个武器有没有装填，既然官方上面有
             * >  我们这个武器下面也写一下装填物和数量吧／未装填。"
             *
             * ★★ **判据用 `weapon.ammo`，不用 `loaded.length`**：
             *   实读 pf2e 的 `WeaponPF2e#ammo` —— 对需要装填的武器它取的是
             *   `subitems.filter(i => i.isAmmoFor(weapon))`，**带兼容性检查**，
             *   而 `roll()` 问的正是这个 getter。
             *   ⇒ 只有它答的才是"这一枪打不打得出去"。数 `loaded` 会把
             *     装错的弹也算成有子弹（`attach` 不校验兼容性，实测装得进去），
             *     那就成了一个**看起来正确的错状态**。
             *
             * ★ 空枪 → `gated`：这是**系统断言的事实**不是我们的推断
             *   （playbook 14 的分界：系统说的照做，我们推的才只提示）。
             *   ⚠ gated 照旧可点（三态都能点）—— pf2e 会自己拒绝并报准话，
             *     而我们现在掷骰失败不再关盘，玩家原地就能去点隔壁的 Reload。
             *
             * ⛔ **全部写在毂里，扇区上一个字不留**（Nous 2026-08-08 第二轮定的）：
             *   > "icon 下面应该什么都不说，信息都应该在圆盘里面。"
             *   ★ 中间那一版把 `◈已装/容量` 印在扇区上，被他判为**一致性问题** ——
             *     扇区上于是有了三种长度（`+14` / `+14 ◈1/1` / 空）。
             *     一格宽只有 46 单位，**在扇区上追求"每格都有"必然失败**；
             *     毂是块屏，容得下"每条都给全"。⇒ 12.6 的正解在这里是**都不给**，不是都给。
             * ⚠ 空/满两态不能只差一个数字（12.5）：换记号（◈/⌀）**并且**整格变暗，两重区分。
             * ⚠ 不需要装填的武器一行都不加：那是"这条真的没有"，不是漏了。
             */
            const am: any = (strike as any)?.ammunition;
            const 要装填 = !!am?.requiresReload;
            const 空枪 = 要装填 && !(strike as any)?.item?.ammo;
            /*
             * ⚠ 毂里**用完整名字**（含括号里的型号）：那一行预算 20 单位，
             *   `◈ Rounds (Dwarven Scattergun) ×1` 才 15 左右 —— 放得下就别截。
             */
            const 装着: any = (strike as any)?.item?.ammo ?? null;
            const 弹数 = 装着
                ? Number(Number(装着.system?.uses?.max) > 1
                    ? 装着.system?.uses?.value : 装着.system?.quantity) || 0
                : 0;
            /*
             * ★★ **这一击身上背着多少惩罚** —— 只给数，不写状态名字（Nous 2026-08-08）：
             *
             *   > "你不需要写 status 的名字，因为游戏 ui 已经给了很大一个了，
             *   >  只需要做对应的减值呈现即可。"
             *
             *   ★ 效果面板那排图标（截图右上角的 frightened 2 / enfeebled 2）已经答了
             *     "我身上有什么"；毂里再抄一遍名字**既重复又占行**，实测第 6 行直接被剪掉。
             *     毂里缺的是另一个问题：**`+13` 这个净值里到底含了多少惩罚** ——
             *     名字答不了，数才答得了。
             *
             * ★ **只挪不算**：`strike.modifiers` 是引擎算好并已判过生效/压制的那一份
             *   （实测挂 frightened 2 后多出 `{type:"status", modifier:-2}`，
             *   同时第一击 label 从 `+15` 变 `+13`）。我们只把负项加起来。
             * ⚠ `ignored` 的不能算：pf2e 用它表示"同类取最高、这条被盖掉了"，
             *   算进去会得出一个比真实更低的数 —— 而它看起来完全合理。
             * ⚠ **伤害那边不用管**：enfeebled 之类减的是伤害，而伤害串本身就是系统算好的成品
             *   （`strikeDamageOf`），减值已经在里面了。再列一遍就是同一件事说两遍。
             */
            const 攻击减值 = ((strike as any).modifiers ?? [])
                .filter((m: any) => m?.enabled && !m?.ignored && Number(m?.modifier) < 0)
                .reduce((n: number, m: any) => n + Number(m.modifier), 0);

            return {
                id: strikeSectorId(strike, i),
                label: String(strike.label ?? strike.slug ?? "?"),
                // 图标取自武器物品；有图标时扇区只画图标（见 types.ts）
                img: strike.item?.img ?? undefined,
                cost: "1",
                // MAP 三段。★ 原样用 pf2e 的 label，只在前面补一个动作消耗记号：
                // 实测 label 已是 "+9 (MAP -4)"，自己再拼"第 2 击 MAP -4"会重复
                // （findings-v0.1 §2，计划 Task 7 Step 3 的写法在这一点上是错的）。
                variantLabels: (strike.variants ?? [])
                    .map((v) => `◆ ${String(v?.label ?? "?")}`),
                /*
                 * ★ 伤害串（Nous 2026-08-08："攻击那里没有说明 ok，但是没有写伤害数值说明"）。
                 *   取的是系统算好的成品 `1d6 + 1 piercing` —— 力量、符文、增伤都在里面。
                 *   ⚠ 取不到就不显示，**不退回武器基础伤害**：那个不含任何加值，
                 *     会稳定地少报一截，而且格式对、类型对，看不出是错的。
                 */
                /*
                 * ★★ **要用的数印在扇区上**（Nous 2026-08-08 定的一致性规矩）：
                 *   毂里的说明区拿掉之后，"这一格的关键数字"必须在格子上，
                 *   否则要点开才知道 —— 而攻击加值是每次都要看的那个数。
                 * ⚠ 取**第一击**的 label（pf2e 给的 `+14`），不自己算：
                 *   加值由力量/熟练/符文/增益共同决定，自己拼一定会漏。
                 */
                /*
                 * ⛔ **图标下面一个字都不写**（Nous 2026-08-08："icon 下面应该什么都不说，
                 *   信息都应该在圆盘里面"）。加值原来印在这里，现在毂里的 MAP 那一行
                 *   本来就写着 `◆ +14`（第 1 击），**一个数不丢**。
                 * ★ 这一条是对 12.6 的**修正**：一致性不该靠"每格都给"去凑 ——
                 *   扇区一格宽 46 单位，越给越不齐；毂容得下，所以在毂里给全。
                 */
                badge: undefined,
                // 伤害仍然带着 —— 它进聊天卡
                detail: strikeDamageOf(actor, strikeSectorId(strike, i)),
                // ★ 点标题 → 把这把武器的说明发到聊天栏（武器本身就是文档）
                infoUuid: (strike as any).item?.uuid,
                state: 空枪 ? "gated" : "normal",
                // ⚠ 这一层不画 reason（说明区已拿掉），但仍要写对：它是这一格状态的出处
                reason: 空枪 ? "Not loaded." : undefined,
                /*
                 * ★ 毂里逐行给这一格的数值。顺序按**做决定用得着的先后**：
                 *   伤害是每次都要看的，弹药只在需要装填的武器上才有。
                 * ⚠ 伤害串取系统算好的成品（力量/符文/增伤都在里面），取不到就整行不画 ——
                 *   不退回武器基础伤害：那个稳定地少报一截，而且格式对、类型对，看不出是错的。
                 */
                hubNotes: [
                    strikeDamageOf(actor, strikeSectorId(strike, i)),
                    要装填
                        ? (装着 ? `◈ ${String(装着.name ?? "?")} ×${弹数}` : "⌀ Not loaded")
                        : "",
                    // ⚠ 用真减号 U+2212，不是连字符 —— 一串数字里 `-` 太容易看成分隔符
                    攻击减值 < 0 ? `⚠ −${Math.abs(攻击减值)} to hit` : "",
                ].filter(Boolean) as string[],
            };
        });
    } catch (err) {
        console.error("player-action-ui-hub | collectStrikes 失败", err);
        return [];
    }
}
