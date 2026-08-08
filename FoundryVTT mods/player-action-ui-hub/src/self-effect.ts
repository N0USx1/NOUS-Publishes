/**
 * **自我效果**：有些动作用完是要在自己身上挂一个 effect 的（架势、专注、增益）。
 *
 * ★ 起因（Nous 2026-08-07）：
 *   > "class 动作部分的 arcane cascade 用 ui 弹出是使用，但是使用本身不会 apply effect，
 *   >  这个 ui 应该做到 > 点击 arcane cascade 直接 apply effect。"
 *
 * ★★ **系统确实知道这件事，只是它把这一步做成了一颗按钮**（读 pf2e 源码实证）：
 *   - item 上有 `system.selfEffect = { uuid, name }`；
 *   - `game.pf2e.rollItemMacro` → `createUseActionMessage` 贴一张卡，
 *     卡上带 `<button data-action="applyEffect">`；
 *   - 真正干活的是 `ChatLogPF2e.#onClickApplyEffect` —— 一个**私有静态方法**，
 *     从 DOM 事件里取消息、取 item，再造 effect。
 *
 * ⚠⚠ **为什么这里还是自己写了一遍**（不是"又造系统已有的东西"，理由要写清楚）：
 *   ① 那个方法是 `#` 私有的，**没有任何公开入口**可以调；
 *   ② 它只吃 DOM 事件，我们要给它的是"这次选火属性"这种**预置答案**，它接不住 ——
 *      ChoiceSet 的弹窗在 `createEmbeddedDocuments` 里就抢先弹了，
 *      **比 `preCreateItem` 钩子还早**（2026-08-07 实测：钩子一次都没进）。
 *   所以下面这段是**照它逐行转写**的，字段与顺序都对着源码抄，
 *   不是我想出来的一套。它改了我们要跟。
 */

/** 一个条目挂的自我效果 uuid；没有则 null。 */
export function selfEffectUuid(item: unknown): string | null {
    const u = (item as any)?.system?.selfEffect?.uuid;
    return typeof u === "string" && u ? u : null;
}

/**
 * 一个法术**可能造成**哪些伤害类型。
 *
 * ⚠ 实测形状：`spell.system.damage` 是个字典，值里的类型字段叫 `type`
 *   （不是 `damageType`）—— Ignition → `[{ type: "fire", formula: "2d4" }]`。
 *   两个名字都认一下：早期版本用的是 `damageType`，世界里可能留着旧数据。
 */
export function damageTypesOf(spell: unknown): string[] {
    const dmg = (spell as any)?.system?.damage;
    if (!dmg) return [];
    return Object.values(dmg)
        .map((d: any) => d?.type ?? d?.damageType ?? null)
        .filter((t: unknown): t is string => typeof t === "string" && !!t);
}

/**
 * 把**能答的选择题先答掉**。
 *
 * ★ 判据是通用的，不是给某个条目写的映射：
 *   按候选答案依次去问"这道题的选项里有它吗"，有就填、没有就留给玩家。
 *   于是这套逻辑对任何带 ChoiceSet 的自我效果都成立 ——
 *   Arcane Cascade 只是第一个撞上它的。
 *
 * ⚠ 只填**还没填过**的题：源里已经有 `selection` 的，是数据自己定死的，不许覆盖。
 * ⚠ 一道题只用一个答案，答完就停 —— 拿同一个答案去填第二道题多半是错的。
 *
 * @param 候选 按优先级排列的答案（例：`["fire", "weapon-damage"]`）
 * @returns 改动过的 rules 数组；没有可答的题就原样返回
 */
export function answerChoices(rules: unknown[], 候选: string[]): unknown[] {
    let 用过 = false;
    return (rules ?? []).map((r: any) => {
        if (用过 || r?.key !== "ChoiceSet" || r?.selection !== undefined) return r;
        const 选项 = Array.isArray(r?.choices)
            ? r.choices.map((c: any) => String(c?.value ?? c)).filter(Boolean)
            : [];
        const 答 = 候选.find(x => 选项.includes(x));
        if (!答) return r;
        用过 = true;
        return { ...r, selection: 答 };
    });
}

/**
 * 造出要挂到自己身上的那份 effect 源数据。
 *
 * ⚠ 这一段的字段来自 `ChatLogPF2e.#onClickApplyEffect`，逐项对照过：
 *   `_id: null` / `system.context.origin{actor,token,item,spellcasting,rollOptions}` /
 *   `system.context.target{actor,token}` / `system.context.roll: null` /
 *   `system.traits.value` 只留 **effect 认得的那些 trait**。
 *
 * ⚠ `traits` 那一层过滤不能省：系统拿 `EffectPF2e.validTraits` 筛过一遍，
 *   不筛的话会把 `magus` 这类**动作专有 trait** 塞进 effect，
 *   而 effect 的 trait 是会进 roll options 的 —— 等于凭空多出一堆判据。
 */
export function buildSelfEffect(
    effectSource: Record<string, unknown>,
    origin: { actorUuid: string; tokenUuid: string | null; itemUuid: string; rollOptions: string[] },
    traits: string[],
    候选答案: string[] = [],
): Record<string, unknown> {
    const src: any = foundry.utils.deepClone(effectSource);
    src._id = null;
    src.system = src.system ?? {};
    src.system.rules = answerChoices(src.system.rules ?? [], 候选答案);
    src.system.context = {
        origin: {
            actor: origin.actorUuid,
            token: origin.tokenUuid,
            item: origin.itemUuid,
            spellcasting: null,
            rollOptions: origin.rollOptions,
        },
        // 自我效果的目标就是自己 —— 与来源同一个 actor
        target: { actor: origin.actorUuid, token: origin.tokenUuid },
        roll: null,
    };
    src.system.traits = { ...(src.system.traits ?? {}), value: traits };
    return src;
}

/** effect 认得的 trait 有哪些 —— 问系统，别自己列。 */
function 有效特性(traits: string[]): string[] {
    const valid = (globalThis as any).CONFIG?.PF2E?.effectTraits ?? {};
    return traits.filter(t => t in valid);
}

/**
 * 把一个条目的自我效果挂到 actor 身上。
 *
 * @returns 真的挂上了返回 true；这个条目没有自我效果返回 false（调用方据此不做别的）。
 */
export async function applySelfEffect(
    actor: unknown,
    item: unknown,
    候选答案: string[] = [],
): Promise<boolean> {
    const uuid = selfEffectUuid(item);
    if (!uuid) return false;
    try {
        const eff: any = await (globalThis as any).fromUuid(uuid);
        if (!eff?.toObject) return false;
        const a = actor as any;
        const token = a.getActiveTokens?.(true, true)?.[0] ?? null;
        const 特性 = 有效特性(((item as any)?.system?.traits?.value ?? []).map(String));
        const src = buildSelfEffect(
            eff.toObject(),
            {
                actorUuid: a.uuid,
                tokenUuid: token?.uuid ?? null,
                itemUuid: (item as any).uuid,
                rollOptions: (item as any).getOriginData?.()?.rollOptions ?? [],
            },
            特性,
            候选答案,
        );
        await a.createEmbeddedDocuments("Item", [src]);
        return true;
    } catch (err) {
        console.error("player-action-ui-hub | applySelfEffect 失败", err);
        return false;
    }
}
