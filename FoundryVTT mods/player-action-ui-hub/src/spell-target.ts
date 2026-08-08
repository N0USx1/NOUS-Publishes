/**
 * 施法前**先选目标**（Nous 2026-08-08）。
 *
 * > "spell 类型比如 electric arc：需要选择对象的我没有做级联 ui 选择，
 * >  或者是跳过此选择、确认按键。haste／治疗之类 buff/debuff 也没有做对象选择确认。
 * >  ……我们不要选择当前已经选择的对象，要在 ui 展开去强制选择
 * >  （要不然就搞错了浪费 spell 出错难以恢复）并确认才能生效跑色子。"
 *
 * ★★ 这一条的分量不在"多一层界面"，而在**代价不对称**：
 *   点错一个目标 = 一个法术位没了，而法术位要休息才回来。
 *   多按一次确认的代价是一次点击；不确认的代价是**一整个资源 + 一段没法回滚的战斗状态**。
 *   ⇒ 这正是「沉的东西该有惯性」那条（UI playbook 〇·六）：宁可笨拙，不可被碰倒。
 *
 * ⚠ **判据只用引擎字段，不解析英文**：目标文本是给人读的
 *   （`"1 or 2 creatures"`、`"1 willing living creature or 1 undead"`），
 *   而且会跟着语言包变。拿正则去抠数量，等于把规则抄一份进来，那份迟早分叉。
 *   ⇒ 我们只答"**要不要选**"，"能选几个"交给玩家按规则判断（提示不是锁，playbook 13）。
 */

/** 这个法术施放前该怎么处理目标。 */
export type SpellTargeting =
    /** 不用选：自身法术，或系统没给目标字段 */
    | "none"
    /** 要选：单体/少数几个目标的法术（electric arc / haste / heal / slow…） */
    | "pick"
    /** 范围法术：目标由模板圈定，**不在轮盘里逐个点** */
    | "area";

/** `targetingOf` 只认这一点形状，方便单测。 */
export interface SpellLike {
    system?: {
        target?: { value?: string } | null;
        area?: { type?: string; value?: number } | null;
        range?: { value?: string } | null;
    } | null;
}

/**
 * 判这个法术要不要在轮盘里选目标。
 *
 * 实测三个字段就够（2026-08-08 读 pf2e.spells-srd 的真条目）：
 *
 * | 法术 | `target.value` | `area` | `range.value` | ⇒ |
 * |---|---|---|---|---|
 * | Electric Arc | `1 or 2 creatures` | — | `30 feet` | **pick** |
 * | Haste / Slow | `1 creature` | — | `30 feet` | **pick** |
 * | Heal | `1 willing living creature or 1 undead` | — | `varies` | **pick** |
 * | Fireball | `` | `burst 20` | `500 feet` | **area** |
 * | Bless | `you and allies in the area` | `emanation 15` | `` | **area** |
 * | Shield | `` | — | `` | **none** |
 *
 * ★ **`area` 优先**：Bless 的目标文本写着 "you and allies"，但它是个光环 ——
 *   目标由模板圈定，逐个点反而会点出一份和模板不一致的名单。
 * ★ **没有射程 ⇒ 作用在自己身上**（Shield）：这比去读目标文本里有没有 "you" 可靠，
 *   `range` 是结构化字段，`target` 是散文。
 * ⚠ 顺序不能反：先判 area，再判空目标，最后判空射程。
 *   反过来 Bless（target 非空、range 空）会掉进 none，模板就不放了。
 */
export function targetingOf(spell: SpellLike | null | undefined): SpellTargeting {
    const sys = spell?.system;
    // 范围法术：pf2e 自己会让你放模板，别在这儿逐个点
    if (sys?.area) return "area";
    const target = String(sys?.target?.value ?? "").trim();
    if (!target) return "none";
    const range = String(sys?.range?.value ?? "").trim();
    if (!range) return "none";          // 有目标描述却没有射程 ⇒ 只作用于自己
    return "pick";
}

/** 选目标那一层里，「就这样施放」那一格的 id 前缀。 */
export const CAST_PREFIX = "cast:";

/**
 * 把法术扇区 id 换成"确认施放"格的 id。
 *
 * ⚠ 两个 id **只差前缀**，后面那几段原样保留 —— 施放时按同一套解析，
 *   不需要另存一份"待施放的法术"状态。
 *   ★ 少一处状态就少一处会和界面不同步的东西（2026-08-08 的装填 bug 就是
 *     id 解析和真实数据对不上，见 collectors/strikes 的 `ammoSectorId`）。
 * ⚠ `spell:` 的各段（entryId/spellId/rank/slot）都是无冒号的定长片段，
 *   所以这里可以整段搬。
 */
export function castSectorId(spellSectorId: string): string {
    return CAST_PREFIX + spellSectorId.slice("spell:".length);
}

/** 反过来：从确认格 id 取回 `spell:` 那一串。 */
export function spellSectorIdOf(castId: string): string | null {
    if (!castId.startsWith(CAST_PREFIX)) return null;
    const rest = castId.slice(CAST_PREFIX.length);
    return rest ? `spell:${rest}` : null;
}

/** 「投几个动作」那一层里，每个数量格的 id 前缀。 */
export const ACTS_PREFIX = "acts:";

/**
 * 数量格的 id：`acts:<n>:<spell id 去掉 spell: 之后那一串>`。
 *
 * ⚠ 与 `castSectorId` 同一套规矩：**变长的那段放中间，定长的放两端**。
 *   这里 `n` 是一位数字（定长）放最前，spell 的各段跟在后面。
 *   ⛔ 别用固定下标解构 —— `strike:`/`spell:` 那两次都是这么错的。
 */
export function actsSectorId(n: number, spellSectorId: string): string {
    return `${ACTS_PREFIX}${n}:${spellSectorId.slice("spell:".length)}`;
}

/** 解回 `{ n, spellSectorId }`；不是这种 id 就返回 null。 */
export function parseActsSectorId(id: string): { n: number; spellSectorId: string } | null {
    if (!id.startsWith(ACTS_PREFIX)) return null;
    const rest = id.slice(ACTS_PREFIX.length);
    const cut = rest.indexOf(":");
    if (cut <= 0) return null;
    const n = Number(rest.slice(0, cut));
    const 尾 = rest.slice(cut + 1);
    if (!Number.isFinite(n) || n < 1 || !尾) return null;
    return { n, spellSectorId: `spell:${尾}` };
}
