/**
 * 游戏内冒烟测试。
 *
 * ★ 存在的理由（2026-08-05 一次真实故障）：
 *   改 `module.json` 时写进了 UTF-8 BOM，Foundry 直接跳过整个模组 ——
 *   而 `npm run guard` **三项全绿**（tsc/esbuild/vitest 根本不读 module.json）、
 *   git 正常、PowerShell 也解析得了那个 JSON。
 *   **没有任何一层在问"它在 Foundry 里还活着吗"**，于是模组静默消失。
 *   下面第一组就是补这个洞。
 *
 * 跑法：先起 Foundry 与项目专用浏览器并登录世界，然后 `npm run test:e2e`。
 */
import { readFileSync } from "node:fs";
import { evaluate, check, section, report, PRELUDE } from "./cdp.mjs";

const 期望分类 = ["Strikes", "Actions", "Skills", "Class", "Spells", "Reactions"];

/* ── -1. 先重载页面，保证测的是**刚构建出来的** bundle ────
 *
 * ★ 这一步是**测试自己的职责**，不该靠人记得按 F5：
 *   Foundry 不会自动重载模组代码，改完 `npm run build` 之后页面里跑的还是旧的。
 *   忘了重载时的失败长得完全不像"忘了重载" ——
 *   实测报的是 `T.triggerOf is not a function`，看着像导出漏了。
 *
 * ⚠ `location.reload()` 会把执行上下文销毁，那次调用**必然抛错**，catch 掉是正常的。
 */
await evaluate(`window.location.reload(); return 1;`).catch(() => {});
{
    let 就绪 = false;
    for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const r = await evaluate(`return game?.ready === true && !!window.pauih?._test;`).catch(() => null);
        if (r === true) { 就绪 = true; break; }
    }
    if (!就绪) {
        console.error("页面重载后等不到世界就绪 —— 确认 Foundry 起着、浏览器登进了世界。");
        process.exit(1);
    }
}

/* ── 0. 清掉上一次被中断留下的东西 ──────────────
 *
 * ⚠ 造临时角色的那几组用 `finally` 删，但**进程被强杀时 finally 不会跑**。
 *   残角色会一直留在用户的世界里；卡片窗口还会挡住下一次运行的脚本
 *   （2026-08-05 实撞：一个 ikon 卡片开着，整套 e2e 在第 3 组超时 240 秒）。
 */
await evaluate(`
for (const a of game.actors.filter(a => a.name.startsWith("PAUIH temp"))) { await a.delete(); }
for (const app of foundry.applications?.instances?.values?.() ?? []) { try { app.close(); } catch {} }
return 1;
`);

/* ── 1. 模组还活着吗（BOM 那类故障的守卫）────────── */
section("模组加载");
const 模组 = await evaluate(`
${PRELUDE}
const m = game.modules.get("player-action-ui-hub");
return { 存在: !!m, active: !!m?.active, 版本: m?.version ?? null,
         全局入口: typeof window.pauih,
         manifest可解析: !!m?.title };
`);
if (模组.__error) { console.error(模组.__error); process.exit(1); }
check("模组被 Foundry 识别", 模组.存在, true);
check("模组已启用", 模组.active, true);
check("manifest 解析成功（BOM 会让这条挂）", 模组.manifest可解析, true);
check("暴露了全局入口", 模组.全局入口, "object");

/* ── 2. 轮盘能呼出、分类完整 ──────────────────── */
section("呼出与分类层");
const 分类 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
const out = {
  分类: app.level.sectors.map(s => s.label),
  态: app.level.sectors.map(s => s.state),
  图标数: root().querySelectorAll("image.pauih-icon").length,
  退回文字数: root().querySelectorAll("text.pauih-label").length,
  毂内: [...root().querySelectorAll(".pauih-hub-text text")].map(t => t.textContent),
};
inst()?.close?.();
return out;
`);
check("Ctrl+左键能呼出", !分类.呼出失败, true, "呼得出来");
check("分类齐全且顺序不变", 分类.分类, v => JSON.stringify(v) === JSON.stringify(期望分类), 期望分类.join("/"));
check("分类层全部走图标（不退回文字）", 分类.退回文字数, 0);
check("图标数 = 分类数", 分类.图标数, 期望分类.length);

/* ── 3. 每个分类都能下钻 ──────────────────────── */
section("下钻");
const 下钻 = await evaluate(`
${PRELUDE}
const out = {};
// ⚠ 下标从**分类常量**推，别写死 —— 加一格分类时写死的那份会静默漏测它
for (let i = 0; i < ${期望分类.length}; i++) {
  const app = await 呼出();
  if (!app) { out["第" + i + "格"] = "呼不出轮盘"; continue; }
  const 名 = app.level.sectors[i].label;
  const 空 = app.level.sectors[i].state === "gated";
  if (空) { out[名] = "空分类(灰显)"; inst()?.close?.(); continue; }
  const 原层 = app.level.title;
  clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), 名);
  // ⚠ 等"层真的换了"，不是等固定毫秒 —— 慢的层（Skills 有 17 个技能）画不完会假失败
  await 等到(() => inst() && inst().level.title !== 原层);
  out[名] = inst() ? { 层: inst().level.title, 条数: inst().level.sectors.length } : "下钻后盘没了";
  inst()?.close?.();
}
return out;
`);
for (const 名 of 期望分类) {
    const v = 下钻[名];
    check(`${名} 能下钻`, v, x => typeof x === "object" ? x.条数 > 0 : String(x).includes("空分类"),
          "进得去且有内容，或本来就是空分类");
}

/* ── 4. 图标路径不能是破图 ────────────────────── */
section("图标可解析");
const 图标 = await evaluate(`
${PRELUDE}
const 路径 = new Set();
for (let i = 0; i < ${期望分类.length}; i++) {
  const app = await 呼出();
  if (!app) continue;
  if (app.level.sectors[i].state === "gated") { inst()?.close?.(); continue; }
  app.level.sectors.forEach(s => s.img && 路径.add(s.img));
  clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "分类" + i);
  await wait(800);
  if (inst()) inst().level.sectors.forEach(s => s.img && 路径.add(s.img));
  inst()?.close?.(); await wait(400);
}
const 坏 = [];
for (const p of 路径) {
  const r = await fetch("/" + p, { method: "HEAD" });
  if (!r.ok) 坏.push(p + " → " + r.status);
}
return { 检查数: 路径.size, 坏路径: 坏 };
`);
check("没有破图（路径写错不会报错，只会渲染成破图）", 图标.坏路径, v => v.length === 0, "坏路径为空");
check("确实检查到了图标", 图标.检查数, v => v > 10, "> 10 个");

/* ── 5. 打击真的能掷出骰子 ────────────────────── */
section("执行：打击");
const 打击 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "Strikes");
await wait(900);
if (!inst()) return { 进不去打击层: true };
const before = game.messages.size;
const 名 = inst().level.sectors[0].label;
clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), 名);
await wait(2500);
const last = game.messages.contents.at(-1);
const out = { 打击名: 名, 新消息: game.messages.size - before,
  公式: last?.rolls?.[0]?.formula ?? null, 暗骰: last?.blind ?? null,
  加值框: document.querySelectorAll(".roll-modifiers-dialog").length };
inst()?.close?.();
return out;
`);
check("掷出了骰子", 打击.新消息, 1);
check("公式是 d20 检定", 打击.公式, v => /^1d20/.test(String(v)), "1d20 + …");
check("★ 不是暗骰（呼出用的 Ctrl 会被 pf2e 读成暗骰开关）", 打击.暗骰, false);
check("★ 没弹加值框（默认跳过是设计意图）", 打击.加值框, 0);

/* ── 6. 技能裸检定（与打击走的是相反的参数约定）── */
section("执行：技能裸检定");
const 技能 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
clickEl(root().querySelector('circle.pauih-sector[data-index="2"]'), "Skills");
await wait(900);
clickEl(root().querySelector("circle.pauih-sector"), "第一个技能");
await wait(900);
if (!inst()) return { 进不去技能层: true };
const before = game.messages.size;
const 名 = inst().level.sectors[0].label;
clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), 名);
await wait(2500);
const last = game.messages.contents.at(-1);
const out = { 格名: 名, 新消息: game.messages.size - before,
  公式: last?.rolls?.[0]?.formula ?? null,
  加值框: document.querySelectorAll(".roll-modifiers-dialog").length };
inst()?.close?.();
return out;
`);
check("第一格是该技能的检定", 技能.格名, v => /Check$/.test(String(v)), "以 Check 结尾");
check("掷出了骰子", 技能.新消息, 1);
check("★ 没弹加值框（这条路径只认 skipDialog，传 event 会让它失效）", 技能.加值框, 0);

/* ── 7. aura 登记表对得上游戏里的法术吗 ──────────
 *
 * ★ 单测够不着这一层：它验的是我们**自己**的逻辑，而这里问的是
 *   "表里这个 slug 在 pf2e 里真存在吗、它真有 area 吗、它自带的效果真取得到吗"。
 *   三种失效都不报错 —— slug 拼错只是"这法术我们不接管"，静默不生效。
 *
 * ⚠ slug 从源码里抽，不另抄一份：抄一份就是又造一个会腐坏的副本
 *   （今天刚因为抄字段错了 7 条 traits）。
 */
section("aura 登记表");
const 源 = readFileSync(new URL("../../src/aura-effects.ts", import.meta.url), "utf8");
const 登记 = [...源.matchAll(/^\s*slug:\s*"([a-z0-9-]+)",\s*name:/gm)].map(m => m[1]);
check("从源码抽到了登记表", 登记.length, v => v > 0, "> 0 条");

const 表 = await evaluate(`
${PRELUDE}
const 登记 = ${JSON.stringify(登记)};
const 出 = {};
/*
 * ⚠ 两条都被踩过，别改回去：
 *   ① 只认 type === "spell" —— Rallying Anthem 等同时存在**同名的诗人专长**，
 *      不筛类型会先撞上专长（没有 area），于是报"这法术没范围"。
 *   ② 认 doc 自己的 system.slug，不拿名字反推 —— "Silver's Refrain" 反推出的是
 *      silver-s-refrain，而 pf2e 的 slug 是 silvers-refrain。撇号一个字符就对不上。
 */
