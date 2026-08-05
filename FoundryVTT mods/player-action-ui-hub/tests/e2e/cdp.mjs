/**
 * 游戏内测试用的 CDP 客户端 —— 直连 Chrome 调试端口执行页面内脚本。
 *
 * ★ 为什么不用 chrome-devtools MCP：那个用的是共享的默认 profile，
 *   可能被别的会话占着（2026-08-05 因此掐掉过别人正在做的工作）。
 *   这里连的是项目专用实例（见项目根 `启动-claude-vtt浏览器.bat`）。
 *
 * ⚠ 这些测试**需要 Foundry 正在运行且已登录世界**，所以不进 `npm test`。
 *   跑法：`npm run test:e2e`。
 */
const PORT = process.env.CDP_PORT ?? "9333";
/*
 * 默认给得宽：有几组测试要连着呼出五次轮盘、再逐个 HEAD 请求验图标路径，
 * 每步都有真实的界面延迟。卡住时的报错会指出常见原因，不会只丢个超时。
 */
const TIMEOUT_MS = Number(process.env.CDP_TIMEOUT ?? 240000);

/** 在页面里求值一段异步函数体，返回其 return 值。 */
export async function evaluate(source) {
    let targets;
    try {
        targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch {
        throw new Error(
            `连不上调试端口 ${PORT}。\n` +
            `  先双击项目根的「启动-claude-vtt浏览器.bat」，并在里面登录世界。`);
    }
    const page = targets.find(t => t.type === "page" && !t.url.startsWith("devtools://"));
    if (!page) throw new Error("调试端口上没有可用页面");

    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let id = 0;
        const pending = new Map();
        const timer = setTimeout(() => {
            try { ws.close(); } catch {}
            reject(new Error(
                `页面内脚本超时 ${TIMEOUT_MS}ms。\n` +
                `  常见原因：pf2e 弹了对话框在等人（加值框 / PickAThingPrompt）。`));
        }, TIMEOUT_MS);

        const send = (method, params = {}) => new Promise((res, rej) => {
            const i = ++id;
            pending.set(i, { res, rej });
            ws.send(JSON.stringify({ id: i, method, params }));
        });

        ws.addEventListener("message", (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) {
                const { res, rej } = pending.get(m.id);
                pending.delete(m.id);
                m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
            }
        });
        ws.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error("WebSocket 连接失败"));
        });
        ws.addEventListener("open", async () => {
            try {
                await send("Runtime.enable");
                const r = await send("Runtime.evaluate", {
                    expression: `(async () => { ${source} })()`,
                    awaitPromise: true, returnByValue: true, userGesture: true,
                });
                clearTimeout(timer);
                try { ws.close(); } catch {}
                if (r.exceptionDetails) {
                    const e = r.exceptionDetails.exception;
                    reject(new Error(`页面内抛错: ${e?.description ?? e?.value ?? "未知"}`));
                    return;
                }
                resolve(r.result?.value ?? null);
            } catch (err) {
                clearTimeout(timer);
                try { ws.close(); } catch {}
                reject(err);
            }
        });
    });
}

/* ── 极简断言与汇报 ────────────────────────────────── */

const results = [];

/*
 * ⚠ **立即打印，不要攒到最后**。整轮跑几分钟，攒着的话中途卡死就完全看不出
 *   卡在哪一步 —— 第一次跑就栽在这上面：超时报错时一行输出都没有，
 *   让人误以为是第一组挂了。
 */
export function check(名称, 实际, 判据, 期望描述) {
    const ok = typeof 判据 === "function" ? !!判据(实际) : 实际 === 判据;
    results.push({ ok });
    if (ok) console.log(`  ✓ ${名称}`);
    else {
        console.log(`  ✗ ${名称}`);
        console.log(`      期望: ${期望描述 ?? String(判据)}`);
        console.log(`      实际: ${JSON.stringify(实际)}`);
    }
    return ok;
}

/** 每组开头就打印，卡住时最后一行就是卡住的那组。 */
export function section(标题) {
    console.log(`\n── ${标题} ──`);
}

/** 汇总并返回退出码。 */
export function report() {
    const pass = results.filter(r => r.ok).length;
    const fail = results.length - pass;
    console.log(`\n通过 ${pass} · 失败 ${fail}`);
    return fail === 0 ? 0 : 1;
}

/* ── 页面内常用片段（拼进 evaluate 的脚本里）───────── */

/** 等世界就绪；顺带把轮盘关干净。 */
export const PRELUDE = `
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 60 && !window.game?.ready; i++) await wait(1000);
if (!window.game?.ready) return { __error: "世界未就绪（是不是还没登录？）" };
const inst = () => [...foundry.applications.instances.values()]
  .find(a => a.options?.id === "player-action-ui-hub-wheel");
const root = () => document.getElementById("player-action-ui-hub-wheel");
// ⚠ 不要 await close()：某些状态下它的 Promise 不 settle，会把测试挂死
inst()?.close?.(); await wait(900);
const clickEl = (el, what) => {
  if (!el) throw new Error("找不到可点元素: " + (what ?? "?"));
  const r = el.getBoundingClientRect();
  for (const t of ["pointerdown","mousedown","pointerup","click"])
    el.dispatchEvent(new PointerEvent(t, { bubbles:true, cancelable:true, composed:true,
      clientX: r.left + r.width/2, clientY: r.top + r.height/2, button: 0 }));
};
/*
 * ⚠ 必须**等上一次彻底关掉**再呼下一次：AppV2 的关闭有过渡动画，
 *   元素比 rendered 晚约 1 秒消失。连续呼出时不等，新的那次会被吞掉。
 *   （这条脆弱性是把测试固化下来才暴露的 —— 手写一次性探针时碰不到。）
 */
/*
 * 只等实例消失，不等 DOM 消失 —— AppV2 关闭有约 1 秒过渡动画，
 * 等 DOM 会让每次呼出白白多花 1 秒，五次下钻就拖垮整轮测试。
 * DOM 残留不影响新实例：AppV2 按 id 管理，同 id 会替换掉旧节点。
 *
 * 注意：这段字符串本身是模板字面量，**里面不能出现反引号**。
 */
const 关干净 = async () => {
  for (let i = 0; i < 12 && inst(); i++) { inst()?.close?.(); await wait(100); }
};
/*
 * 等某个条件成立，而不是死等固定毫秒。
 * 固定等待在慢的层上会假失败：Skills 有 17 个技能要渲染，900ms 不够，
 * 于是"下钻后盘没了"—— 实际只是还没画完（第一次跑就报了这个假阳性）。
 */
const 等到 = async (条件, 上限 = 20) => {
  for (let i = 0; i < 上限; i++) { if (条件()) return true; await wait(250); }
  return false;
};
const 呼出 = async () => {
  await 关干净();
  const board = document.getElementById("board");
  for (let 次 = 0; 次 < 3; 次++) {
    canvas.tokens.placeables.find(t => t.actor?.type === "character")?.control({ releaseOthers: true });
    for (const t of ["pointerdown","mousedown","pointerup","click"])
      board.dispatchEvent(new PointerEvent(t, { bubbles:true, cancelable:true, composed:true,
        clientX: 800, clientY: 700, ctrlKey: true, button: 0 }));
    await wait(900);
    if (inst()) return inst();
    await wait(600);   // 没出来就再等等再试，别直接返回 undefined 让断言看不懂
  }
  return null;
};
`;
