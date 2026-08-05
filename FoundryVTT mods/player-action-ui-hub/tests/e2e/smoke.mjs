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

const 期望分类 = ["Strikes", "Actions", "Skills", "Class", "Spells"];

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
check("五个分类齐全", 分类.分类, v => JSON.stringify(v) === JSON.stringify(期望分类), 期望分类.join("/"));
check("分类层全部走图标（不退回文字）", 分类.退回文字数, 0);
check("图标数 = 分类数", 分类.图标数, 5);

/* ── 3. 每个分类都能下钻 ──────────────────────── */
section("下钻");
const 下钻 = await evaluate(`
${PRELUDE}
const out = {};
for (const i of [0,1,2,3,4]) {
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
for (const i of [0,1,2,3,4]) {
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
const [做出来的] = await actor.createEmbeddedDocuments("Item", [data]);
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

process.exit(report());
