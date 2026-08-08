import { PAGE_SIZE } from "./paging";

/**
 * **法术按环分页** —— 一页就是一环，和角色卡上那几栏一一对应。
 *
 * ★ 起因（Nous 2026-08-08，拿术士测出来的）：
 *   > "比如她每个 rank 的法术有 4 个格位，但是我们的 ui 没有做法术等级的分切
 *   >  （用第几环的 slot 发动）。比如 Grim Tendrils 她每个等级的都有。"
 *
 * ★★ **两条路里选了"每环一页"**（Nous 定："这样和角色表单上面一模一样"）。
 *   另一条是"法术只列一次 → 点了再问用第几环"。放弃它的理由：
 *   术士**几乎每个法术都能升环**，于是"只在有选择时才问"这条优化根本不生效，
 *   等于每次施法都多一次点击 —— 而轮盘相对角色卡唯一的结构优势就是少动几下。
 *   ★ 更要紧的一条：选环真正的输入是"**这一环还剩几个位**"，
 *     按环分页能把那个数印在你做决定的地方；问答式要等你点进去才看得到。
 *
 * ★★ **分组照角色卡搬，不自己算提升**：
 *   `entry.getSheetData()` 的 `groups` 就是卡上那几栏，实测（术士 Seoni）：
 *
 *   | 组 | 位 | Grim Tendrils |
 *   |---|---|---|
 *   | cantrips | — | — |
 *   | 1st Rank | 4/4 | 本体 |
 *   | 2nd Rank | 4/4 | `castRank:2` `virtual:true` |
 *   | 3rd Rank | 3/3 | `castRank:3` `virtual:true` |
 *
 *   三处**同一个 spellId**。所以"能用哪几环"= 它出现在哪几组，一条规则都不用写。
 *   而自己按"角色最高环"推会漏掉签名法术，也对不上准备位施法者那套完全不同的形状。
 *
 * ★ 两类施法者在这套数据下自然分开，**不需要认施法者类型**：
 *   自选的同一个法术出现在多组；准备位的每个位是各自的条目、`castRank` 固定。
 *
 * ⚠ `getSheetData()` 是异步的，而采集器是同步的 —— 与 `sheet-actions.ts` 同一套办法：
 *   呼出轮盘时取一次缓存起来，采集器同步读。
 */

/** 一页（= 一环）里的一条法术。 */
export interface SpellSlotEntry {
    spellId: string;
    name: string;
    img?: string;
    actionGlyph?: string;
    /** 实际按几环施放 */
    castRank: number;
    /** 在这一组 `active` 里的下标 —— 准备位施法要靠它认是哪个位 */
    slotIndex: number;
    /** 法术描述原文（毂里那几行由它来） */
    description?: string;
    /** 点开完整说明用 */
    uuid?: string;
    /**
     * 这个位**已经用掉了**吗。
     *
     * ★★ 用掉的位**照样列出来，只是置灰**（Nous 2026-08-08）：
     *   > "用掉的就直接消失了，这个应该置灰保留，按照原来的 sheet 点击弹窗无效，
     *   >  我们那个红框置灰也应该做到一样的效果。"
     *   ★ 角色卡的做法就是**划线保留**（截图里 Force Barrage / Acid Grip）。
     *     整条抽走会让这一页的格数忽多忽少 —— 玩家的手要重新找位置，
     *     而且"少了一格"和"我记错了"分不出来（playbook 一：格数不变、宽度可变）。
     */
    expended: boolean;
}

/** 一页。 */
export interface SpellPage {
    /** 卡上那个组标签，如 `2nd Rank` */
    label: string;
    /** 这一环还剩几个位；戏法与准备位没有这个数 */
    badge?: string;
    entries: SpellSlotEntry[];
}

/** `getSheetData().groups` 里一组的最小形状。 */
export interface GroupLike {
    id: number | string;
    label?: string;
    uses?: { value?: number; max?: number };
    maxRank?: number;
    active?: (null | {
        spell?: {
            id?: string; name?: string; img?: string; actionGlyph?: string; rank?: number;
            uuid?: string; system?: { description?: { value?: string } };
        };
        castRank?: number;
        expended?: boolean;
        virtual?: boolean;
    })[];
}

const 缓存 = new Map<string, GroupLike[]>();
const 键 = (actorId: string, entryId: string) => `${actorId}::${entryId}`;

/**
 * 取一次全部施法条目的分组并缓存。**在呼出轮盘那一步 await 它**。
 * ⚠ 取不到就删缓存，采集器走退化路径（按 `entry.spells` 平铺，见 collectors/spells.ts）。
 */
export async function primeSpellGroups(actor: unknown): Promise<void> {
    const a = actor as any;
    const actorId = a?.id;
    if (!actorId) return;
    for (const entry of (a?.spellcasting?.contents ?? [])) {
        const k = 键(actorId, entry.id);
        try {
            const sd = await entry.getSheetData?.({});
            if (sd?.groups) 缓存.set(k, sd.groups as GroupLike[]);
            else 缓存.delete(k);
        } catch {
            缓存.delete(k);
        }
    }
}