for (const slug of 登记) {
  let doc = null;
  for (const p of game.packs.filter(p => p.metadata.type === "Item")) {
    const hit = (await p.getIndex({ fields: ["type", "system.slug"] }))
      .find(e => e.type === "spell" && e.system?.slug === slug);
    if (hit) { doc = await p.getDocument(hit._id); break; }
  }
  if (!doc) { 出[slug] = { 找不到法术: true }; continue; }
  const desc = String(doc.system?.description?.value ?? "");
  const m = [...desc.matchAll(/@UUID\\[([^\\]]+)\\]\\{([^}]*)\\}/g)]
    .find(([, u, l]) => u.includes("spell-effects") && /^\\s*Spell Effect:/i.test(l));
  出[slug] = {
    area: doc.system?.area?.value ?? null,
    有效果链接: !!m,
    效果可解析: m ? !!(await fromUuid(m[1])) : false,
    特性: doc.system?.traits?.value ?? [],
  };
}
return 出;
`);
for (const slug of 登记) {
    const v = 表[slug] ?? {};
    check(`${slug} · 法术在 pf2e 里存在`, !v.找不到法术, true);
    check(`${slug} · 有 area（没有就走不了 aura）`, v.area, x => Number(x) > 0, "> 0 尺");
    check(`${slug} · 自带的 Spell Effect 解析得到`, v.效果可解析, true);
}

/* ── 8. aura 真的落得进 actor 吗（端到端）────────
 *
 * ★ 这一组问的是"用户真正会碰的那一层"：套上去之后，pf2e 认不认这条 Aura 规则元素。
 *   前面几组只证明了我们**算得对**，不证明 pf2e **收得下**。
 *
 * ⚠ 用的是产品自己的函数（`pauih._test`），不给测试另写一份实现。
 * ⚠ 建完立刻删 —— 测试不许在用户的世界里留垃圾。
 */
section("aura 落地");
const 落地 = await evaluate(`
${PRELUDE}
const actor = game.actors.getName("Nous offnirr") ?? game.actors.filter(a => a.type === "character")[0];
if (!actor) return { 没角色: true };
// 从包里拿真法术，不自造对象
let spell = null;
for (const p of game.packs.filter(p => p.metadata.type === "Item")) {
  const hit = (await p.getIndex({ fields: ["type", "system.slug"] }))
    .find(e => e.type === "spell" && e.system?.slug === "courageous-anthem");
  if (hit) { spell = await p.getDocument(hit._id); break; }
}
if (!spell) return { 没法术: true };
const plan = pauih._test.auraPlanFor(spell);
if (!plan) return { 算不出plan: true };
const data = pauih._test.buildAuraEffect(plan, actor.level);
const [做出来的] = await actor.createEmbeddedDocuments("Item", [data], { render: false });
const 活的 = actor.items.get(做出来的.id);
const 规则 = 活的?.system?.rules?.[0] ?? null;
const out = {
  建成了: !!活的,
  规则key: 规则?.key ?? null,
  半径: 规则?.radius ?? null,
  // ★ 真正的判据：pf2e 把它收进 actor.auras 了没有 —— 收进去才会扩散
  进了auras: !!actor.auras?.has("pauih-aura-courageous-anthem"),
  auras键: [...(actor.auras?.keys() ?? [])],
};
await 活的?.delete();
out.删干净了 = !actor.items.get(做出来的.id);
return out;
`);
check("effect 建得出来", 落地.建成了, true);
check("规则元素是 Aura", 落地.规则key, "Aura");
check("半径来自法术本体（60 尺）", 落地.半径, 60);
check("★ pf2e 收进了 actor.auras（收进去才会扩散）", 落地.进了auras, true,
      `true，实际 auras: ${JSON.stringify(落地.auras键)}`);
check("测试没在世界里留垃圾", 落地.删干净了, true);

/* ── 9. 豁免类范围减益（路径 B）──────────────────
 *
 * ★ 这里最要紧的一条是 **Roar of the Dragon 的排除证据**：
 *   我们排除它，理由是"它那条 Spell Effect 是**施法者自己**的交涉加值，不是敌人减益"。
 *   那是一个关于**别人的数据**的判断 —— 万一 pf2e 以后改了，我们的排除就没道理了，
 *   而没有断言的话没人会发现。所以把证据本身钉住。
 */
section("豁免类范围减益");
const 减益 = await evaluate(`
${PRELUDE}
const 取法术 = async (slug) => {
  for (const p of game.packs.filter(p => p.metadata.type === "Item")) {
    const hit = (await p.getIndex({ fields: ["type","system.slug"] }))
      .find(e => e.type === "spell" && e.system?.slug === slug);
    if (hit) return await p.getDocument(hit._id);
  }
  return null;
};
const 出 = {};
for (const slug of ["bane", "malediction"]) {
  const sp = await 取法术(slug);
  const plan = sp ? pauih._test.savePlanFor(sp) : null;
  出[slug] = { 找得到: !!sp, plan: plan ? { save: plan.save, radius: plan.radius } : null };
}
// Roar：确认它的效果确实是施法者的加值
const roar = await 取法术("roar-of-the-dragon");
出.roar = { 我们不接管: pauih._test.savePlanFor(roar) === null };
const ef = await fromUuid("Compendium.pf2e.spell-effects.Item.0s6YaL3IjqECmjab");
出.roar.效果规则 = (ef?.system?.rules ?? []).map(r => r.key + ":" + (r.selector ?? ""));
出.无网格时挡住了 = !pauih._test.sceneHasGrid()
  ? String(await pauih._test.resolveAreaAfterCast(
      game.actors.filter(a => a.type === "character")[0], roar ? await 取法术("bane") : null) ?? "")
  : "本场景有网格，这条不适用";
出.当前场景有网格 = pauih._test.sceneHasGrid();
return 出;
`);
check("bane 算得出 plan", 减益.bane?.plan, v => !!v);
check("bane 的豁免项从法术读出来是 will", 减益.bane?.plan?.save, "will");
check("malediction 算得出 plan", 减益.malediction?.plan, v => !!v);
check("★ Roar of the Dragon 不接管", 减益.roar?.我们不接管, true);
check("★ 排除依据仍成立：它的效果是施法者的交涉加值，不是敌人减益",
      减益.roar?.效果规则, v => Array.isArray(v) && v.length === 1 && v[0].includes("diplomacy"),
      "只有 FlatModifier:diplomacy");
if (!减益.当前场景有网格) {
    check("★ 无网格场景被挡住而不是算出个错答案", 减益.无网格时挡住了,
          v => String(v).includes("no grid"), "返回 no grid 的说明");
}

/* ── 10. 乙类编排器：武僧连击 ──────────────────
 *
 * ★ 单测用的是我手造的 actor 形状；这一组问的是**真角色身上是不是那个形状**。
 *   夹具漏了 `type: "strike"` 那次就是提醒：造出来的尺子和真东西可以差一个字段。
 *
 * ⚠ 临时造一个武僧再删掉 —— 测试世界里没有武僧，而"武僧点连击"是这条链路的入口。
 */
section("乙类编排器 · 武僧连击");
const 连击 = await evaluate(`
${PRELUDE}
const out = {};
// ① 真角色身上的徒手打击，形状对不对
const 真 = game.actors.getName("Nous offnirr") ?? game.actors.filter(a => a.type === "character")[0];
const 徒手 = pauih._test.unarmedStrikes(真);
out.真角色徒手数 = 徒手.length;
out.档位标签 = 徒手[0]?.strike?.variants?.map(v => v.label) ?? null;
out.扇区id样式 = 徒手[0]?.id ?? null;

// ② 造一个武僧，走完"点连击 → 出第一步盘面"
let 武僧 = null;
try {
  武僧 = await Actor.create({ name: "PAUIH temp monk", type: "character" }, { render: false });
  let feat = null;
  for (const p of game.packs.filter(p => p.metadata.type === "Item")) {
    const hit = (await p.getIndex({ fields: ["type","system.slug"] }))
      .find(e => e.system?.slug === "flurry-of-blows");
    if (hit) { feat = await p.getDocument(hit._id); break; }
  }
  out.找得到连击feat = !!feat;
  if (feat) {
    const [装上] = await 武僧.createEmbeddedDocuments("Item", [feat.toObject()], { render: false });
    out.slug认得出 = !!pauih._test.macroFor(装上.slug);
    const 一 = pauih._test.levelForStep(武僧, pauih._test.macroFor(装上.slug), 0, { picks: [], variantIndex: 0 });
    out.第一步 = 一 ? { 标题: 一.title, 条数: 一.sectors.length, 有翻选条: !!一.variant } : null;
    const 二 = pauih._test.levelForStep(武僧, pauih._test.macroFor(装上.slug), 1, { picks: ["x"], variantIndex: 0 });
    out.第二步 = 二 ? { 标题: 二.title, 条数: 二.sectors.length, 有翻选条: !!二.variant } : null;
    out.第三步是null = pauih._test.levelForStep(武僧, pauih._test.macroFor(装上.slug), 2, { picks: ["x","y"], variantIndex: 0 }) === null;
  }
} finally {
  if (武僧) { await 武僧.delete(); }
}
out.删干净了 = !game.actors.getName("PAUIH temp monk");
return out;
`);
check("真角色身上认得出徒手打击", 连击.真角色徒手数, v => v >= 1, ">= 1");
check("★ MAP 档位标签由 pf2e 给（徒手带敏捷是 -4/-8，不是 -5/-10）",
      连击.档位标签, v => Array.isArray(v) && v.length === 3 && String(v[1]).includes("MAP"),
      "三档且第二档带 MAP 文案");
check("扇区 id 用 collector 的同一份编号", 连击.扇区id样式, v => String(v).startsWith("strike:"));
check("pf2e 里找得到连击 feat", 连击.找得到连击feat, true);
check("★ 装上之后 slug 认得出来（编排器接得上）", 连击.slug认得出, true);
check("第一步有徒手可选", 连击.第一步?.条数, v => v >= 1, ">= 1");
check("★ 翻选条只在第一步（它选的是起始 MAP）", 连击.第一步?.有翻选条, true);
check("第二步没有翻选条", 连击.第二步?.有翻选条, false);
check("第二步照样列全部徒手", 连击.第二步?.条数, 连击.第一步?.条数);
check("两步走完就该执行了", 连击.第三步是null, true);
check("测试没在世界里留垃圾", 连击.删干净了, true);

/* ── 11. 甲类状态区 ──────────────────────────────
 *
 * ★ 这一组要证的是**旧做法为什么错**，不只是新做法能跑：
 *   旧做法按 classSlug 过滤开关，而典范的神火挂在圣像特性上、那些特性的 traits
 *   是 `["ikon"]` 不含 `exemplar` —— 这是个关于**pf2e 的数据**的判断，
 *   哪天它变了我们的改动就没道理了，所以钉的是依据本身。
 */
section("甲类状态区");
const 状态 = await evaluate(`
${PRELUDE}
const out = {};
// ① 真角色：现在显示得出东西吗
const 真 = game.actors.getName("Nous offnirr") ?? game.actors.filter(a => a.type === "character")[0];
const s0 = pauih._test.readClassState(真);
out.真角色 = { 资源: s0.resources.map(r => r.label + " " + r.value),
              开关: s0.toggles.map(t => t.label + " " + t.value),
              行: pauih._test.classStateLines(s0) };

// ② 圣像特性到底带不带 exemplar trait —— 推翻旧做法的那条依据
/*
 * ⚠ 用两个已知的圣像当样本，**不扫全包** —— 逐条 getDocument 走 1000+ 条要跑几分钟。
 *   名字改了这条会红，那正是我们想知道的（断言的是它们的 rules 与 traits，不是名字本身）。
 */
const pack = game.packs.get("pf2e.classfeatures");
const idx = await pack.getIndex();
const 圣像 = [];
for (const 名 of ["Thousand-League Sandals", "Scar of the Survivor"]) {
  const hit = idx.find(e => e.name === 名);
  if (!hit) { 圣像.push({ 名, 找不到: true }); continue; }
  const d = await pack.getDocument(hit._id);
  圣像.push({
    名: d.name, id: d._id, traits: d.system?.traits?.value ?? [],
    声明神火: (d.system?.rules ?? []).some(r => r.key === "RollOption" && r.option === "divine-spark"),
  });
}
out.圣像样本 = 圣像;
out.圣像带exemplar = 圣像.some(i => i.traits.includes("exemplar"));

