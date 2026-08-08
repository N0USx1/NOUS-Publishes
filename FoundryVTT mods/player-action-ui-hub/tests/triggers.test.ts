import { describe, it, expect } from "vitest";
import { triggerOf, triggerLine, stripTags, requirementOf, clauseFor, shorten, summaryOf, detailLine } from "../src/triggers";

/** 实测取自 pf2e：Reactive Strike 的描述形状。 */
const 反击 = `<p><strong>Trigger</strong> A creature within your reach uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it's using.</p><hr /><p>You lash out at a foe that leaves an opening.</p>`;

const 援助 = `<p><strong>Trigger</strong> An ally is about to use an action that requires a skill check or attack roll.</p><p><strong>Requirements</strong> You're next to the ally.</p>`;

describe("triggerOf：判据是 Trigger 标记", () => {
    it("取得出触发条件", () => {
        expect(triggerOf(反击)).toBe(
            "A creature within your reach uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it's using.");
    });

    it("★ 不是「取第一段」—— 很多反应开头是风味描述", () => {
        const 风味在前 = `<p>Flavor text first.</p><p><strong>Trigger</strong> Something happens.</p>`;
        expect(triggerOf(风味在前)).toBe("Something happens.");
    });

    it("★ 截到下一个块级标记为止，不把 Requirements 一起吞进来", () => {
        expect(triggerOf(援助)).toBe("An ally is about to use an action that requires a skill check or attack roll.");
    });

    it("★ 没有 Trigger 段就返回 null —— 不兜底编一句", () => {
        // 编一句触发条件比不显示危险：玩家会照着它做决定
        expect(triggerOf(`<p>Just a description.</p>`)).toBeNull();
        expect(triggerOf("")).toBeNull();
        expect(triggerOf(null)).toBeNull();
    });
});

describe("stripTags：保留 @UUID 花括号里的名字", () => {
    it("★ 条件名要留下 —— 整段删掉会让那句话缺主语", () => {
        const s = `A creature attempts a flat check to target you due to you being @UUID[Compendium.pf2e.conditionitems.Item.abc]{Concealed}.`;
        expect(stripTags(s)).toBe("A creature attempts a flat check to target you due to you being Concealed.");
    });

    it("没有花括号的链接整个去掉", () => {
        expect(stripTags(`See @UUID[Compendium.pf2e.x.Item.y] for details.`)).toBe("See for details.");
    });

    it("别的富文本标记同样处理", () => {
        expect(stripTags(`Take @Damage[2d6]{2d6 fire} damage.`)).toBe("Take 2d6 fire damage.");
    });

    it("压掉多余空白", () => {
        expect(stripTags(`<p>a</p>\n\n<p>b</p>`)).toBe("a b");
    });
});

describe("triggerLine：显示用的短句", () => {
    it("短的原样给", () => {
        expect(triggerLine(援助)).toBe("An ally is about to use an action that requires a skill check or attack roll.");
    });

    it("长的截断并加省略号", () => {
        const 出 = triggerLine(反击, 40)!;
        expect(出.length).toBeLessThanOrEqual(40);
        expect(出.endsWith("…")).toBe(true);
    });

    it("没有触发段仍是 null", () => {
        expect(triggerLine(`<p>nothing</p>`)).toBeNull();
    });
});

describe("@Localize 展开（不展开的话每个 NPC 反应都读不到触发条件）", () => {
    // 实测：怪物卡上的能力描述常常整段就是一句引用
    const NPC描述 = `<p>@Localize[PF2E.NPC.Abilities.Glossary.AttackOfOpportunity]</p>`;
    const 词条 = {
        "PF2E.NPC.Abilities.Glossary.AttackOfOpportunity":
            `<p><strong>Trigger</strong> A creature within the monster's reach uses a manipulate action.</p><hr /><p><strong>Effect</strong> The monster attempts a melee Strike.</p>`,
    } as Record<string, string>;
    const 本地化 = (k: string) => 词条[k] ?? k;

    it("★ 不传本地化函数 → 读不到（这正是它静默失效的样子）", () => {
        expect(triggerOf(NPC描述)).toBeNull();
    });

    it("★ 传了就读得到", () => {
        expect(triggerOf(NPC描述, 本地化))
            .toBe("A creature within the monster's reach uses a manipulate action.");
    });

    it("展开后照样只取 Trigger，不把 Effect 吞进来", () => {
        expect(triggerOf(NPC描述, 本地化)).not.toMatch(/Effect/);
    });

    it("键查不到时不炸，也不显示键名本身", () => {
        const 出 = triggerOf(`<p>@Localize[NO.SUCH.KEY]</p>`, (k) => k);
        expect(出).toBeNull();
    });

    it("本地化函数抛错时当作空，不炸盘", () => {
        expect(() => triggerOf(NPC描述, () => { throw new Error("boom"); })).not.toThrow();
    });
});

