/**
 * 反应的**触发条件**（丙类第一件能做的事，2026-08-05）。
 *
 * ★ **为什么做这个而不是自动反应窗口**（实测定的边界，见
 *   `docs/2026-08-05-丙类调研-跨角色与反应.md`）：
 *
 *   `pf2e.actionspf2e` 全包实测：105 个反应，**0 个**用规则元素表达触发条件，
 *   而 **99 个（94%）** 在描述里有 `Trigger` 段。
 *   `Reactive Strike` 就是典型：`rules: []`，触发条件只在正文里。
 *
 *   → **自动判断时机做不到**（那要为 105 条各写一份判据 = 把规则书抄进代码，
 *     正是本模组明确不做的事）；
 *   → 但**把那句话显示出来**推得出来，而且**对全职业通用、一条映射都不用写**。
 *
 *   与"图标走 grantedBy 链"是同一形状：东西早在数据里，只是没去取那一环。
 *
 * ★ 价值判据也对得上定位：玩家卡住的不是"找不到反击按钮"，
 *   而是**"我现在到底能不能反击"** —— 那句话就写在条目里，从来没人显示给他。
 *
 * ⚠ **解析不出来就不显示**，不兜底编一句（实测有 6 条解析不出）。
 *   编一句触发条件比不显示危险得多：玩家会照着它做决定。
 */

/**
 * 展开 `@Localize[键]` 引用。
 *
 * ★★ **不展开的话，每一个 NPC 反应都读不到触发条件**（2026-08-05 实测发现）：
 *   怪物卡上的招牌能力描述常常整段就是一句引用 ——
 *   `<p>@Localize[PF2E.NPC.Abilities.Glossary.AttackOfOpportunity]</p>`，
 *   真正的 `Trigger` 段在那个键后面。
 *   而它**不报错**：解析不出触发条件与"这条本来就没有触发条件"长得一模一样。
 *
 * ⚠ 本地化函数**由外部注入**，这个模块保持不依赖 Foundry（才能单测）。
 *   注入的是 `game.i18n.localize`。
 *
 * ⚠ 只展开一层：引用套引用没见过，真出现了宁可少显示也不要写个可能不收敛的循环。
 */
export function expandLocalize(html: string, localize?: (key: string) => string): string {
    if (!localize) return html;
    return String(html).replace(/@Localize\[([^\]]+)\]/g, (_, key) => {
        try { return localize(String(key)) ?? ""; } catch { return ""; }
    });
}

/**
 * 从描述 HTML 里取出 `Trigger` 段。
 *
 * ⚠ 判据是 `<strong>Trigger</strong>` 这个标记，**不是"第一段文字"** ——
 *   很多反应正文开头是风味描述，取第一段会显示一句与时机无关的话。
 *
 * ⚠ 截断到下一个块级标记为止（`</p>` / `<hr` / 下一个 `<strong>`）：
 *   不截的话会把后面的 `Effect` 段一起吞进来。
 *
 * ⚠ **长度上限量的是原始 HTML，不是人看到的字数**（2026-08-05 查出来的）：
 *   触发条件里常塞好几个 `@UUID[Compendium.pf2e.conditionitems.Item.xxx]{Grabbed}`，
 *   一个链接就 ~70 字符原文。上限原本设 300，于是
 *   Mist Blending / Liberating Step / Swift Choreography / Smoke Blending / Set Free
 *   这些**触发条件较长的**全都匹配不到收尾 —— 看起来像"这几条数据格式不同"，
 *   实际上**是我自己的上限造成的**。给显示用的截断在 `shorten()` 里，这里只要防跑飞。
 */
export function triggerOf(
    descriptionHtml: string | null | undefined,
    localize?: (key: string) => string,
): string | null {
    const html = expandLocalize(String(descriptionHtml ?? ""), localize);
    const m = html.match(/<strong>\s*Trigger\s*<\/strong>\s*([\s\S]{0,1200}?)(<\/p>|<hr|<strong)/i);
    if (!m) return null;
    const 文 = stripTags(m[1]);
    return 文 ? 文 : null;
}

/**
 * 去掉标签与 pf2e 的富文本标记，留下人话。
 *
 * ⚠ `@UUID[...]{名字}` 要保留**花括号里的名字**：
 *   实测触发条件里常引用条件（"due to you being @UUID[...]{Concealed}"），
 *   整段删掉会让那句话缺主语；只删链接语法就正好。
 */