/** 读缓存；没有返回 null。 */
export function spellGroupsOf(actor: unknown, entryId: string): GroupLike[] | null {
    const actorId = (actor as any)?.id;
    return actorId ? (缓存.get(键(actorId, entryId)) ?? null) : null;
}

/** 换角色/角色数据变了就清掉。 */
export function clearSpellGroups(): void { 缓存.clear(); }

/** 组标签：本地化 key 就 localize，已经是人话就原样。 */
function 组名(g: GroupLike, localize?: (k: string) => string): string {
    const raw = String(g.label ?? g.id ?? "");
    return /^PF2E\./.test(raw) && localize ? (localize(raw) || raw) : raw;
}

/**
 * 把卡上的分组变成一页一环。
 *
 * ⛔ **用完的不再抽走，改成置灰保留**（Nous 2026-08-08）——两处都改了：
 *   ① 单条用掉的位（准备位的 `expended`）：标记出来，交给采集端置灰；
 *   ② 整环用完（`uses.value <= 0`）：这一页**照样出现**，里面的位全是灰的。
 *   ★ 理由同角色卡：它对用掉的法术是**划线保留**，不是删掉。
 *     抽走会让页数和格数随用量变化，玩家每施一次法就要重新找位置。
 *   ⚠ 戏法与准备位**没有** `uses.value` —— 缺这个字段一律当"能用"，
 *     当成 0 会把所有戏法整页判成用完（而且不报错）。
 * ⚠ 一组超过一页放得下的还要再切 —— 高环法术多的角色会碰到。
 *   切出来的第二页**沿用同一个环标签**：它还是那一环，不是新的一环。
 */
export function spellPages(groups: GroupLike[], localize?: (k: string) => string): SpellPage[] {
    const out: SpellPage[] = [];
    for (const g of groups ?? []) {
        // ★ 整环用完 ⇒ 这一页照出，里面每个位都算用掉了（见上面那段）
        const 整环用完 = g.uses?.value !== undefined && Number(g.uses.value) <= 0;
        const entries: SpellSlotEntry[] = [];
        (g.active ?? []).forEach((slot, i) => {
            const sp = slot?.spell;
            if (!slot || !sp?.id) return;
            entries.push({
                expended: 整环用完 || !!slot.expended,
                spellId: sp.id,
                name: String(sp.name ?? "?"),
                img: sp.img,
                actionGlyph: sp.actionGlyph,
                castRank: Number(slot.castRank ?? sp.rank ?? g.maxRank ?? 1),
                slotIndex: i,
                description: sp.system?.description?.value,
                uuid: sp.uuid,
            });
        });
        if (!entries.length) continue;
        const badge = g.uses?.value !== undefined && Number.isFinite(Number(g.uses.max))
            ? `◈ ${Number(g.uses.value)}/${Number(g.uses.max)}` : undefined;
        const label = 组名(g, localize);
        for (let k = 0; k < entries.length; k += PAGE_SIZE) {
            out.push({ label, badge, entries: entries.slice(k, k + PAGE_SIZE) });
        }
    }
    return out;
}

/** 点阵图的一列：一个环。 */
export interface SlotColumn {
    /** 卡上那个组标签，用来对上当前页 */
    label: string;
    /** 还剩几个位 */
    value: number;
    /** 一共几个位 */
    max: number;
}

/**
 * **奥术电池点阵图**的数据（Nous 2026-08-08 定的形态）：
 *
 * > "纵是剩余 slot 的点 —— 等于 4 就显示 4 个点，大于上面还在加一个 `^`；
 * >  横就是角色有的环数量，然后点阵图下方写 spell slots。"
 * > "用掉了的 slot 之后就置灰。"
 *
 * ★ 一列一环、一点一位，**用掉的留在原地变灰** —— 于是一眼同时读到
 *   "这一环一共几个"和"还剩几个"，而这两个数正是选环时要比的。
 *   ⚠ 只画剩下的（不留灰点）就只剩一半信息：4 个点是"满的 4 环"还是"剩 4 的 6 环"分不出来。
 *
 * ⚠ **戏法不进点阵**：它无限次，画一列永不减少的点是纯噪音。
 *   判据用组 id（系统给的 `"cantrips"`），不靠名字猜。
 * ⚠ 准备位施法者**没有 `uses.value`** —— 他们按位记 `expended`。
 *   所以剩余数是 `uses.value ?? 数一遍没用掉的位`；只认前者会让所有准备位角色的点阵全空。
 */
export function slotMatrix(groups: GroupLike[]): SlotColumn[] {
    const out: SlotColumn[] = [];
    for (const g of groups ?? []) {
        if (g.id === "cantrips") continue;
        const max = Number(g.uses?.max ?? 0);
        if (!Number.isFinite(max) || max <= 0) continue;
        const 剩 = g.uses?.value !== undefined
            ? Number(g.uses.value)
            : (g.active ?? []).filter(s => s && !s.expended).length;
        out.push({ label: String(g.label ?? g.id), value: Math.max(0, Math.min(max, 剩)), max });
    }
    return out;
}