describe("requirementOf：与触发同源同做法", () => {
    // 实测取自 pf2e 注册表：Trip 的描述（localize 之后）
    const 绊摔 = `<p><strong>Requirements</strong> You have at least one hand free. Your target can't be more than one size larger than you.</p><hr /><p>You try to knock a creature to the ground.</p>`;

    it("取得出要求 —— 设计定档点名的那条", () => {
        expect(requirementOf(绊摔)).toBe(
            "You have at least one hand free. Your target can't be more than one size larger than you.");
    });

    it("★ 单复数都认（实测两种写法都出现过）", () => {
        expect(requirementOf(`<p><strong>Requirement</strong> A free hand.</p>`)).toBe("A free hand.");
    });

    it("没有要求段就是 null", () => {
        expect(requirementOf(`<p>You Stride up to your Speed.</p>`)).toBeNull();
    });
});

describe("clauseFor：一行只放得下一句，放错等于没放", () => {
    const 两者都有 = `<p><strong>Trigger</strong> An ally is about to act.</p><p><strong>Requirements</strong> You're next to the ally.</p>`;

    it("★ 反应优先给触发条件 —— 那才是它在等的东西", () => {
        expect(clauseFor(两者都有, true)).toBe("An ally is about to act.");
    });

    it("主动动作给要求 —— 它没有「什么时候」，只有「能不能」", () => {
        const 只有要求 = `<p><strong>Requirements</strong> You have at least one hand free.</p>`;
        expect(clauseFor(只有要求, false)).toBe("You have at least one hand free.");
    });

    it("★ 反应没有触发段时退回要求，不是直接空着", () => {
        const 只有要求 = `<p><strong>Requirements</strong> You have a shield raised.</p>`;
        expect(clauseFor(只有要求, true)).toBe("You have a shield raised.");
    });

    it("主动动作**不**显示触发段（有些也有，但那不是玩家等的）", () => {
        expect(clauseFor(两者都有, false)).toBe("You're next to the ally.");
    });

    it("两样都没有就是 null", () => {
        expect(clauseFor(`<p>plain</p>`, true)).toBeNull();
        expect(clauseFor(`<p>plain</p>`, false)).toBeNull();
    });
});

describe("★ 截断切在词边界上（Nous 2026-08-07 截图）", () => {
    /*
     * 病历：Take Cover 的要求 93 字符，撞上写死的 90 上限，被硬切成
     *   "...take cover, or are P…"
     * 断在 Prone 的第一个字母上。**一个残缺的单词读起来像渲染坏了**，
     * 而不是"这里还有下文"—— 那正是 Nous 说的"显示出格了"。
     */
    const 要求 = "You are benefiting from cover, are near a feature that allows you to take cover, or are Prone.";

    it("不在单词中间下刀", () => {
        const out = shorten(要求, 90)!;
        expect(out.endsWith("…")).toBe(true);
        // 切出来的最后一个词必须是完整的（去掉省略号后不以半个词结尾）
        expect(/\bP…$/.test(out)).toBe(false);
        expect(要求.startsWith(out.slice(0, -1))).toBe(true);
    });

    it("★ 放宽到毂里真的画得下的长度之后，这句话整段都能显示", () => {
        // HUB_CLAUSE_MAX 由排版反推（3 行 × 20 单位 × 每单位 2 个拉丁字符）
        expect(shorten(要求)).toBe(要求);
    });

    it("切点前的逗号/空格一并去掉，不留一个悬空的标点", () => {
        expect(shorten("alpha beta, gamma delta", 14)).toBe("alpha beta…");
    });

    it("⚠ 整段没有空格时退回硬切 —— 宁可切得难看也不能不截", () => {
        const 长 = "x".repeat(50);
        expect(shorten(长, 10)).toBe("x".repeat(9) + "…");
    });

    it("够短就原样返回", () => {
        expect(shorten("short", 90)).toBe("short");
        expect(shorten(null)).toBeNull();
    });
});