// ③ 造个典范，装两个圣像，看神火那条出不出来
let 典范 = null;
try {
  典范 = await Actor.create({ name: "PAUIH temp exemplar", type: "character" }, { render: false });
  /*
   * ⚠ **必须剥掉 ChoiceSet 规则元素**（2026-08-05 实撞，整套测试卡死两次）：
   *   圣像特性带 ChoiceSet（问"把这个圣像附到哪件装备上"），装上去时 pf2e 会弹
   *   PickAThingPrompt 等人选 —— 窗口标题就是那件特性的名字（Thousand-League Sandals）。
   *   render:false 管不了它：那是**规则元素**弹的框，不是文档的 sheet。
   *   于是脚本永远等不到返回，240 秒后超时，报错只说"页面内脚本超时"。
   *   这一组要验的是 divine-spark 这条 RollOption，与附到哪件装备无关，剥掉即可。
   *
   * ⚠ 本段是模板字面量，**里面不能出现反引号** —— 我刚为此挂了一次。
   */
  for (const i of 圣像) {
    const d = await pack.getDocument(i.id);
    const o = d.toObject();
    o.system.rules = (o.system.rules ?? []).filter(r => r.key !== "ChoiceSet");
    await 典范.createEmbeddedDocuments("Item", [o], { render: false });
  }
  const st = pauih._test.readClassState(典范);
  const 神火 = st.toggles.find(t => t.key === "toggle:divine-spark");
  out.神火 = 神火 ?? null;
  out.开关条数 = st.toggles.length;
  // 旧做法模拟：按 classSlug 过滤会剩几条
  const cls = 典范.class?.slug ?? null;
  let 旧法剩 = 0;
  for (const opts of Object.values(典范.synthetics?.toggles ?? {})) {
    for (const o of Object.values(opts)) {
      const it = o.itemId ? 典范.items.get(o.itemId) : null;
      if (cls && (it?.system?.traits?.value ?? []).includes(cls)) 旧法剩++;
    }
  }
  out.旧做法剩几条 = 旧法剩;
} finally {
  if (典范) await 典范.delete();
}
out.删干净了 = !game.actors.getName("PAUIH temp exemplar");
return out;
`);
check("真角色的状态区有内容", 状态.真角色?.行, v => Array.isArray(v) && v.length > 0, "至少一行");
check("两个圣像样本都在，且都声明 divine-spark", 状态.圣像样本,
      v => Array.isArray(v) && v.length === 2 && v.every(x => x.声明神火), "两条都声明");
check("★ 圣像特性确实不带 exemplar trait（旧做法必然漏掉的依据）", 状态.圣像带exemplar, false);
check("★ 装上圣像后神火那条出得来", 状态.神火, v => !!v && String(v.key) === "toggle:divine-spark");
check("★ 多个圣像声明同一个开关 → 归成一条", 状态.开关条数, 1);
check("★ 对照：旧的按职业过滤一条都留不下", 状态.旧做法剩几条, 0);
check("测试没在世界里留垃圾", 状态.删干净了, true);

/* ── 12. alpha 反馈修的三条 ────────────────────
 *
 * ★ 全部是"**采集时问错了问题**"造成的：问"这归不归它的职业"，
 *   而用户要的是"它现在能不能用"。三条都不报错，只是那一格永远空着。
 */
section("alpha 反馈：装填 / NPC / 专长档");
const 反馈 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let 枪手 = null, 怪 = null;
try {
  枪手 = await Actor.create({ name: "PAUIH temp gun", type: "character" }, { render: false });
  for (const p of game.packs.filter(p => p.metadata.type === "Item")) {
    const hit = (await p.getIndex({ fields: ["type","system.slug"] }))
      .find(e => e.type === "weapon" && e.system?.slug === "arquebus");
    if (hit) { const o = (await p.getDocument(hit._id)).toObject();
      o.system.equipped = { carryType: "held", handsHeld: 2 };
      await 枪手.createEmbeddedDocuments("Item", [o], { render: false }); break; }
  }
  const aux = T.collectStrikeAuxiliaries(枪手);
  out.火器 = { 标签: aux.map(s => s.label), 有装填: aux.some(s => s.id.startsWith("reload:")),
               有收鞘: aux.some(s => /Sheathe/.test(s.label)) };
} finally { if (枪手) await 枪手.delete(); }
try {
  const pack = game.packs.get("pf2e.pathfinder-bestiary");
  const idx = await pack.getIndex();
  怪 = await Actor.create((await pack.getDocument(idx.contents[5]._id)).toObject(), { render: false });
  out.NPC = { 名: 怪.name, 标题: T.className(怪), 条数: T.collectClassAbilities(怪).length,
              含被动: T.collectClassAbilities(怪).some(s => /Tremorsense/.test(s.label)) };
} finally { if (怪) await 怪.delete(); }
const pc = game.actors.getName("Nous offnirr") ?? game.actors.filter(a => a.type === "character")[0];
out.玩家角色 = { 标题: T.className(pc), 职业能力数: T.collectClassAbilities(pc).length };
out.残留 = game.actors.filter(a => a.name.startsWith("PAUIH temp")).length;
return out;
`);
check("★ 火器的装填格出得来（原来根本没有入口）", 反馈.火器?.有装填, true);
check("★ 已拔出时的辅助动作也出得来（原来只在未拔出时给一个拔刀）", 反馈.火器?.有收鞘, true);
check("★ NPC 的招牌动作出得来（原来没有 class 就直接返回空）", 反馈.NPC?.条数, v => v >= 3, ">= 3 条");
check("NPC 那一层有自己的标题，不叫 Class", 反馈.NPC?.标题, "Abilities");
check("NPC 的被动不混进来", 反馈.NPC?.含被动, false);
check("玩家角色没有回归", 反馈.玩家角色?.职业能力数, v => v >= 4, ">= 4 条");
check("玩家角色的标题仍是职业名", 反馈.玩家角色?.标题, "Magus");
check("测试没在世界里留垃圾", 反馈.残留, 0);

/* ── 13. 乙类 · Spellstrike 端到端 ──────────────
 *
 * ★ 这一组是**唯一能证明它成立的观测**：单测验的是我们自己的筛选逻辑，
 *   而这里问的是"pf2e 收不收这一串" —— 一次掷骰能不能同时决定打击和法术。
 *
 * ⚠ 必须**先选目标**：没有目标就没有 DC，`variant.roll()` 的返回值里
 *   `degreeOfSuccess` 是 null（实测），整条分支就走不到。
 * ⚠ 用戏法（Phase Bolt）不消耗法术位，测试可以反复跑。
 */
section("乙类 · Spellstrike");
const 魔剑 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const a = game.actors.getName("Nous offnirr") ?? game.actors.filter(x => x.type === "character")[0];
const m = T.macroFor("spellstrike");
if (!m) return { 认不出: true };
const out = {};
const 目标层 = T.levelForStep(a, m, 0, { picks: [], variantIndex: 0 });
const 一 = T.levelForStep(a, m, 1, { picks: ["t"], variantIndex: 0 });
const 二 = T.levelForStep(a, m, 2, { picks: ["t","s"], variantIndex: 0 });
out.第一步是选目标 = !!目标层 && /Target/.test(目标层.title);
out.目标格 = 目标层 ? 目标层.sectors.map(s => s.label) : null;
out.法术格 = 一 ? 一.sectors.map(s => s.label) : null;
out.打击格 = 二 ? 二.sectors.map(s => s.label) : null;
out.翻选条在打击步 = !!(二 && 二.variant) && !(一 && 一.variant);

const 敌 = canvas.tokens.placeables.find(t => t.actor && t.actor.type === "npc");
if (!敌) { out.没有敌方token = true; return out; }
game.user.targets.forEach(t => t.setTarget(false, { releaseOthers: false }));
敌.setTarget(true, { releaseOthers: true });
await wait(300);

const 法格 = 一.sectors.find(s => s.label === "Phase Bolt") ?? 一.sectors[0];
const 击格 = 二.sectors[0];
const before = game.messages.size;
// ⚠ 现在第一步是**选目标**，picks 有三项（见 targetOptions / applyTargetPick）
const 目标格 = T.targetOptions(a, "enemies")[0];
await m.run(a, { picks: [目标格.id, 法格.id, 击格.id], variantIndex: 0 }, new PointerEvent("click"));
await wait(1800);
const 新 = game.messages.contents.slice(before);
out.新消息 = 新.length;
out.掷骰数 = 新.filter(x => x.rolls && x.rolls.length).length;
out.打击成功度 = (新.find(x => x.rolls && x.rolls.length && /^1d20/.test(x.rolls[0].formula)) || {}).flags;
out.有成功度 = !!(out.打击成功度 && out.打击成功度.pf2e && out.打击成功度.pf2e.context && out.打击成功度.pf2e.context.outcome);
out.打击成功度 = out.有成功度 ? out.打击成功度.pf2e.context.outcome : null;
out.汇总卡 = String((新[新.length - 1] || {}).content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
out.开着的框 = document.querySelectorAll(".window-app").length;
return out;
`);
check("认得出 spellstrike 并铺得出两步", 魔剑.法术格, v => Array.isArray(v) && v.length > 0);
check("★ 只列近战打击（规则写明 melee Strike）", 魔剑.打击格, v => Array.isArray(v) && v.length > 0);
check("★ 第一步是选目标 —— 由轮盘问，不再要玩家事先手动选", 魔剑.第一步是选目标, true);
check("目标步列出了敌方 token", 魔剑.目标格, v => Array.isArray(v) && v.length > 0);
check("★ 翻选条在打击那一步，不在法术那一步", 魔剑.翻选条在打击步, true);
check("★ 一次运行掷了骰（打击 + 法术伤害）", 魔剑.掷骰数, v => v >= 1, ">= 1");
check("★ 选了目标就读得到成功度（没目标时是 null）", 魔剑.有成功度, true,
      `true，实际 outcome=${魔剑.打击成功度}`);
check("汇总卡带 MAP 提醒（规则：算两次攻击，打完才施加）", 魔剑.汇总卡,
      v => /multiple attack penalty/i.test(String(v)), "含 multiple attack penalty");
check("★ 没留下等人的对话框", 魔剑.开着的框, 0);

/* ── 14. 丙类第一步 · 反应显示触发条件 ──────────
 *
 * ★ 实测定的边界：105 个反应里 0 个用规则元素表达时机、99 个（94%）描述里有 Trigger 段。
 *   所以"自动开反应窗口"做不到，但"把那句话摆到眼前"做得到、且零映射。
 *
 * ⚠ NPC 的能力描述常常整段是 @Localize 引用 —— 不展开的话**每个 NPC 反应都读不到**，
 *   而且不报错：读不到与"这条本来没有触发条件"长得一模一样。这一组就是守这个洞。
 */
section("丙类 · 反应的触发条件");
const 触发 = await evaluate(`
${PRELUDE}
const T = pauih._test;
let 怪 = null; const out = {};
try {
  const pack = game.packs.get("pf2e.pathfinder-bestiary");
  const idx = await pack.getIndex();
  怪 = await Actor.create((await pack.getDocument(idx.contents[5]._id)).toObject(), { render: false });
  const 扇区 = T.collectClassAbilities(怪);
  const 反应 = 扇区.filter(s => s.cost === "reaction");
  const 主动 = 扇区.filter(s => s.cost !== "reaction");
  out.NPC = 怪.name;
  out.反应数 = 反应.length;
  out.反应都有触发 = 反应.length > 0 && 反应.every(s => typeof s.detail === "string" && s.detail.length > 10);
  out.反应样例 = 反应.length ? 反应[0].label + " → " + 反应[0].detail : null;
  /*
   * ⚠ 主动动作**可以**有 detail（那是 Requirements），
   *   它不该显示的是**触发段**。第一版断言写成"主动不该有 detail"，
   *   加了要求显示之后就变成假红 —— 断言要盯它真正该管的事。
   */
  const 本地化 = (k) => game.i18n.localize(k);
  out.主动显示的不是触发 = 主动.every(s => {
    const it = 怪.items.find(x => x.name === s.label);
    const desc = it ? (it.system && it.system.description ? it.system.description.value : "") : "";
    const 触 = T.triggerOf(desc, 本地化);
    return !触 || s.detail !== 触;
  });
  out.主动里有要求的 = 主动.filter(s => s.detail).length;
  out.反应带记号 = 反应.every(s => s.badge === "⟳");
} finally { if (怪) await 怪.delete(); }
out.残留 = game.actors.filter(a => a.name.indexOf("PAUIH temp") === 0).length;
return out;
`);
check("NPC 身上有反应", 触发.反应数, v => v >= 1, ">= 1");
check("★ 反应都显示出了触发条件（@Localize 展开生效）", 触发.反应都有触发, true,
      `true，实际：${触发.反应样例}`);
check("反应带 ⟳ 记号", 触发.反应带记号, true);
check("★ 主动动作显示的不是触发段（可以显示要求）", 触发.主动显示的不是触发, true);
check("测试没在世界里留垃圾", 触发.残留, 0);

/* ── 15. 通用动作显示「要求」──────────────────
 *
 * ★ ③段「条件灰显」里**可推导的那一半**：判断满不满足很难且容易算错，
 *   把要求摆到眼前推得出来，且零映射、全职业通用。
 *
 * ⚠ 注册表的 `description` **和 `name` 一样是本地化 key**（实测
 *   `trip.description === "PF2E.Actions.Trip.Description"`）——
 *   不 localize 就会把一串 key 印进毂里，**而且不报错**。这一组守这个洞。
 */
section("通用动作 · 要求");
const 要求 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const a = game.actors.getName("Nous offnirr") ?? game.actors.filter(x => x.type === "character")[0];
const 出 = T.collectActions(a);
const 带 = 出.filter(s => s.detail);
return {
  动作数: 出.length,
  带说明: 带.length,
  样例: 带.slice(0, 4).map(s => s.label + " -> " + s.detail),
  印出key了吗: 出.some(s => /^PF2E\./.test(String(s.label)) || /^PF2E\./.test(String(s.detail || ""))),
  Trip那条: (出.find(s => s.label === "Trip") || {}).detail || null,
};
`);
/* ⚠ 原来这里断言的是 ">10 条"。2026-08-07 精简之后**故意只剩三条常驻**，
 *   而 `_test.collectActions` 是裸调的（没先 await primeSheetActions），
 *   所以卡上那批不在里面 —— 这一层验的就是"注册表那三条 + 出口格"。
 *   ★ 断言跟着设计走：**改小是这次改动的目的**，不是回归。 */