export function stripTags(html: string): string {
    return String(html)
        // @UUID[...]{显示名} → 显示名；没有花括号的退回取最后一段 id
        .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1")
        .replace(/@UUID\[[^\]]+\]/g, "")
        // @Damage[...]{名} / @Check[...] 之类同理
        .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
        .replace(/@\w+\[[^\]]*\]/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * 从描述里取出 `Requirements` 段。
 *
 * ★ **与触发条件同源、同做法**（2026-08-05 实测）：
 *   `game.pf2e.actions` 注册表 70 条里 **27 条**有 Requirements；
 *   `pf2e.actionspf2e` 全包 574 条里 **143 条（25%）**有。
 *   样例正是玩家最容易忘的那类：
 *   Trip *"You have at least one hand free"*、
 *   Treat Wounds *"You're wearing or holding a Healer's Toolkit"*、
 *   Reap the Field *"Your previous action was a successful Strike"*。
 *
 * ★ 这是③段「条件灰显」的**可推导那一半**：
 *   谓词求值（判断满不满足）很难且容易算错，
 *   但**把要求摆到眼前**推得出来，且零映射、全职业通用。
 *   先做能证明的那一半，不要为了做完整个功能去猜另一半。
 *
 * ⚠ 复数形式两种都要认：实测 `Requirements` 与 `Requirement` 都出现过。
 */
export function requirementOf(
    descriptionHtml: string | null | undefined,
    localize?: (key: string) => string,
): string | null {
    const html = expandLocalize(String(descriptionHtml ?? ""), localize);
    const m = html.match(/<strong>\s*Requirements?\s*<\/strong>\s*([\s\S]{0,1200}?)(<\/p>|<hr|<strong)/i);
    if (!m) return null;
    const 文 = stripTags(m[1]);
    return 文 ? 文 : null;
}

/**
 * 一个条目该在毂里显示哪一句。
 *
 * ★ **反应优先显示触发条件**：那是它在等的东西。
 *   主动动作显示要求 —— 它没有"什么时候"，只有"能不能"。
 * ⚠ 实测 27 条两者都有；反应仍以触发为主，要求退居其次，
 *   一行只放得下一句，放错那句等于没放。
 */
export function clauseFor(
    descriptionHtml: string | null | undefined,
    isReaction: boolean,
    localize?: (key: string) => string,
): string | null {
    return isReaction
        ? triggerOf(descriptionHtml, localize) ?? requirementOf(descriptionHtml, localize)
        : requirementOf(descriptionHtml, localize);
}

/**
 * 毂里那几行**一共**放得下多少字符。
 *
 * ★ 由排版反推，不是拍的（`wheel-app.ts`：3 行 × `HUB_DETAIL_UNITS` 单位，
 *   拉丁字符每单位 2 个）。原来写死 90 —— 比排版放得下的少了三分之一，
 *   于是 Take Cover 的要求明明画得下，却先被截断器切掉了。
 * ⚠ 改这个数之前先改排版那两个常量，否则截出来的会顶出毂外。
 */
export const HUB_CLAUSE_MAX = 114;

/** 显示用的短句：太长就截断，毂里放不下整段规则。 */
export function shorten(text: string | null, max = HUB_CLAUSE_MAX): string | null {
    if (!text) return null;
    if (text.length <= max) return text;
    /*
     * ⚠ **在词边界上切**（Nous 2026-08-07 截图："take cover（这个好像显示出格了）"）。
     *   原来是硬切第 89 个字符，于是 Take Cover 的要求被切成
     *   `"...take cover, or are P…"` —— 断在 `Prone` 的第一个字母上。
     *   一个残缺的单词读起来像渲染坏了，而不是"这里还有下文"。
     * ⚠ 整段找不到空格（长 URL、CJK）时退回硬切：宁可切得难看，也不能不截。
     */
    const 硬切 = text.slice(0, max - 1);
    const 空格 = 硬切.lastIndexOf(" ");
    const 切点 = 空格 > max * 0.6 ? 空格 : 硬切.length;
    return text.slice(0, 切点).replace(/[\s,;:]+$/, "") + "…";
}

export function triggerLine(
    descriptionHtml: string | null | undefined,
    max = HUB_CLAUSE_MAX,
    localize?: (key: string) => string,
): string | null {
    return shorten(triggerOf(descriptionHtml, localize), max);
}

/** 反应给触发、主动给要求，截断到一行。 */
export function clauseLine(
    descriptionHtml: string | null | undefined,
    isReaction: boolean,
    max = HUB_CLAUSE_MAX,
    localize?: (key: string) => string,
): string | null {
    return shorten(clauseFor(descriptionHtml, isReaction, localize), max);
}

