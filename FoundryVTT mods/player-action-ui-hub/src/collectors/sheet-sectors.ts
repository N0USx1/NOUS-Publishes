import type { SectorData } from "../types";
import { costToSectorCost } from "./actions";
import { detailLine, HUB_CLAUSE_MAX } from "../triggers";
import { restrictionFor, type RestrictionState } from "../restrictions";
import type { SheetAction } from "../sheet-actions";

/**
 * **把角色卡上的一行变成一个扇区**，全模组只此一份。
 *
 * ★ 抽出来的理由不是洁癖：卡上那份清单现在同时喂四个地方 ——
 *   Actions / Free Actions / Reactions / Class。四份各写各的转换，
 *   下次改一处（比如次数怎么显示）必然漏掉三处，**而漏掉的那份不报错，只是长得不一样**。
 *
 * ⛔ **不再拿 `usable` 灰显**（2026-08-07 读 pf2e 源码后拆掉）：
 *   那个字段答的是"要不要画 USE 按钮"，不是"能不能用"。详见 `sheet-actions.ts`。
 *
 * ★ 换成 `frequency` —— **系统真的在记的那一个**：
 *   `{ value: 剩余, max: 上限, per: "day" }`。剩余为 0 才灰，
 *   而且把 `剩余/上限` 印在扇区上（次数是"不看就会点错"的信息，属于 badge 不属于 detail）。
 */
export function sheetSector(
    s: SheetAction,
    idPrefix: string,
    item: unknown,
    限制态: RestrictionState,
): SectorData {
    const it = item as any;
    const cost = s.group === "reaction" ? "reaction"
               : s.group === "free" ? "free"
               : costToSectorCost(s.actions);
    const 限 = restrictionFor({ slug: it?.slug ?? null, traits: s.traits }, 限制态);
    const 次 = frequencyBadge(s.frequency);
    return {
        id: `${idPrefix}${s.id}`,
        label: s.name,
        img: s.img,
        cost,
        // ⚠ 两种角标不能都要：反应的 ⟳ 是"这是什么"，次数是"还剩几次"。
        //   同时出现会挤在一格里互相顶掉 —— 次数更要紧，它决定点不点得动。
        badge: 次 ?? (cost === "reaction" ? "⟳" : undefined),
        detail: detailLine(it?.system?.description?.value ?? "", cost === "reaction", HUB_CLAUSE_MAX,
                           (k) => game.i18n.localize(k)) ?? undefined,
        // ★ 说明可点 —— 卡上的条目本身就是文档，直接给它的 uuid
        infoUuid: it?.uuid,
        state: 限?.state ?? (用完了(s.frequency) ? "gated" : "normal"),
        reason: 限?.reason ?? (用完了(s.frequency)
            ? `Used up — ${perLabel(s.frequency?.per)} limit of ${s.frequency?.max}.`
            : undefined),
    };
}

/** 次数用完了没有。⚠ 没有次数限制的条目一律不算用完（绝大多数条目都没有）。 */
export function 用完了(f: SheetAction["frequency"]): boolean {
    return !!f && Number(f.value) <= 0;
}

/** `剩余/上限` 角标；没有次数限制返回 null。 */
export function frequencyBadge(f: SheetAction["frequency"]): string | undefined {
    if (!f || !Number.isFinite(Number(f.max))) return undefined;
    return `${Number(f.value ?? 0)}/${Number(f.max)}`;
}

/** `per` 的人话。⚠ 认不出来的原样给出去，别硬翻成一个可能是错的词。 */
function perLabel(per: string | undefined): string {
    const 表: Record<string, string> = {
        round: "per-round", turn: "per-turn", hour: "hourly", day: "daily", week: "weekly",
        PT1M: "per-minute", PT10M: "per-10-minutes", PT1H: "hourly", PT24H: "daily",
    };
    return 表[String(per)] ?? "frequency";
}
