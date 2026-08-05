import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "../types";
import { statisticList, costToSectorCost, type RawAction } from "./actions";

/**
 * 技能分类 —— 从 Actions 里分出来的那一半（Nous 2026-08-05 定）。
 *
 * ★ **为什么要拆**：实测 `game.pf2e.actions` 去掉 downtime 还有 67 条，挤成 10 页。
 *   而这 67 条里混着两种**心智完全不同**的东西：
 *     - "我要翻滚穿过"  → 战术动作，玩家直接想要这一格；
 *     - "我要撬锁"      → 玩家心里想的其实是**"掷巧手"**，不会去找"撬锁"那一格。
 *   Nous 的原话："撬锁 > thievery check，可能就直接掷骰 thievery 就不去点撬锁的单项了。"
 *
 * ★ 所以技能层的第一格永远是**裸检定**，后面才是该技能的具体动作 ——
 *   想掷就掷，想要动作自带的 DC 与提示就点动作。两种用法都不用绕路。
 */

/** 技能层的一个技能入口。 */
export interface SkillEntry {
    slug: string;
    label: string;
    /** 熟练度等级，0 = 未训练 */
    rank: number;
    /** 总修正值，显示在扇区上 */
    mod: number;
    /** 这个技能名下有几个动作 */
    actionCount: number;
}

/**
 * 这条动作算不算「技能动作」（该进 Skills 而不是 Actions）。
 *
 * ⚠ **不能只看 `section === "skill"`**：实测 section 为 undefined 的 4 条里，
 *   `avoid-notice`(stealth) / `sense-direction`(survival) / `track`(survival)
 *   本质都是技能应用，只有 `affix-a-talisman` 真没有检定。
 *
 * ⚠ 也**不能只看有没有 statistic**：`seek`(perception) 与 `escape`(acrobatics/athletics)
 *   都带检定，但它们是 `basic` 动作 —— 玩家会在「动作」里找 Seek，不会去技能里翻。
 *   pf2e 自己的 section 分类在这一点上比检定字段更贴合玩家心智。
 */
export function isSkillAction(a: RawAction): boolean {
    if (a.section === "basic" || a.section === "specialty-basic") return false;
    if (a.section === "skill") return true;
    return statisticList(a.statistic).filter(Boolean).length > 0;
}

/**
 * 技能排序：训练过的在前，熟练度高的在前，同级按名字。
 *
 * ⚠ **未训练的技能仍然保留** —— 未训练一样能掷，删掉就是替规则做决定
 *   （与 actions 那边不按训练过滤是同一条守则）。
 */
export function rankSkills(list: SkillEntry[]): SkillEntry[] {
    return [...list].sort((x, y) =>
        (y.rank > 0 ? 1 : 0) - (x.rank > 0 ? 1 : 0)
        || y.rank - x.rank
        || x.label.localeCompare(y.label));
}

/** 熟练度等级 → 简称，画在扇区角标上。 */
function rankAbbr(rank: number): string {
    return ["U", "T", "E", "M", "L"][rank] ?? "U";
}

/** 第一层：角色的技能列表。 */
export function collectSkills(actor: ActorPF2e | null): SectorData[] {
    try {
        const a = actor as any;
        const skills = a?.skills ?? {};
        const coll = (game as any).pf2e?.actions;
        const raw: RawAction[] = coll ? [...coll.values()] : [];

        // 每个技能名下有几个动作 —— 用来在角标上提示"点进去有东西"
        const countBySkill = new Map<string, number>();
        for (const act of raw) {
            if (!isSkillAction(act) || act.traits?.includes("downtime")) continue;
            for (const st of statisticList(act.statistic).filter(Boolean)) {
                countBySkill.set(st, (countBySkill.get(st) ?? 0) + 1);
            }
        }

        const entries: SkillEntry[] = Object.entries(skills).map(([slug, s]: [string, any]) => ({
            slug,
            label: String(s?.label ?? slug),
            rank: s?.rank ?? 0,
            mod: s?.mod ?? 0,
            actionCount: countBySkill.get(slug) ?? 0,
        }));

        return rankSkills(entries).map((s): SectorData => ({
            id: `skill:${s.slug}`,
            label: s.label,
            cost: null,
            state: "normal",
            // 修正值与熟练度：玩家最想先看到的就是这两个数
            badge: `${s.mod >= 0 ? "+" : ""}${s.mod} ${rankAbbr(s.rank)}`,
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectSkills 失败", err);
        return [];
    }
}

/**
 * 第二层：某个技能的裸检定 + 它名下的动作。
 *
 * ★ **第一格是裸检定**，直接回应"我就是想掷个巧手"这件事。
 */
export function collectSkillActions(actor: ActorPF2e | null, skillSlug: string): SectorData[] {
    try {
        const a = actor as any;
        const stat = a?.getStatistic?.(skillSlug);
        const out: SectorData[] = [];

        if (stat) {
            out.push({
                id: `skillcheck:${skillSlug}`,
                label: `${stat.label} Check`,
                cost: null,
                state: "normal",
                badge: `${stat.mod >= 0 ? "+" : ""}${stat.mod}`,
            });
        }

        const coll = (game as any).pf2e?.actions;
        for (const act of (coll ? [...coll.values()] : []) as RawAction[]) {
            if (!isSkillAction(act) || act.traits?.includes("downtime")) continue;
            if (!statisticList(act.statistic).includes(skillSlug)) continue;
            out.push({
                id: `action:${act.slug}`,
                label: game.i18n.localize(act.name),
                img: act.img,
                cost: costToSectorCost(act.cost),
                state: "normal",
            });
        }
        return out;
    } catch (err) {
        console.error("player-action-ui-hub | collectSkillActions 失败", err);
        return [];
    }
}
