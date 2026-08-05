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

process.exit(report());