check("采集到三条常驻通用动作 + 末位出口格", 要求.动作数, 4);
check("★ 带要求的那几条仍然把要求读出来了", 要求.带说明, v => v >= 2, ">= 2 条");
check("★ 没有把本地化 key 印出来（description 也是 key）", 要求.印出key了吗, false);
check("样例是人话不是键名", 要求.样例, v => Array.isArray(v) && v.every(x => !/PF2E\./.test(x)));

/* ── 16. 多目标 · 累加 + 确认格 ──────────────────
 *
 * ★ Nous 2026-08-05 在三个方案里选了这个。实测印证：`actionspf2e` 全包 574 条动作里
 *   **没有任何一条**的 target 字段带数量 —— "Signal up to two squadmates" 只写在散文里。
 *   所以"按规则数自动收"那条路要解析散文，会错；累加式不依赖任何推不出来的东西。
 *
 * ⚠ 这一组必须**自己造一个盟友 token**：实测该场景里
 *   "test dummy" 与 "Nous offnirr" 是**同一个 actor** 的两个 token，都被排除，
 *   于是一个盟友都没有 —— 不造的话这一组会因为"没得选"而假绿。
 * ⚠ 造 token **不能传 `render: false`** —— 传了画布不接管它，
 *   `canvas.tokens.placeables` 里根本没有，看起来像"敌我判断错了"。
 */
section("多目标 · 累加与确认");
const 多选 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const a = game.actors.getName("Nous offnirr") ?? game.actors.filter(x => x.type === "character")[0];
const out = {};
let 装上 = null, 盟id = null;
try {
  const 盟actor = game.actors.filter(x => x.type === "character" && x.id !== a.id)[0];
  if (!盟actor) return { 没有第二个角色: true };
  const [doc] = await canvas.scene.createEmbeddedDocuments("Token", [{
    name: "PAUIH temp ally", actorId: 盟actor.id, x: 1200, y: 1200,
  }]);
  盟id = doc.id;
  await wait(800);

  const p = game.packs.get("pf2e.actionspf2e");
  const idx = await p.getIndex({ fields: ["type", "system.slug"] });
  const hit = [...idx].find(e => e.system && e.system.slug === "buckle-cut-blitz");
  [装上] = await a.createEmbeddedDocuments("Item", [(await p.getDocument(hit._id)).toObject()], { render: false });
  const m = T.macroForItem({ slug: 装上.slug, traits: (装上.system.traits || {}).value || [] });
  out.按特性认出来 = !!m && m.name === "Tactic";

  game.user.targets.forEach(t => t.setTarget(false, { releaseOthers: false }));
  const ctx = { picks: [], variantIndex: 0, itemId: 装上.id };
  const 画 = () => T.levelForStep(a, m, 0, ctx).sectors.map(s => ({
    名: s.label, 记号: s.badge || null, 态: s.state }));
  out.空选 = 画();
  const 盟格 = T.targetOptions(a, "allies", true).find(s => s.id !== "tgt:__done");
  out.有盟友可选 = !!盟格;
  if (盟格) {
    T.applyTargetPick(盟格.id, true); await wait(250);
    out.选一个 = 画();
    T.applyTargetPick(盟格.id, true); await wait(250);
    out.取消后 = 画();
  }
} finally {
  if (装上) await 装上.delete();
  if (盟id) await canvas.scene.deleteEmbeddedDocuments("Token", [盟id]);
}
out.残留token = canvas.tokens.placeables.filter(t => t.name.indexOf("PAUIH temp") === 0).length;
return out;
`);
const 完成格 = (组) => (组 || []).find(x => x.名 === "Done");
check("★ 按特性认出战术宏（37 条战术共享 tactic 特性，一条宏全覆盖）", 多选.按特性认出来, true);
check("造得出盟友 token 且认得出是盟友", 多选.有盟友可选, true);
check("★ 一个没选时确认格灰显（提示不是锁，可点、给说明）",
      完成格(多选.空选)?.态, "gated");
check("★ 选中后目标带 ◎", 多选.选一个, v => (v || []).some(x => x.记号 === "◎"));
check("★ 确认格印出选了几个（不该让玩家凭记忆数）", 完成格(多选.选一个)?.记号, "1");
check("★ 再点一次取消 —— 没有取消的多选是个陷阱", 完成格(多选.取消后)?.态, "gated");
check("测试没在场景里留 token", 多选.残留token, 0);

/* ── 17. 反应分类 ────────────────────────────
 *
 * ★ 这一格的存在理由是**我们做不到的那一半**（丙类调研 §4.2）：
 *   16 条反应的触发事件 pf2e 根本不广播（含 Reactive Strike），
 *   自动开窗口无解 —— 于是摆出来 + 摆出触发条件，时机交回玩家。
 *
 * ⚠ **必须自己造带反应的角色**：实测 5 级 Magus（Nous offnirr）
 *   21 个条目里**一条反应都没有**，拿他测这一格会永远是空的、假绿。
 */
section("反应分类");
const 反应层 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let 战士 = null, 怪 = null;
try {
  战士 = await Actor.create({ name: "PAUIH temp reactor", type: "character" }, { render: false });
  const p = game.packs.get("pf2e.actionspf2e");
  const idx = await p.getIndex({ fields: ["type", "system.slug"] });
  const 取 = async (slug) => {
    const hit = [...idx].find(e => e.system && e.system.slug === slug);
    if (!hit) return null;
    const doc = (await p.getDocument(hit._id)).toObject();
    // ⚠ ChoiceSet 规则会弹 PickAThingPrompt 把整轮测试挂死（render:false 拦不住它）
    doc.system.rules = (doc.system.rules || []).filter(r => r.key !== "ChoiceSet");
    const [装] = await 战士.createEmbeddedDocuments("Item", [doc], { render: false });
    return 装;
  };
  const 反击 = await 取("reactive-strike");
  const 主动 = await 取("trip");
  out.装上了 = { 反击: !!反击, 主动: !!主动 };

  const 扇区 = T.collectReactions(战士);
  out.名单 = 扇区.map(s => ({ id: s.id, 名: s.label, 消耗: s.cost, 记号: s.badge, 触发: s.detail || null }));
  out.主动没混进来 = !扇区.some(s => s.label === "Trip");
  /*
   * 同一条反应仍留在原来的层里 —— 这是**横切镜头，不是搬家**。
   *
   * ⚠ 这一条**不能拿上面那个临时角色验**：他没有职业，
   *   而 Reactive Strike 的 traits 是空的，归属只存在于 GrantItem 链上 ——
   *   没有职业特性发它，职业层本来就不该收它。
   *   （第一版就这么写的，红了，红得对：夹具够不着这个前提。）
   *   NPC 走的是"卡上每条非被动动作都算"，前提天然成立。
   */
  // ⚠ 世界里那个叫 "NPC" 的空壳角色**一个条目都没有**，拿它验会 0/0 假绿。
  //    照第 15 组的做法从怪物图鉴造一只真的。
  const bp = game.packs.get("pf2e.pathfinder-bestiary");
  const bidx = await bp.getIndex();
  怪 = await Actor.create((await bp.getDocument(bidx.contents[5]._id)).toObject(), { render: false });
  const npc反应 = T.collectReactions(怪).map(s => s.label);
  const npc职业层 = T.collectClassAbilities(怪).map(s => s.label);
  out.NPC反应数 = npc反应.length;
  out.横切不搬家 = npc反应.length > 0 && npc反应.every(n => npc职业层.indexOf(n) >= 0);
  // 零反应的角色（实测的 Magus 就是）
  const 法师 = game.actors.getName("Nous offnirr");
  out.零反应角色 = 法师 ? T.collectReactions(法师).length : null;
} finally {
  if (战士) await 战士.delete();
  if (怪) await 怪.delete();
}
out.删干净了 = !game.actors.getName("PAUIH temp reactor");
return out;
`);
const 反击格 = (反应层.名单 || []).find(x => x.名 === "Reactive Strike");
check("装得上反击与主动动作", 反应层.装上了?.反击, true);
check("★ 反应层收到了 Reactive Strike（它 traits 为空，只能靠 actionType 认）", !!反击格, true);
check("反应的消耗标成 reaction", 反击格?.消耗, "reaction");
check("★ 扇区上带 ⟳ —— 从别的层跳进来时不靠「我记得这层是反应层」", 反击格?.记号, "⟳");
check("★ 触发条件就是这一格的全部价值，必须有",
      反击格?.触发, v => typeof v === "string" && v.indexOf("reach") >= 0);
check("★ 主动动作不混进来（Trip 不是反应）", 反应层.主动没混进来, true);
check("NPC 身上采到了反应（这一条的前提）", 反应层.NPC反应数, v => v > 0, "> 0");
check("★ 横切镜头不是搬家：同一条反应仍留在原来的层", 反应层.横切不搬家, true);
check("★ 零反应的角色给空数组（实测 5 级 Magus 就是零反应）", 反应层.零反应角色, 0);
check("测试没在世界里留角色", 反应层.删干净了, true);

/* ── 18. G8 · 我控制的其他单位 ──────────────────
 *
 * ★ 判据两条**必须一起看**：`ownership[我] === 3` **且** `hasPlayerOwner`。
 * ⚠⚠ 这一组最重要的是那个**反例**：GM 自己建的怪 **两个单条件都过**
 *   （`isOwner` 恒真；创建者自动获得显式归属），只有第二条能滤掉它 ——
 *   漏了它，GM 打开轮盘会看到自己导入的整本怪物图鉴。
 *   而这个错法**不报错**，在只有 5 个角色的测试世界里看着像"功能正常"。
 */
