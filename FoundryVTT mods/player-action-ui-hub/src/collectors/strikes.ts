import type { ActorPF2e, CharacterStrike } from "foundry-pf2e";
import type { SectorData } from "../types";

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
 * 从 actor 采集打击，转成盘面扇区。**只读，绝不写 actor。**
 *
 * ⛔ 门禁判据用 `strike.ready`，**绝不能用 `strike.canAttack`**：
 *    findings-v0.1 §2 实测——武器收在鞘里（`ready: false`）时 `canAttack` 依然是 `true`。
 *    名字像"能不能打"，语义却不是，用了会让收鞘武器显示成可用。
 */
export function collectStrikes(actor: ActorPF2e | null | undefined): SectorData[] {
    try {
        return strikesOf(actor).map((strike, i): SectorData => {
            const ready = strike.ready !== false;

            // 取拔出动作：**直接取第 0 个**，不做 label 正则。
            // findings-v0.1 §2 实测：未拔出的武器只有一个辅助动作（"Draw (1H)"），
            // 且 label 随语言/握持方式变（Draw (1H) / Draw (2H) …），
            // 拿文字匹配迟早会漏；位置比文字稳。
            // ⚠ `?? []` 不能删：NPC 的打击上根本没有这个字段（见 WheelStrike 注释）。
            const drawAux = (strike.auxiliaryActions ?? [])[0];

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
                // 未拔出 = gated（规则上此刻确实打不了），不是 risky
                state: ready ? "normal" : "gated",
                reason: ready ? undefined : "Not drawn — spend ◆ to draw it first.",
                badge: !ready && drawAux ? "◆ Draw" : undefined,
            };
        });
    } catch (err) {
        console.error("player-action-ui-hub | collectStrikes 失败", err);
        return [];
    }
}