/**
 * **正文摘要** —— 没有 Trigger / Requirements 那一段时用它兜底。
 *
 * ★ 起因（Nous 2026-08-07）："只有某些有说明其他的都没有。"
 *   实测就是这么回事：`clauseFor` 只取那两段，而**绝大多数条目一段都没有**
 *   （注册表 70 条里只有 27 条有 Requirements）。
 *   于是毂里那一块对大多数格子是空的 —— 看着像"这功能只对一部分条目生效"。
 *
 * ★ 兜底取的是**条目自己的正文**，不是我们编的话。判据分两步：
 *   ① `<hr>` 之后才是正文 —— pf2e 的惯例是把 Frequency / Trigger / Requirements
 *      这些"标签行"放在 `<hr>` 前面。不切的话摘要会以 "Frequency once per day" 开头。
 *   ② 没有 `<hr>` 就整段用。
 *
 * ⚠ **不与 clause 拼在一起**：一格只放得下三行，
 *   拼起来的结果是两句都被切一半。有专用那句就用专用的 —— 它更要紧。
 */
export function summaryOf(
    descriptionHtml: string | null | undefined,
    localize?: (key: string) => string,
): string | null {
    const html = expandLocalize(String(descriptionHtml ?? ""), localize);
    if (!html.trim()) return null;
    /*
     * pf2e 的描述惯例（2026-08-07 逐条实读定的，三条都踩过）：
     *
     *   <p><strong>Trigger</strong> …</p>      ← 标签行
     *   <hr>
     *   <p>正文…</p>                            ← 要的就是这一段
     *   <hr>
     *   <p><strong>Special</strong> …</p>      ← 附注，不要
     *
     * ① ⚠ **取第一个 `<hr>` 不是最后一个**。我先写的是 `lastIndexOf` ——
     *   Counterspell 有两条分隔线，于是切到了 Special 那一段，
     *   剥完标签什么都不剩，又退回去显示 Trigger。看起来像"这条没做"。
     */
    const i = html.indexOf("<hr");
    let 正文 = i >= 0 ? html.slice(html.indexOf(">", i) + 1) : html;
    // ② 后面还有分隔线就到此为止（那之后是 Special 之类的附注）
    const j = 正文.indexOf("<hr");
    if (j >= 0) 正文 = 正文.slice(0, j);
    /*
     * ③ ⚠⚠ 段首若还挂着一个标签，**只剥那个粗体标签，别删整段**。
     *   我先写的是"整段删掉"，结果 Reactive Shield 被删空了 ——
     *   它的 `Requirements` 与正文**写在同一个 `<p>` 里**：
     *   `<p><strong>Requirements</strong> You are wielding a shield. You can snap…</p>`
     *   删整段等于把正文一起丢了，而它不报错，只是又退回 Trigger。
     *   ★ 判据改成"剥标记不剥内容" —— 少删永远比多删安全。
     */
    正文 = 正文.replace(/^(\s*<p>\s*)<strong>[^<]*<\/strong>/i, "$1");
    const 文 = stripTags(正文);
    return 文 ? 文 : null;
}

/**
 * 毂里那一块该显示什么：**正文优先，标签行兜底**。
 *
 * ★★ **顺序 2026-08-07 反过来了**（Nous 拿枪手的 Clear a Path 抓到的）：
 *
 *   | | 原来显示 | 现在显示 |
 *   |---|---|---|
 *   | Clear a Path | "You're wielding a two-handed firearm or two-handed crossbow." | "You push outward with your weapon to clear some space before quickly reloading…" |
 *
 *   ★ 病根：`Requirements` 答的是"**够不够格用**"，而玩家在轮盘上看这一块时
 *     问的是"**这东西是干嘛的**"。前者只在他已经知道后者之后才有意义。
 *   ★ Nous 的话："这个需要做成全局的用正文 `<hr>` 部分吧。"
 *
 * ⚠ **对反应也一样**（"全局"就是全局）。代价说清楚：
 *   反应原来显示 `Trigger`（"什么时候能用"），那是丙类调研的成果之一。
 *   现在改成正文之后，"什么时候"要点开完整说明才看得到。
 *   要单独把反应留给 Trigger 是一行的事 —— 但那由 Nous 决定，不是我顺手改回去。
 *
 * ⚠ 没有正文才退回标签行：有些条目**整条就只有一行 Requirements**，
 *   那时显示它总比一片空白强。
 */
export function detailLine(
    descriptionHtml: string | null | undefined,
    isReaction: boolean,
    max = HUB_CLAUSE_MAX,
    localize?: (key: string) => string,
): string | null {
    return shorten(summaryOf(descriptionHtml, localize)
                   ?? clauseFor(descriptionHtml, isReaction, localize), max);
}