section("我控制的其他单位");
const 身体 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let 主 = null, 宠 = null, 怪 = null;
try {
  const me = game.user.id;
  const 玩家 = game.users.find(u => !u.isGM);
  if (!玩家) return { 没有非GM用户: true };
  const 归属 = { default: 0, [me]: 3, [玩家.id]: 3 };
  主 = await Actor.create({ name: "PAUIH temp master", type: "character", ownership: 归属 }, { render: false });
  宠 = await Actor.create({ name: "PAUIH temp pet", type: "familiar", ownership: 归属,
    system: { master: { id: 主.id } } }, { render: false });
  // 反例：GM 自己建的怪 —— isOwner 真、显式归属也真（创建者自动获得），
  //       只有 hasPlayerOwner 是假
  怪 = await Actor.create({ name: "PAUIH temp mob", type: "npc" }, { render: false });

  out.怪isOwner = 怪.isOwner;
  out.怪显式归属 = 怪.ownership[me] === 3;
  out.怪归玩家 = 怪.hasPlayerOwner;

  const 名单 = T.collectBodies(主).map(s => ({ 名: s.label, 记号: s.badge || null }));
  out.名单 = 名单;
  out.列到了宠 = 名单.some(x => x.名 === "PAUIH temp pet");
  out.没列怪 = !名单.some(x => x.名 === "PAUIH temp mob");
  out.没列自己 = !名单.some(x => x.名 === "PAUIH temp master");
  out.宠排最前 = 名单.length > 0 && 名单[0].名 === "PAUIH temp pet";
  out.没令牌标了记号 = (名单.find(x => x.名 === "PAUIH temp pet") || {}).记号 === "◇";
  out.从宠看得到主 = T.collectBodies(宠).some(s => s.label === "PAUIH temp master");
} finally {
  for (const a of [宠, 怪, 主]) if (a) await a.delete();
}
out.删干净了 = game.actors.filter(a => a.name.indexOf("PAUIH temp") === 0).length;
return out;
`);
check("★ 反例前提①：GM 对自己建的怪 isOwner", 身体.怪isOwner, true);
check("★ 反例前提②：创建者**自动**拿到显式归属（所以单看归属救不了）", 身体.怪显式归属, true);
check("★ 而它不归任何玩家账号 —— 唯一能滤掉它的那一条", 身体.怪归玩家, false);
check("★★ 于是没把 GM 自建的怪列进来（漏了这条会列出整本图鉴）", 身体.没列怪, true);
check("列出了归玩家账号的魔宠", 身体.列到了宠, true);
check("没把当前这具身体列进来", 身体.没列自己, true);
check("★ master.id 指着我的排最前（唯一一条硬链接）", 身体.宠排最前, true);
check("★ 场上没令牌的照样列，只标 ◇（提示不是锁）", 身体.没令牌标了记号, true);
check("★ 从同伴那边看得到主人 —— 换回去的路要在", 身体.从宠看得到主, true);
check("测试没在世界里留角色", 身体.删干净了, 0);

/* ── 19. G9 · MAP 档位靠观测 ────────────────────
 *
 * ★★ 全链路验的是**观测**这条路：掷一次攻击 → 聊天消息带 `mapIncreases`
 *   → 钩子数进本回合账 → 再进打击层时翻选条**已经停在第二档**。
 *   单测够不着这里：它验的是我们自己的解析，而这里问的是
 *   "pf2e 真的会发那条消息吗、钩子真的收得到吗、翻选条真的跟着动吗"。
 *
 * ⚠ **必须真开一场战斗**：战斗外没有回合，MAP 不该数（与动作经济同一条边界）。
 *   不开战斗的话这一组会因为"永远第 0 档"而假绿。
 */
section("MAP 档位");
const map档 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let 战斗 = null;
try {
  const tok = canvas.tokens.placeables.find(t => t.actor && t.actor.type === "character");
  if (!tok) return { 场上没有角色令牌: true };
  战斗 = await Combat.create({ scene: canvas.scene.id });
  await 战斗.createEmbeddedDocuments("Combatant", [{ tokenId: tok.id, actorId: tok.actor.id, initiative: 20 }]);
  /*
   * ⚠⚠ **必须 activate()**：只 create + startCombat 的话 game.combat **仍然是 null**
   *   （实测），于是 currentRound 判定"不在战斗中"，MAP 一次也不数 ——
   *   （注意：这段在模板字面量里，**不能出现反引号**）
   *   而失败长得像"钩子没收到消息"，跟真正的原因毫无关系。
   *   夹具自己要把前提做足：这一条就是「测试拥有自己的前提」那类。
   */
  await 战斗.activate();
  await 战斗.startCombat();
  await wait(600);
  out.开打了 = 战斗.started === true && 战斗.round >= 1;
  out.game战斗认得它 = game.combat && game.combat.id === 战斗.id;
  out.战斗外不数 = T.nextMapIndex(0);

  const 起 = T.attacksThisTurn(tok.actor.id, 战斗.round);
  out.开局攻击数 = 起;

  // 走真链路：分类层 → 打击层 → 点第一把武器
  let app = await 呼出();
  if (!app) return { 呼出失败: true };
  clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "Strikes");
  await 等到(() => inst() && inst().level.title === "Strikes");
  out.第一次进来的档 = inst().level.variant ? inst().level.variant.index : null;
  const before = game.messages.size;
  clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "第一把武器");
  await 等到(() => game.messages.size > before, 24);
  await wait(800);
  const 末 = game.messages.contents.at(-1);
  out.发了攻击消息 = !!(末 && 末.flags && 末.flags.pf2e && 末.flags.pf2e.context
                    && 末.flags.pf2e.context.type === "attack-roll");
  out.消息带档位 = 末 && 末.flags.pf2e.context ? 末.flags.pf2e.context.mapIncreases : "(无)";
  out.解析得出 = !!T.readAttack(末);
  out.数进账了 = T.attacksThisTurn(tok.actor.id, 战斗.round) - 起;

  // 再进一次打击层：翻选条应该已经跳到第二档
  app = await 呼出();
  clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "Strikes");
  await 等到(() => inst() && inst().level.title === "Strikes");
  out.第二次进来的档 = inst().level.variant ? inst().level.variant.index : null;
  out.档位文字 = inst().level.variant ? inst().level.variant.labels[out.第二次进来的档] : null;
  inst()?.close?.();
} finally {
  if (战斗) await 战斗.delete();
}
out.战斗删干净了 = !game.combats.contents.length;
return out;
`);
check("开得起一场战斗（这一组的前提）", map档.开打了, true);
check("★ 而且它是**活动**战斗 —— 只 create 不 activate 的话 game.combat 是 null", map档.game战斗认得它, true);
check("第一次进打击层停在第 1 击", map档.第一次进来的档, 0);
check("★ pf2e 真的发了 attack-roll 消息", map档.发了攻击消息, true);
check("★★ 消息里带 mapIncreases（整条路就建在这个字段上）", map档.消息带档位, 0);
check("我们解析得出来", map档.解析得出, true);
check("★ 钩子把它数进了本回合的账", map档.数进账了, 1);
check("★★ 再进打击层，翻选条已经跳到第 2 击", map档.第二次进来的档, 1);
check("★ 档位文字带着 MAP（原样来自 pf2e，不是我们拼的）",
      map档.档位文字, v => typeof v === "string" && /MAP/.test(v));
check("测试没在世界里留战斗", map档.战斗删干净了, true);

/* ── 20. G10 · 反应窗口提示 ────────────────────
 *
 * ★ 全链路：**真实的**聊天消息 → 分类 → 触发词匹配 → 弹出只含候选的那一层。
 * ⚠ 单测够不着这里，它验的是我们自己的正则；这一组问的是
 *   "pf2e 真的在 target 里放的是那个形状吗、fromUuidSync 解得开吗、盘真的弹得出来吗"。
 * ⚠⚠ 最要紧的一条是**辨别力**：同一份反应清单里，
 *   "我挨打" 只该摆 Selfish Shield，不该把 Retributive Strike（盟友挨打）一起摆出来。
 *   第一版正则少了一个否定断言，两条会同时命中 —— 而那只是"多摆一格"，不报错。
 */
section("反应窗口提示");
const 反应提示 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let 装 = [];
let me = null;
try {
  const 消息 = game.messages.contents.filter(m => m.flags && m.flags.pf2e && m.flags.pf2e.context
    && m.flags.pf2e.context.type === "damage-roll" && m.flags.pf2e.context.target
    && m.flags.pf2e.context.target.actor).slice(-1)[0];
  if (!消息) return { 世界里没有带目标的伤害消息: true };
  const 目标doc = fromUuidSync(消息.flags.pf2e.context.target.actor);
  out.uuid解得开 = !!目标doc && !!目标doc.id;
  /* ⚠ 解不开就**在这里停**：下一行要读 目标doc.id。
     原来只把结果记进 out 就往下走，于是世界里那条旧伤害消息的目标一旦被删掉
     （测试自己造的临时角色、或手动清场），整轮 e2e 从这里**抛错中断**，
     后面几组一条都跑不到 —— 失败长得像"e2e 坏了"，其实是数据前提没了。
     ★ 前提不成立要**报成前提不成立**，不要让它变成崩溃。 */
  if (!目标doc || !目标doc.id) return { 目标uuid解不开: true };

  const 令牌 = canvas.tokens.placeables.find(t => t.actor && t.actor.id === 目标doc.id);
  if (!令牌) return { 目标没有令牌: true };
  令牌.control({ releaseOthers: true });
  me = 令牌.actor;
  await wait(400);

  const p = game.packs.get("pf2e.actionspf2e");
  const idx = await p.getIndex({ fields: ["system.slug"] });
  for (const slug of ["retributive-strike", "selfish-shield"]) {
    const hit = [...idx].find(e => e.system && e.system.slug === slug);
    if (!hit) continue;
    const doc = (await p.getDocument(hit._id)).toObject();
    doc.system.rules = (doc.system.rules || []).filter(r => r.key !== "ChoiceSet");
    const [x] = await me.createEmbeddedDocuments("Item", [doc], { render: false });
    装.push(x.id);
  }
  await wait(500);
  out.两条都装上了 = T.collectReactions(me).length >= 2;

  await 关干净();
  T.提示反应(消息);
  await wait(1400);
  const w = inst();
  out.弹了 = !!w;
  out.层 = w ? w.level.title : null;
  out.格 = w ? w.level.sectors.map(s => s.label) : null;
  out.都带反应记号 = w ? w.level.sectors.every(s => s.badge === "⟳") : null;
  if (w) { try { await w.close(); } catch {} }

  // 关掉开关就不该再弹
  await game.settings.set("player-action-ui-hub", "reactionPrompts", false);
  await 关干净();
  T.提示反应(消息);
  await wait(900);
  out.关了开关还弹吗 = !!inst();
  await game.settings.set("player-action-ui-hub", "reactionPrompts", true);
} finally {
  if (me && 装.length) await me.deleteEmbeddedDocuments("Item", 装.filter(id => me.items.get(id)));
  await 关干净();
}
out.清理干净 = me ? me.items.filter(i => i.system.actionType && i.system.actionType.value === "reaction").length : 0;
return out;
`);
check("★ context.target 里的 uuid 解得开（拿裸 id 比会永远不相等）", 反应提示.uuid解得开, true);
check("两条勇者反应都装上了（这一组的前提）", 反应提示.两条都装上了, true);
check("★★ 真消息真的把盘弹出来了", 反应提示.弹了, true);
check("弹的是反应那一层", 反应提示.层, "Reaction?");
check("★★ 只摆「我挨打」那条，不把盟友那条一起摆出来（辨别力）",
      反应提示.格, v => Array.isArray(v) && v.length === 1 && v[0] === "Selfish Shield");
check("摆出来的都带 ⟳", 反应提示.都带反应记号, true);
check("★ 开关关掉就不弹 —— 会主动弹出来的东西必须给得掉", 反应提示.关了开关还弹吗, false);
check("测试没在角色身上留条目", 反应提示.清理干净, 0);

/* ── 21. 2026-08-07 Nous 看图之后的四项 ──────────
 *
 * ★ 都是**看着实物**才发现的，测试全绿的时候一条都没暴露：
 *   Drop 占位、长剑冒出 Reload、收鞘了还能打、滚轮没接。
 */
section("看图之后的修正");
const 看图 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
const g = game.actors.getName("PAUIH cls Guardian");
if (!g) return { 没有守护者测试角色: true };
await T.primeSheetActions(g);

// ① 长剑不该有 Reload（实测它的 reload.value 是字符串 "-"）
const 辅助 = T.collectStrikeAuxiliaries(g).map(s => s.label);
out.辅助 = 辅助;
out.没有Reload = !辅助.some(l => /Reload/.test(l));
out.没有Drop = !辅助.some(l => /Drop/.test(l));
out.有Sheathe = 辅助.some(l => /Sheathe/.test(l));

// ② 收鞘之后打击不该再列，而拔刀要在
const 剑 = g.items.find(i => i.name === "Longsword");
await 剑.update({ "system.equipped.carryType": "worn", "system.equipped.handsHeld": 0 });
await wait(1000);
const 收鞘打击 = (g.system.actions || []).filter(x => x.type === "strike" && x.ready !== false).map(x => x.label);
out.收鞘后还能打的 = 收鞘打击;
out.长剑不在里面 = !收鞘打击.includes("Longsword");
out.拔刀入口还在 = T.collectStrikeAuxiliaries(g).some(s => /Draw/.test(s.label));
await 剑.update({ "system.equipped.carryType": "held", "system.equipped.handsHeld": 1 });
await wait(800);

// ③ 职业层照角色卡搬
out.照卡搬 = T.collectClassAbilities(g).map(s => s.label);
out.反应层 = T.collectReactions(g).map(s => s.label);

// ④ 资源全推导：炼金术士要读到 remaster 之后的 versatileVials
const al = game.actors.getName("PAUIH cls Alchemist");
out.炼金资源 = al ? T.resourceLines(al).map(r => r.label + " " + r.value) : null;
return out;
`);
check("★ 长剑不再冒出 Reload（reload.value 实测是 \"-\"）", 看图.没有Reload, true);
check("★ Drop 不占格子（Nous：不需要 drop 快捷键）", 看图.没有Drop, true);
check("Sheathe 还在（那是卡上真有的）", 看图.有Sheathe, true);
check("★★ 收鞘之后长剑不再出现在打击里", 看图.长剑不在里面, true);
check("★ 但拔刀的入口还在（不然就没法拔了）", 看图.拔刀入口还在, true);
check("★ 职业层照角色卡搬", 看图.照卡搬,
      v => Array.isArray(v) && v.includes("Taunt") && v.includes("Shield Block"));
