import type { SectorData } from "./types";

/**
 * 从 actor 采集打击，转成盘面扇区。**只读，绝不写 actor。**
 *
 * ⛔ 门禁判据用 `strike.ready`，**绝不能用 `strike.canAttack`**：
 *    findings-v0.1 §2 实测——武器收在鞘里（`ready: false`）时 `canAttack` 依然是 `true`。
 *    名字像"能不能打"，语义却不是，用了会让收鞘武器显示成可用。
 */
export function collectStrikes(actor: any): SectorData[] {
    try {
        const actions = actor?.system?.actions;
        if (!Array.isArray(actions)) return [];

        return actions
            .filter((a: any) => a?.type === "strike")
            .map((strike: any, i: number): SectorData => {
                const ready = strike.ready !== false;

                // 取拔出动作：**直接取第 0 个**，不做 label 正则。
                // findings-v0.1 §2 实测：未拔出的武器只有一个辅助动作（"Draw (1H)"），
                // 且 label 随语言/握持方式变（Draw (1H) / Draw (2H) …），
                // 拿文字匹配迟早会漏；位置比文字稳。
                const drawAux = (strike.auxiliaryActions ?? [])[0];

                return {
                    id: `strike:${strike.item?.id ?? strike.slug ?? i}`,
                    label: String(strike.label ?? strike.slug ?? "?"),
                    cost: "1",
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