describe("★★ 正文兜底：没有 Trigger / Requirements 的条目也要有说明", () => {
    /*
     * 病历（Nous 2026-08-07）："只有某些有说明其他的都没有。"
     * 实测就是这么回事：注册表 70 条动作里只有 27 条有 Requirements，
     * 而毂里只取那一段 —— 于是大多数格子那一块是空的，
     * 看着像"这功能只对一部分条目生效"。
     */
    const 有标签行 = `<p><strong>Frequency</strong> once per day</p><hr /><p>You channel power into a punch.</p>`;
    const 无标签行 = `<p>You duck behind cover and press yourself flat.</p>`;

    it("★ `<hr>` 之前的标签行不算正文（否则摘要以 Frequency 开头）", () => {
        expect(summaryOf(有标签行)).toBe("You channel power into a punch.");
    });

    it("没有 <hr> 就整段当正文", () => {
        expect(summaryOf(无标签行)).toBe("You duck behind cover and press yourself flat.");
    });

    it("★★ 正文优先 —— 玩家问的是「这东西干嘛的」，不是「够不够格用」", () => {
        // 病历：枪手的 Clear a Path 只显示 "You're wielding a two-handed firearm…"，
        // 而它真正做的事（推开敌人顺便装填）一个字都没显示。
        const 带要求 = `<p><strong>Requirements</strong> You have a hand free.</p><hr /><p>You shove and reload.</p>`;
        expect(detailLine(带要求, false)).toBe("You shove and reload.");
    });

    it("★ 段首挂着标签时**只剥标记不剥内容**", () => {
        // ⛔ 先写成"整段删掉"，Reactive Shield 因此被删空 ——
        //    它的 Requirements 与正文写在同一个 <p> 里。少删永远比多删安全。
        expect(detailLine(`<p><strong>Requirements</strong> A hand free.</p>`, false))
            .toBe("A hand free.");
        const 同段 = `<p><strong>Trigger</strong> X hits you.</p><hr><p><strong>Requirements</strong> You wield a shield. You snap it into place.</p>`;
        expect(detailLine(同段, true)).toBe("You wield a shield. You snap it into place.");
    });

    it("★★ 取**第一个** <hr>，并在下一个 <hr> 处收尾", () => {
        // ⛔ 先写成 lastIndexOf —— Counterspell 有两条分隔线，
        //    于是切到了 Special 那一段，剥完什么都不剩。
        const 两条 = `<p><strong>Trigger</strong> A foe casts.</p><hr><p>You disrupt it.</p><hr><p><strong>Special</strong> Extra note.</p>`;
        expect(detailLine(两条, true)).toBe("You disrupt it.");
    });

    it("正文本来就没有标签行的照常显示", () => {
        expect(detailLine(无标签行, false)).toBe("You duck behind cover and press yourself flat.");
    });

    it("⚠ **反应也走正文**（Nous 说的「全局」）—— 触发条件退到完整说明里", () => {
        expect(detailLine(反击, true)).toMatch(/^You lash out at a foe/);
    });

    it("空描述给 null（不编一句话填空）", () => {
        expect(summaryOf("")).toBeNull();
        expect(summaryOf(null)).toBeNull();
        expect(detailLine("", false)).toBeNull();
    });

    it("正文太长照旧在词边界截断", () => {
        const 长 = `<p>${"alpha beta gamma ".repeat(20)}</p>`;
        const 出 = detailLine(长, false)!;
        expect(出.endsWith("…")).toBe(true);
        expect(出.length).toBeLessThanOrEqual(120);
    });
});