check("★ 反应层就是卡上的 Reactions 那一节", 看图.反应层,
      v => Array.isArray(v) && v.length === 2 && v.includes("Intercept Attack"));
check("★★ 资源全推导 —— 读到 remaster 后的 Vials（旧登记表写的路径已失效）",
      看图.炼金资源, v => Array.isArray(v) && v.some(x => /Vials 2\/3/.test(x)));

/* ── 22. MAP 阶梯一眼看全 ───────────────────────
 *
 * ★ Nous 2026-08-07："其实是 map 的 +14、+9、+4，这里应该顺便把那个括号 map 减值写上去。"
 * ⚠ 关键在**第 1 击**：pf2e 给的 label 就是 "+14"，一个括号都没有 ——
 *   只画当前档的话，玩家在第 1 击时**根本看不到 MAP 这回事**，
 *   得先翻一下才知道后面扣多少。而"翻一下才知道"正是这个模组要消灭的东西。
 */
section("MAP 阶梯");
const 阶梯 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "Strikes");
await 等到(() => inst() && inst().level.title === "Strikes");
/* ⚠ 换层之后毂里的文字**晚一帧**才画出来 —— 等标题变了就去读，
 *   读到的是 null，而失败长得像"这一行没实现"。要等的是**那一行本身**。 */
await 等到(() => root().querySelector("text.pauih-variant"));
const out = {};
const 条 = root().querySelector("text.pauih-variant");
out.整行 = 条 ? 条.textContent : null;
const 段 = 条 ? [...条.querySelectorAll("tspan")] : [];
out.高亮 = 段.filter(x => x.getAttribute("class") === "pauih-variant-on").map(x => x.textContent);
out.暗的 = 段.filter(x => x.getAttribute("class") === "pauih-variant-off").map(x => x.textContent);
// 这一行有没有顶出毂（它在毂中心偏下，弦长要按所在高度算）
if (条) {
  const bb = 条.getBBox();
  const dy = Math.abs(bb.y + bb.height / 2 - 100);
  out.宽 = +bb.width.toFixed(1);
  out.弦 = +(2 * Math.sqrt(Math.max(0, 68 * 68 - dy * dy))).toFixed(1);
}
// 滚轮换档，高亮要跟着走
root().querySelector("svg").dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
await wait(600);
const 条2 = root().querySelector("text.pauih-variant");
out.滚过之后高亮 = 条2 ? [...条2.querySelectorAll("tspan")]
  .filter(x => x.getAttribute("class") === "pauih-variant-on").map(x => x.textContent) : null;
inst()?.close?.();
return out;
`);
check("★★ 三档一起摆出来（第 1 击也看得到后面要扣多少）", 阶梯.整行,
      v => typeof v === "string" && /MAP -5/.test(v) && /MAP -10/.test(v));
check("★ 当前那档高亮，且只有它带 ◆", 阶梯.高亮, v => Array.isArray(v) && v.length === 1 && v[0].indexOf("◆") === 0);
check("其余两档变暗且不带 ◆（三个记号并排会让人以为要花三个动作）",
      阶梯.暗的, v => Array.isArray(v) && v.length === 2 && v.every(x => x.indexOf("◆") < 0));
check("★ 没顶出毂（按这一行所在高度的弦长算，不是按直径）", 阶梯.宽, v => v < 阶梯.弦);
check("★ 滚轮换档，高亮跟着走", 阶梯.滚过之后高亮, v => Array.isArray(v) && /MAP -5/.test(v[0] ?? ""));

/* ── 23. MAP 在自己回合开始时归零 ────────────────
 *
 * ★ Nous 2026-08-07 问"有没有这个自动化" —— **没有**。
 *   实测 pf2e 的 calculateMAPs 只返回 {map1:-5, map2:-10} 这三个选项，
 *   全系统搜不到任何"本回合打了几次"的计数。只有我们在记。
 * ⚠⚠ 那就必须记在**对的时点**：规则是"你自己的回合开始时重置"，
 *   而 round 变的那一刻通常是**别人**在行动。按 round 清的话，
 *   我在自己回合打的那几下会在下一个人行动时被抹掉 —— MAP 偏一档，且不报错。
 */
section("MAP 按回合归零");
const 归零 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let 战斗 = null;
try {
  const 我 = canvas.tokens.placeables.find(t => t.actor && t.actor.type === "character");
  const 别人 = canvas.tokens.placeables.find(t => t.actor && t.actor.id !== 我.actor.id);
  if (!别人) return { 场上只有一个单位: true };
  战斗 = await Combat.create({ scene: canvas.scene.id });
  await 战斗.createEmbeddedDocuments("Combatant", [
    { tokenId: 别人.id, actorId: 别人.actor.id, initiative: 20 },
    { tokenId: 我.id,   actorId: 我.actor.id,   initiative: 10 },
  ]);
  await 战斗.activate();
  await 战斗.startCombat();
  await wait(900);
  const id = 我.actor.id;
  for (let i = 0; i < 4 && (!战斗.combatant || 战斗.combatant.actor.id !== id); i++) {
    await 战斗.nextTurn(); await wait(900);
  }
  out.轮到我了 = !!战斗.combatant && 战斗.combatant.actor.id === id;
  T.noteAttack(id, 战斗.round, 2);
  out.我回合内 = T.attacksThisTurn(id, 战斗.round);
  await 战斗.nextTurn(); await wait(1000);
  out.别人回合里我的账 = T.attacksThisTurn(id, 战斗.round);
  await 战斗.nextTurn(); await wait(1200);
  out.又轮到我 = !!战斗.combatant && 战斗.combatant.actor.id === id;
  out.我回合开始后 = T.attacksThisTurn(id, 战斗.round);
} finally { if (战斗) await 战斗.delete(); }
out.清干净 = game.combats.contents.length;
return out;
`);
check("轮得到我（这一组的前提）", 归零.轮到我了, true);
check("我回合内记得下攻击", 归零.我回合内, 2);
check("★★ 别人的回合里我的账**不清** —— 反应打出去的那一击也该算进 MAP", 归零.别人回合里我的账, 2);
check("又轮到我了", 归零.又轮到我, true);
check("★★ 我自己的回合一开始才归零", 归零.我回合开始后, 0);
check("测试没在世界里留战斗", 归零.清干净, 0);

/* ── 24. 空分类只说一句 ─────────────────────── */
section("空分类的措辞");
const 措辞 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
const 空格 = app.level.sectors.filter(s => s.state === "gated");
const 有内容 = app.level.sectors.filter(s => s.state === "normal");
const out = {
  空格: 空格.map(s => ({ 名: s.label, detail: s.detail || null, reason: s.reason || null })),
  有内容的detail: 有内容.length ? 有内容[0].detail : null,
};
inst()?.close?.();
return out;
`);
check("★ 空分类不再同时说「0 available」和一长句解释（同一件事说两遍）",
      措辞.空格, v => Array.isArray(v) && v.every(x => x.detail === null));
check("★ 空分类那一句要短", 措辞.空格,
      v => Array.isArray(v) && v.every(x => typeof x.reason === "string" && x.reason.length <= 20));
check("有内容的照旧给计数", 措辞.有内容的detail, v => typeof v === "string" && /available/.test(v));

/* ── 25. 装填照卡的判据 · 父层小灰字 · 胶囊不等宽 ──
 *
 * ★★ 装填这一格是**判据来源**的教训，不是一个 bug：
 *   实测 1013 把武器，`reload.value` 有**六种形态**
 *   （null 609 · "-" 242 · "1" 118 · "0" 33 · "2" 8 · "10" 2 · "" 1）。
 *   我第一版判据（挡 "" 和 "0"）让 242 把近战武器长出 Reload；
 *   第二版（数字 > 0）看着全对了 —— **但连发弩的 reload 值就是 "0"**，
 *   pf2e 靠 `|| traits.includes("repeating")` 才把它算成要装填，第二版照样会漏。
 *   现在问的是系统自己算好的 `strike.ammunition`，形态再多也轮不到我们猜。
 */
section("装填与胶囊");
const 装填 = await evaluate(`
${PRELUDE}
const T = pauih._test;
const out = {};
let a = null;
try {
  const eq = game.packs.get("pf2e.equipment-srd");
  const idx = await eq.getIndex({ fields: ["type", "system.reload.value", "system.traits.value"] });
  const 取 = (pred) => [...idx].filter(e => e.type === "weapon").find(pred);
  const 样本 = [
    ["近战", 取(e => e.system && e.system.reload && e.system.reload.value === "-")],
    ["弓",   取(e => e.system && e.system.reload && e.system.reload.value === "0"
                && !(e.system.traits.value || []).includes("repeating"))],
    ["火器", 取(e => e.system && e.system.reload && e.system.reload.value === "1")],
    ["连发", 取(e => (e.system.traits.value || []).includes("repeating"))],
  ].filter(x => x[1]);
  a = await Actor.create({ name: "PAUIH temp ammo", type: "character" }, { render: false });
  const docs = [];
  for (const pair of 样本) {
    const d = (await eq.getDocument(pair[1]._id)).toObject();
    d.system.equipped = { carryType: "held", handsHeld: 1 };
    docs.push(d);
  }
  await a.createEmbeddedDocuments("Item", docs, { render: false });
  await wait(1400);
  const strikes = (a.system.actions || []).filter(x => x.type === "strike");
  out.每把 = 样本.map(pair => {
    const s = strikes.find(x => x.item && x.item.name === pair[1].name);
    const am = s ? s.ammunition : null;
    return { 类: pair[0], reload: pair[1].system.reload.value,
             要装填: am ? !!am.requiresReload : false };
  });
  const 格 = T.collectStrikeAuxiliaries(a).filter(x => /Reload/.test(x.label));
  out.装填格数 = 格.length;
  out.装填格都灰着 = 格.length > 0 && 格.every(x => x.state === "gated");
  out.灰的理由 = 格.length ? 格[0].reason : null;
} finally { if (a) await a.delete(); }
out.清干净 = game.actors.filter(x => x.name.indexOf("PAUIH temp") === 0).length;
return out;
`);
const 类 = (n) => (装填.每把 || []).find(x => x.类 === n);
check("★ 近战（reload \"-\"）不要装填", 类("近战")?.要装填, false);
check("★ 弓（reload \"0\"）不要装填", 类("弓")?.要装填, false);
check("★ 火器（reload \"1\"）要装填", 类("火器")?.要装填, true);
check("★★ 连发弩要装填 —— 它的 reload 值也是 \"0\"，数字判据会漏掉它",
      类("连发")?.要装填, true);
check("★ 没弹药时装填格灰着（角色卡就是这么显示的）", 装填.装填格都灰着, true);
check("★ 而且说得出为什么", 装填.灰的理由, v => typeof v === "string" && /ammunition/i.test(v));
check("测试没在世界里留角色", 装填.清干净, 0);

const 毂与胶囊 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "Strikes");
await 等到(() => inst() && inst().level.title === "Strikes");
hoverEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "第一格");
await 等到(() => root().querySelector("text.pauih-hub-parent"));
const out = {
  父层: (root().querySelector("text.pauih-hub-parent") || {}).textContent || null,
  条目名: (root().querySelector("text.pauih-hub-title") || {}).textContent || null,
  胶囊: [...root().querySelectorAll("circle.pauih-cap")].map(c => ({
    nav: c.dataset.nav || null,
    弧长: +Number(c.getAttribute("stroke-dasharray").split(" ")[0]).toFixed(1),
  })),
};
inst()?.close?.();
return out;
`);
check("★ 悬停时毂里多一行小灰字，写这一层是什么", 毂与胶囊.父层, "Strikes");
check("条目名还在（两行是两件事）", 毂与胶囊.条目名, v => typeof v === "string" && v.length > 0);
/*
 * ⚠ 按**位置**判，不按 `data-nav` 判：那个属性只在格子**可点**时才写上去，
 *   而箭头在没得翻的层里是禁用的 —— 拿它当判据会在"功能正常"时报红。
 *   位置是画出来的顺序（next · back · prev），恒定。
 */
