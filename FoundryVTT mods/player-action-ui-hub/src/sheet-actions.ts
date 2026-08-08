/**
 * **照角色卡搬**（Nous 2026-08-07 定的方向）。
 *
 * > "我认为我们没有必要去自己建立各种动作的表单，
 * >  直接只要连接到角色 sheet，他们有什么我们就把那些搬过来到 UI 里就可以了。"
 *
 * ★★ 这条推翻的是我们自己那套 `isOwnAbility` 判据（"这条归不归本职业"）。
 *   它前后改过两次，每次都是因为**又漏了一类**：专长档、NPC 招牌动作、血统给的能力。
 *   角色卡早就把这件事算完了，而且它算得比我们全 —— 那份清单才是真相。
 *
 * ★ 实测两种卡的形状**不一样**，所以要一层适配（不是可以省的抽象）：
 *
 *   | 卡 | 路径 |
 *   |---|---|
 *   | `CharacterSheetPF2e` | `actions.encounter.{action,reaction,free}.actions` |
 *   | `NPCSheetPF2e` | `actions.{active,passive}.actions` |
 *
 *   条目自带 `{ id, uuid, img, name, actionCost, glyph, usable, traits }` ——
 *   连 **`usable`**（这条现在能不能用）都是卡自己算好的。
 *
 * ⚠ `sheet.getData()` 是**异步**的。实测 2.6ms（我们自己那套 0.16ms），
 *   在呼出轮盘那一下 await 一次完全吃得下 —— 但**不能**在每个采集器里各 await 一次，
 *   所以由呼出处取一次、缓存起来，采集器同步读。
 *
 * ⚠ 取不到卡数据时**退回按条目自己推**（NPC 之外还有魔宠/载具/危害）。
 *   退化路径要一直留着：卡的形状是 pf2e 内部结构，它改了我们不该整个瞎掉。
 */

/** 从角色卡搬过来的一条动作。 */
export interface SheetAction {
    id: string;
    name: string;
    img?: string;
    /** `action` / `reaction` / `free`；被动不收 */
    group: "action" | "reaction" | "free";
    /**
     * ⛔⛔ **它不是"这条现在能不能用"**（2026-08-07 读 pf2e 源码后更正）。
     *
     *   系统里这一行是：
     *   `usable: !!e.system.selfEffect || !!e.system?.frequency || !!e.crafting`
     *
     *   也就是**"这一行要不要画一颗 USE 按钮"** —— 一个纯排版判据。
     *   Spellstrike 既没有 selfEffect 也没有 frequency，于是 `usable === false`，
     *   **不管有没有用过、永远是 false**。
     *
     * ⚠ 我们原来拿它当可用性，还配了一句
     *   "The sheet lists this as not usable right now." —— 那句话是**我编的**：
     *   卡从来没说过这件事。表现就是 Nous 看到的"用了 Spellstrike 之后变成禁止"，
     *   而实际上它开局就是灰的。★ 教训：**字段名不是语义，取语义要去读它怎么算出来的。**
     *
     * 现在它只用来决定要不要走 selfEffect 那条执行路径，**不再参与灰显**。
     */
    usable: boolean;
    traits: string[];
    /** 动作点数；反应/自由动作为 null */
    actions: number | null;
    /**
     * 次数限制，形如 `{ value: 剩余, max: 上限, per: "day" }`；没有限制则为 null。
     *
     * ★ **这才是系统断言的"还能不能用"**（与上面那个 `usable` 相对）。
     *   实测卡上这一行直接把 item 的 `system.frequency` 透传出来。
     */
    frequency: { value?: number; max?: number; per?: string } | null;
}

/** 一个 actor 的卡上分组，缓存用。 */
export interface SheetGroups {
    actorId: string;
    list: SheetAction[];
}

const 缓存 = new Map<string, SheetAction[]>();

/** 把卡里一条原始条目收成我们的形状。 */
function 收(raw: any, group: SheetAction["group"]): SheetAction | null {
    const id = raw?.id ?? raw?.item?.id;
    if (!id) return null;
    const cost = raw?.actionCost ?? raw?.cost ?? null;
    const n = cost?.type === "action" ? Number(cost?.value) : null;
    return {
        id: String(id),
        name: String(raw?.name ?? raw?.label ?? "?"),
        img: raw?.img,
        group,
        // ⚠ 只有卡明确说 false 才当不可用：不少条目根本不带这个字段
        usable: raw?.usable !== false,
        traits: (raw?.traits ?? []).map((t: any) => String(t?.value ?? t?.slug ?? t)),
        actions: Number.isFinite(n) ? (n as number) : null,
        frequency: raw?.frequency ?? null,
    };
}

/**
 * 把两种卡的 `actions` 结构摊平成同一份清单。
 *
 * ⚠ **被动一律不收**：轮盘回答的是"我现在能点什么"，
 *   被动条目点了什么也不会发生，摆出来只是把有用的挤下去。
 */
export function normalizeSheetActions(actions: any): SheetAction[] {
    const out: SheetAction[] = [];
    const 推 = (arr: any, group: SheetAction["group"]) => {
        for (const raw of (arr ?? [])) { const x = 收(raw, group); if (x) out.push(x); }
    };
    // 角色卡
    const enc = actions?.encounter;
    if (enc) {
        推(enc.action?.actions, "action");
        推(enc.reaction?.actions, "reaction");
        推(enc.free?.actions, "free");
    }
    // NPC 卡：只有 active / passive，反应要靠条目自己的消耗认出来
    if (actions?.active?.actions) {
        for (const raw of actions.active.actions) {
            const 消耗 = raw?.actionCost?.type ?? raw?.cost?.type;
            const g: SheetAction["group"] = 消耗 === "reaction" ? "reaction" : 消耗 === "free" ? "free" : "action";
            const x = 收(raw, g);
            if (x) out.push(x);
        }
    }
    return out;
}

/**
 * 取一次卡数据并缓存。**在呼出轮盘那一步 await 它**，采集器同步读缓存。
 * 取不到就清掉缓存，让采集器走退化路径。
 */
export async function primeSheetActions(actor: unknown): Promise<void> {
    const a = actor as any;
    const id = a?.id;
    if (!id) return;
    try {
        const ctx = await a.sheet?.getData?.({});
        const list = normalizeSheetActions(ctx?.actions);
        // ⚠ 空清单也可能是真的（一个动作都没有的角色）。但取不到 ctx 是另一回事，
        //   两者必须分开：前者缓存空数组，后者删缓存走退化。
        if (ctx) 缓存.set(id, list); else 缓存.delete(id);
    } catch {
        缓存.delete(id);
    }
}

/** 读缓存；没有就返回 null（调用方走退化路径）。 */
export function sheetActionsOf(actor: unknown): SheetAction[] | null {
    const id = (actor as any)?.id;
    return id ? (缓存.get(id) ?? null) : null;
}

/** 换角色/换场景时清掉，免得读到上一具身体的清单。 */
export function clearSheetActions(): void {
    缓存.clear();
}