check("★★ 返回键比箭头宽（Nous：左右键太宽，返回该大）", 毂与胶囊.胶囊,
      v => Array.isArray(v) && v.length === 3 && v[1].弧长 > v[0].弧长 * 2);
check("两个箭头一样宽", 毂与胶囊.胶囊,
      v => Array.isArray(v) && v.length === 3 && Math.abs(v[0].弧长 - v[2].弧长) < 0.2);

/* ── 26. 毂里的名字**永远不动** ─────────────────
 *
 * ★★ Nous 2026-08-07 指出的设计错误：
 *   "nous 部分字形在中间位置，然后目录名 strike 上移了为了下面有小字，
 *    然后进入之后 falaise 又下移了给目录让位 —— 不停闪烁变动位置丢失一致性。"
 *   "解释器应该属于附着于一个不变的 element 上。"
 *
 * ⚠ 根因是把「名字+说明」当**一个块居中**：块高一变，名字整体位移。
 *   于是同一个东西在四种状态下待在四个高度，眼睛每次都要重新找。
 *   这一组就钉住那个锚 —— **四种状态，同一个 y**。
 */
section("毂里的名字不动");
const 锚 = await evaluate(`
${PRELUDE}
const 标题 = () => { const t = root().querySelector("text.pauih-hub-title"); return t ? +t.getAttribute("y") : null; };
/* ⚠⚠ **每次都重新查元素，并确认它还挂在文档上**：
 *   换层会把整棵 SVG 换掉，抓着旧引用（或换层前查到的节点）派事件，
 *   事件冒泡不到监听器上 —— 什么也不会发生，而失败长得像"功能没实现"。
 *   这一类坑今天踩到第三次了（滚轮那次、毂文字那次、这次）。 */
const 悬 = (i) => {
  const el = root().querySelector('circle.pauih-sector[data-index="' + i + '"]');
  if (!el || !el.isConnected) return false;
  hoverEl(el, "扇区 " + i);
  return true;
};
const app = await 呼出();
if (!app) return { 呼出失败: true };
const out = {};
await 等到(() => root().querySelector("text.pauih-hub-title"));
out.分类层_没悬停 = { 文: root().querySelector("text.pauih-hub-title").textContent, y: 标题() };
悬(0); await wait(500);
out.分类层_悬停 = { 文: root().querySelector("text.pauih-hub-title").textContent, y: 标题() };
clickEl(root().querySelector('circle.pauih-sector[data-index="0"]'), "Strikes");
await 等到(() => inst() && inst().level.title === "Strikes");
await 等到(() => root().querySelector("text.pauih-hub-title"));
out.内层_没悬停 = { 文: root().querySelector("text.pauih-hub-title").textContent, y: 标题() };
/* ⚠ 换层之后扇区**晚一帧**才挂上去 —— 立刻派悬停事件会打在还不存在的元素上，
 *   而失败长得像"父层小灰字没实现"。要等的是**那个扇区本身**。 */
// 等到**这一层自己的**扇区都画出来了（数量对上）再去悬停
await 等到(() => root().querySelectorAll("circle.pauih-sector").length === inst().level.sectors.length);
await 等到(() => 悬(0) && root().querySelector("text.pauih-hub-parent"));
out.内层_悬停 = { 文: root().querySelector("text.pauih-hub-title").textContent, y: 标题(),
                 父层: (root().querySelector("text.pauih-hub-parent") || {}).textContent || null };
inst()?.close?.();
out.四个y = [out.分类层_没悬停.y, out.分类层_悬停.y, out.内层_没悬停.y, out.内层_悬停.y];
return out;
`);
check("★★ 四种状态下名字在同一个高度（这就是那个不动的锚）",
      锚.四个y, v => Array.isArray(v) && v.every(y => typeof y === "number") && new Set(v).size === 1);
check("★ 而四种状态显示的**内容**确实各不相同（不是因为没变才没动）", 锚, () => {
    const 文 = [锚.分类层_没悬停?.文, 锚.分类层_悬停?.文, 锚.内层_悬停?.文];
    return new Set(文).size >= 3;
});
check("★ 说明文字出现时也不推动名字（父层小灰字挂在它上面）", 锚.内层_悬停?.父层,
      v => typeof v === "string" && v.length > 0);

/* ── 27. 翻页到底就停 · 上弹先问装哪一发 ──────────
 *
 * ★ Nous 2026-08-07："不要无限滚轮：1>2>3 就停下，然后左右键会因为到底了置灰。"
 *   循环的毛病是**没有边界反馈** —— 翻过头和没翻动，画面上分不出来。
 * ★ 上弹："sheet 里面可以选择上子弹，我们的 ui 里面没反应……
 *   做成 spell strike 那样有分支 ui。"候选直接取系统算好的 `ammunition.compatible`。
 */
section("翻页边界与上弹分支");
const 边界 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
/* ⚠ 这一组原来下钻的是 Actions —— 2026-08-07 精简之后它只剩 8 格、**一页就装下了**，
 *   没有翻页条可验。改用 Skills（17 个技能，两页以上），验的是同一套翻页代码。 */
const i = app.level.sectors.findIndex(s => s.label === "Skills");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Skills");
await 等到(() => inst() && inst().level.title === "Skills");
const 箭 = () => [...root().querySelectorAll("g.pauih-cap-g")].map(g => {
  const c = g.querySelector("circle.pauih-cap");
  return { nav: c && c.dataset.nav ? c.dataset.nav : null,
           灰: g.getAttribute("class").indexOf("disabled") >= 0 };
});
const 滚 = (dy) => root().querySelector("svg").dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: dy }));
const out = { 总页: Math.ceil(inst().level.sectors.length / 9) };
out.第0页 = inst().level.paging.page;
/* ⚠ 等胶囊**按新的一层重画完**再读：等到标题变了只保证层换了，
 *   那一刻胶囊还可能是上一层的（禁用状态自然对不上）。
 *   判据取"三格都在、且至少有一格是亮的" —— 分类层的胶囊两箭头全灰。
 *   （这段在模板字面量里，**不能出现反引号**——今天第二次踩） */
await 等到(() => root().querySelectorAll("g.pauih-cap-g").length === 3
  && [...root().querySelectorAll("g.pauih-cap-g")].some(g => g.getAttribute("class").indexOf("disabled") < 0));
out.第0页箭头 = 箭();
滚(-120); await wait(500);
out.第0页往回滚之后 = inst().level.paging.page;
for (let k = 0; k < 6; k++) { 滚(120); await wait(350); }
out.一直往后滚 = inst().level.paging.page;
out.到底箭头 = 箭();
inst()?.close?.();
return out;
`);
check("★★ 第 0 页往回滚不动（不循环）", 边界.第0页往回滚之后, 0);
/* ⚠ 按**位置**判，不按 data-nav 判：禁用的格子根本不写那个属性，
 *   拿它当判据会在"功能正常"时报红（同第 25 组那次）。
 *   顺序是 next · back · prev（画出来的顺序，恒定）。 */
check("★ 第 0 页时「上一项」灰、「下一项」亮", 边界.第0页箭头,
      v => Array.isArray(v) && v.length === 3 && v[2].灰 === true && v[0].灰 === false);
check("★★ 一直往后滚停在最后一页", 边界, () => 边界.一直往后滚 === 边界.总页 - 1);
check("★ 到底时「下一项」灰、「上一项」亮", 边界.到底箭头,
      v => Array.isArray(v) && v.length === 3 && v[0].灰 === true && v[2].灰 === false);

const 上弹 = await evaluate(`
${PRELUDE}
const g = game.actors.getName("PAUIH cls Gunslinger");
if (!g) return { 没有枪手: true };
const s = (g.system.actions || []).filter(x => x.type === "strike" && x.ammunition && x.ammunition.requiresReload)[0];
if (!s) return { 枪手身上没有要装填的武器: true };
const T = pauih._test;
const out = {
  系统给的候选: (s.ammunition.compatible || []).map(c => c.label),
  装填格: T.collectStrikeAuxiliaries(g).filter(x => /Reload/.test(x.label)).map(x => x.label + "[" + x.state + "]"),
};
return out;
`);
check("★ 有弹药时装填格是亮的", 上弹.装填格, v => Array.isArray(v) && v.some(x => /normal/.test(x)));
check("★★ 候选直接来自系统的 ammunition.compatible（就是角色卡那个下拉）",
      上弹.系统给的候选, v => Array.isArray(v) && v.length >= 2 && v.every(x => /Rounds/.test(x)));

/* ── 28. Actions 精简 · 自我效果 · Refocus ──────────
 *
 * ★ Nous 2026-08-07：
 *   "那个 action 大类里面基本上全是用不到的……放 3-4 常用的，
 *    然后就只去读角色表里面的应该就可以。"
 *   "第四的（永远是 ui 里面最后一个）全部用蓝色字写，提醒玩家去在表格里面添加。"
 *   "arcane cascade 用 ui 弹出是使用，但是使用本身不会 apply effect。"
 *   "另外一个 focus spell 也没有 recharge。"
 */
section("Actions 精简 · 自我效果 · Refocus");

const 精简 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
const 分类 = app.level.sectors.map(s => s.id);
const i = app.level.sectors.findIndex(s => s.label === "Actions");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Actions");
await 等到(() => inst() && inst().level.title === "Actions");
/* ⚠⚠ **等层换了不等于画完了**（今天第三次踩）：level 对象先换，SVG 后重绘。
 *   判据取"图标 + 标签的总数等于扇区数"，画完之前它对不上。 */
await 等到(() => {
  const svg = root() && root().querySelector("svg");
  if (!svg) return false;
  const n = svg.querySelectorAll("image").length + svg.querySelectorAll("text.pauih-label").length;
  return n === inst().level.sectors.length;
});
const L = inst().level;
const out = {
  分类,
  条目: L.sectors.map(s => s.id),
  标签: L.sectors.map(s => s.label),
  有翻页条: !!L.paging,
  末位: L.sectors[L.sectors.length - 1],
  蓝字数: [...root().querySelectorAll("text.pauih-label.tone-link")].length,
};
inst()?.close?.();
return out;
`);
check("★★ 只剩三条常驻通用动作（Aid / Take Cover / Tumble Through）", 精简.条目,
      v => Array.isArray(v)
        && v.filter(x => String(x).startsWith("action:")).join(",")
           === "action:aid,action:take-cover,action:tumble-through");
check("★ 其余全部来自角色卡（class: 前缀）", 精简.条目,
      v => Array.isArray(v) && v.some(x => String(x).startsWith("class:")));
check("★★ 末位永远是「去角色卡添加」那一格", 精简.末位, v => v && v.id === "sheet:actions");
check("★ 它用蓝字画出来（tone-link）", 精简.蓝字数, v => v === 1);
/* ⚠ 精简的整个目的就是"一页放得下"。留着翻页条等于告诉玩家还有下文，而并没有。 */
check("★ 精简之后一页就装下，不画翻页条", 精简.有翻页条, false);
check("⚠ 卡上没有自由动作时**不画** Free 那一格", 精简.分类,
      v => Array.isArray(v) && !v.includes("free"));

const 自我效果 = await evaluate(`
${PRELUDE}
const a = game.actors.getName("Nous offnirr");
if (!a) return { 没有测试角色: true };
const 旧 = a.itemTypes.effect.filter(e => /Arcane Cascade/i.test(e.name)).map(e => e.id);
if (旧.length) await a.deleteEmbeddedDocuments("Item", 旧);
const app = await 呼出();
if (!app) return { 呼出失败: true };
const i = app.level.sectors.findIndex(s => s.label === "Actions");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Actions");
await 等到(() => inst() && inst().level.title === "Actions");
const j = inst().level.sectors.findIndex(s => s.label === "Arcane Cascade");
if (j < 0) return { 没有架势: true };
clickEl(root().querySelector('circle.pauih-sector[data-index="' + j + '"]'), "Arcane Cascade");
await 等到(() => a.itemTypes.effect.some(e => /Arcane Cascade/i.test(e.name)), 24);
const eff = a.itemTypes.effect.filter(e => /Arcane Cascade/i.test(e.name))[0];
const out = {
  挂上了: !!eff,
  选择: eff ? (eff.flags.pf2e.rulesSelections || {}).stanceArcaneCascade : null,
  /* ⚠ 顺手验"没有弹窗"：pf2e 的 ChoiceSet 会开 PickAThingPrompt，
   *   预填成功的判据就是**它没出现**。 */
  弹窗: [...foundry.applications.instances.values()].map(w => w.constructor.name)
          .filter(n => /PickAThing|Dialog/.test(n)),
};
const ids = a.itemTypes.effect.filter(e => /Arcane Cascade/i.test(e.name)).map(e => e.id);
if (ids.length) await a.deleteEmbeddedDocuments("Item", ids);
inst()?.close?.();
return out;
`);
check("★★ 点一下架势，effect 真的挂上了（不是只贴张卡）", 自我效果.挂上了, true);
check("★★ 伤害类型已预填 —— 没施过法术就退回武器伤害", 自我效果.选择, "weapon-damage");
check("★ 没有弹出选择题（预填成功的判据就是它不出现）", 自我效果.弹窗,
      v => Array.isArray(v) && v.length === 0);

const 焦点 = await evaluate(`
${PRELUDE}
const a = game.actors.getName("Nous offnirr");
if (!a) return { 没有测试角色: true };
const 原值 = a.system.resources.focus.value;
await a.update({ "system.resources.focus.value": 0 });
const T = pauih._test;
const out = { 空池: null, 满池: null, 恢复后: null };
const app = await 呼出();
if (!app) return { 呼出失败: true };
const i = app.level.sectors.findIndex(s => s.label === "Class" || s.id === "class");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Class");
await 等到(() => inst() && inst().level.canGoBack === true);
out.空池 = inst().level.sectors.map(s => s.id).includes("refocus");
const j = inst().level.sectors.findIndex(s => s.id === "refocus");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + j + '"]'), "Refocus");
await 等到(() => a.system.resources.focus.value > 0, 24);
out.恢复后 = a.system.resources.focus.value;
/* 池子满了之后再看一次：这一格该消失 */
const app2 = await 呼出();
const k = app2.level.sectors.findIndex(s => s.label === "Class" || s.id === "class");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + k + '"]'), "Class");
await 等到(() => inst() && inst().level.canGoBack === true);
out.满池 = inst().level.sectors.map(s => s.id).includes("refocus");
inst()?.close?.();
await a.update({ "system.resources.focus.value": 原值 });
return out;
`);
check("★ 焦点没满时职业层多出 Refocus 一格", 焦点.空池, true);
check("★★ 点它真的把焦点加回来（pf2e 对 Refocus 零自动化）", 焦点.恢复后, v => v >= 1);
check("⚠ 池子满了这一格就不该在（点了没反应的格子会被读成「坏了」）", 焦点.满池, false);

/* ── 29. 加号 · 可点说明 · Spellstrike 充能 · 红边 ──────────
 *
 * ★ Nous 2026-08-07：
 *   "我说的蓝色是中心圆盘上的，边盘上面的 ui 就只放一个蓝色的加号就够，本来就没地方放。"
 *   "把这种说明框变成（截断就截断）可以点击的，点击就会在游戏中打开说明。"
 *   "我们可以自己记账，recharge spellstrike，就像是那个 focus pool 一样。"
 *   "这个置灰的其实可做一个红色边框。"
 */
section("加号 · 可点说明 · 充能 · 红边");

const 出口 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
const i = app.level.sectors.findIndex(s => s.label === "Actions");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Actions");
await 等到(() => inst() && inst().level.title === "Actions");
await 等到(() => {
  const svg = root() && root().querySelector("svg");
  if (!svg) return false;
  return svg.querySelectorAll("image").length + svg.querySelectorAll("text.pauih-label").length
       === inst().level.sectors.length;
});
const 末 = inst().level.sectors[inst().level.sectors.length - 1];
const 蓝 = root().querySelector("text.pauih-label.tone-link");
/* 悬停到它，看毂里换成整句 */
const j = inst().level.sectors.length - 1;
hoverEl(root().querySelector('circle.pauih-sector[data-index="' + j + '"]'), "末位出口格");
await wait(500);
const 毂 = root().querySelector("text.pauih-hub-title");
const out = {
  环上文字: 蓝 ? 蓝.textContent : null,
  环上是蓝的: !!蓝,
  毂里文字: 毂 ? 毂.textContent : null,
  毂里也是蓝的: !!root().querySelector("text.pauih-hub-title.tone-link"),
  末位id: 末.id,
};
inst()?.close?.();
return out;
`);
check("★★ 环上只放一个加号（一格宽约 50px，塞不下句子）", 出口.环上文字, "+");
check("★ 而且是蓝的", 出口.环上是蓝的, true);
check("★★ 毂里才写整句 —— 同一件事两处各用各的说法", 出口.毂里文字, "Add on sheet");
check("★ 毂里那句也是蓝的（蓝＝这是出口不是动作）", 出口.毂里也是蓝的, true);

/*
 * ⛔ **「可点说明」这一组撤掉了**（Nous 2026-08-07："这部分你不用写测试了，我来测试"）。
 *
 * ★ 撤的理由不是懒，是**这个harness 驱动不了它**：
 *   要验的行为是「悬停 → 把鼠标移开 → 那段说明还在 → 点它」，
 *   而"把鼠标移开"是一串真实指针事件（mousemove + mouseover + 命中判定），
 *   合成事件只能凑出其中几个 —— 凑漏一个（少发 mousemove）盘就被
 *   5 秒无操作自动收起判掉，失败长得像"移开之后说明没了"，
 *   **正好把要验的那条盖住**。
 *
 * ⚠ 这一条本身就是这次的教训：上一版我用"合成一个 click 直接打在元素上"验它，
 *   **跳过了"到达它"那一步**，于是测试全绿而功能根本点不到。
 *   ⇒ 验不了"到达"的，就别假装验过。这一段归实机手测。
 *
 * ★ 但**这一类里有能验的那一半**，见下面一组：
 *   "点得到吗"验不了（要真实命中），"离开再回来还弹不弹"验得了 ——
 *   后者只跟状态机有关，不跟指针能不能摸到有关。别因为前半验不了就整块放弃。
 */

/* ── 29.5 全名提示：离开再回到同一格，还要再弹 ──────────
 *
 * ★ Nous 2026-08-08 实机报的：
 *   > "只要我移开了之后再回去就不会再显示了，就像是显示只有一次一样，
 *   >  但是我看了别的再回去又好了。"
 *
 * ★ 病因是把两件语义不同的事绑在同一个判断上（详见 wheel-app 的 `#onHover`）：
 *   毂是**停留式**的（离开不清空），提示是**跟随式**的，
 *   而"同一格不重画"这道门把两件事一起跳过了。
 *
 * ⚠⚠ 复现路径必须是「**离开扇区** → 回到同一格」，不能是「看别的格 → 回来」——
 *   后者恰好绕开病灶（下标变了），是 Nous 那句"看了别的再回去又好了"的由来。
 *   ★ **一条走对了路的断言和一条走错了路的断言长得一模一样**，都是绿的。
 */
section("全名提示：离开再回到同一格");

const 全名 = await evaluate(`
${PRELUDE}
const app = await 呼出();
if (!app) return { 呼出失败: true };
const i = app.level.sectors.findIndex(s => s.label === "Actions");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Actions");
await 等到(() => inst() && inst().level.title === "Actions");

/* 记下每一次 tooltip 激活 —— 提示有没有"再弹"，只有这里看得见 */
const 弹过 = [];
const 原activate = game.tooltip.activate.bind(game.tooltip);
game.tooltip.activate = (el, opts) => { 弹过.push((opts && opts.text) || null); return 原activate(el, opts); };
const 格 = (n) => root().querySelector('circle.pauih-sector[data-index="' + n + '"]');

try {
  /* ① 找一格名字长到会被截断的（只有那种才有全名提示） */
  let 目标 = -1;
  for (let n = 0; n < inst().level.sectors.length; n++) {
    if (!格(n)) continue;
    弹过.length = 0;
    hoverEl(格(n), "找长名字 " + n);
    await wait(150);
    if (弹过.filter(Boolean).length) { 目标 = n; break; }
  }
  if (目标 < 0) return { 没有被截断的名字: true };

  /* ② ★ 离开扇区 —— 移到毂上。毂内元素都是 pointer-events:none，
        命中会落到 svg 本身，于是 dataset.index 是 undefined，
        正是"鼠标不在任何一格上"那个状态。 */
  hoverEl(root().querySelector("svg"), "毂/盘心");
  await wait(150);

  /* ③ 回到同一格 —— 修好之前这里什么都不会发生 */
  弹过.length = 0;
  hoverEl(格(目标), "回到同一格");
  await wait(200);
  const 回来弹了 = 弹过.filter(Boolean).length > 0;

  /* ④ 对照组：连着再进一次，照样要弹（幂等，不是"每两次一回"） */
  弹过.length = 0;
  hoverEl(root().querySelector("svg"), "毂/盘心");
  await wait(120);
  hoverEl(格(目标), "第三次进同一格");
  await wait(200);
  return { 回来弹了, 再进一次也弹: 弹过.filter(Boolean).length > 0, 目标 };
} finally {
  game.tooltip.activate = 原activate;
  inst()?.close?.();
}
`);
if (全名.没有被截断的名字) {
  check("⚠ 这一层没有被截断的名字，跳过（换个名字更长的角色再验）", true, true);
} else {
  check("★★ 离开扇区再回到同一格，全名提示要再弹一次", 全名.回来弹了, true);
  check("★ 而且是幂等的 —— 不是「每两次才弹一回」", 全名.再进一次也弹, true);
}

const 充能 = await evaluate(`
${PRELUDE}
const a = game.actors.getName("Nous offnirr");
if (!a) return { 没有测试角色: true };
await a.setFlag("player-action-ui-hub", "spellstrikeSpent", true);
const app = await 呼出();
if (!app) return { 呼出失败: true };
const i = app.level.sectors.findIndex(s => s.id === "class");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + i + '"]'), "Class");
await 等到(() => inst() && inst().level.canGoBack === true);
await 等到(() => root().querySelectorAll("g.pauih-sector-g.state-gated").length > 0);
const L = inst().level;
const ss = L.sectors.find(s => s.label === "Spellstrike");
const out = {
  用掉时灰: ss ? ss.state : null,
  理由: ss ? ss.reason : null,
  有充能键: L.sectors.some(s => s.id === "recharge-spellstrike"),
  红边格数: root().querySelectorAll("g.pauih-sector-g.state-gated").length,
};
const j = L.sectors.findIndex(s => s.id === "recharge-spellstrike");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + j + '"]'), "Recharge");
await 等到(() => a.getFlag("player-action-ui-hub", "spellstrikeSpent") !== true, 24);
out.充能后 = a.getFlag("player-action-ui-hub", "spellstrikeSpent");
/* 充完再看一次：灰显与充能键都该消失 */
const app2 = await 呼出();
const k = app2.level.sectors.findIndex(s => s.id === "class");
clickEl(root().querySelector('circle.pauih-sector[data-index="' + k + '"]'), "Class");
await 等到(() => inst() && inst().level.canGoBack === true);
const L2 = inst().level;
out.充能后还有键 = L2.sectors.some(s => s.id === "recharge-spellstrike");
out.充能后的态 = (L2.sectors.find(s => s.label === "Spellstrike") || {}).state;
inst()?.close?.();
return out;
`);
check("★ 用掉之后 Spellstrike 灰显", 充能.用掉时灰, "gated");
/* ⛔ 上一轮的病根：给灰显编了一句"卡上说的"，而卡从来没说过。
 *   ⚠ 药是**不许编来源**，不是"必须报来源" —— 后半句 Nous 2026-08-07 否掉了。 */
check("★★ 灰显的理由只说事实，不冒充谁的断言", 充能.理由,
      v => /recharge/i.test(String(v)) && !/sheet|pf2e|module/i.test(String(v)));
check("★ 多出一颗充能键", 充能.有充能键, true);
check("★ 灰着的格子画了红边（gated 有自己的 filter，和 risky 的黄边同一种语言）",
      充能.红边格数, v => v >= 1);
check("★★ 点充能真的把账清了", 充能.充能后, v => v !== true);
check("★ 充完那颗键就消失", 充能.充能后还有键, false);
check("★ 充完 Spellstrike 也不灰了", 充能.充能后的态, "normal");

process.exit(report());
