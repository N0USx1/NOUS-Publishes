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
/*
 * ⛔⛔ 注意：这一整段活在 PRELUDE 这个**模板字符串里面** ——
 *   注释里一个反引号都不能出现，否则当场把字符串截断
 *   （2026-08-08 就这么写坏过一次，报错还指在无关的行上）。
 *   所以下面提到标识符一律用「」，不用反引号。
 *
 * ★★ 合成一串事件时，「照真人会产生的那一串发，并且从真人的命中路径进」。
 *   （playbook 第 18 条。这两件事各自都坑过我们一次，方向还相反。）
 *
 * ① 补齐「到达」那几个事件：原来只发 pointerdown/mousedown/pointerup/click，
 *    真人要点一个东西必须先把鼠标移过去 —— 那一下移动本身可能改变界面
 *    （2026-08-07：移过去正好把要点的东西抹掉，而断言当时是绿的）。
 *    ⇒ 前面补 pointerover / mouseover / mousemove / pointermove。
 *
 * ② 换成 elementFromPoint 命中的那个元素：合成事件直接 dispatch 到某个元素上
 *    会「绕过 pointer-events」—— 于是
 *    - 标了 pointer-events:none 的元素照样接得住，而真人点它时事件其实落在底下那层；
 *    - 反过来，真正坏掉的 pointer-events 也被绕过去，测试照绿。
 *    ⚠ 两个方向都会骗人：坏的放过去（2026-08-08 毂标题点不动，探针没抓到），
 *      好的报成坏（同日：我把 click 派到 .pauih-cap-glyph 上，那是
 *      pointer-events:none 的字形，命中本该落到底下的 .pauih-cap，
 *      于是「翻页按钮点不动」—— 一个我自己造出来的假 bug）。
 *    ★ elementFromPoint 遵守 pointer-events，问它拿到的就是真人会点到的那个。
 *
 * ⚠ 顺带查 isConnected：重绘会把整棵子树换掉，抓着旧引用派事件什么也不会发生，
 *   而失败长得像「功能没实现」（playbook 第 17 条）。
 */
/*
 * 问「真人点这个坐标，事件会落到谁身上」。
 *
 * ⚠⚠ **elementFromPoint 拿的是外接框中心，这对扇区不成立**（2026-08-08 实测）：
 *   一格扇区是**一个 <circle r=R> 靠 dasharray 切出来的**，
 *   它的外接框是**整个圆**，中心落在**盘心**（毂上）—— 跟那一格毫无关系。
 *   照着问会拿到毂，于是点击落到一个不相干的元素上，测试报「点不动」。
 *   ★ 教训与它要防的那条同源：**一个通用改法在一种元素上成立，不等于在所有元素上成立**。
 *
 * ⇒ 分两种命中，只退回其中一种：
 *   - 命中的是 el 的**祖先容器**（svg / content）⇒ 这个点根本不在 el 的实心部分上
 *     （描边弧、L 形、空心框都会这样）。采信它等于把事件派到整个盘上，
 *     dataset 全丢，失败长得像「悬停没反应」。⇒ **退回 el**。
 *   - 命中的是**别的元素**（兄弟、或 el 内部的子节点）⇒ 那就是真人会碰到的那个，**采信**。
 *     ★ 我撞过的假 bug 正是这一类：click 派到 pointer-events:none 的
 *       .pauih-cap-glyph 上，而真人点那个字，事件其实落在兄弟节点 .pauih-cap 上。
 *
 * ⚠ 这两种情况都真实发生过，而且**第一版判据把它们混成了一条**
 *   （写了 hit.contains(el) 就等于把祖先也采信）——
 *   写出来的当天就造了一个假阴性：悬停验不到，看着像功能没做。
 *   ★ 一个"更真实"的驱动方式**自己也会引入 bug**，它同样要验。
 */
const 真命中 = (el, cx, cy) => {
  const hit = document.elementFromPoint(cx, cy);
  if (!hit) return el;
  if (hit !== el && hit.contains(el)) return el;   // 祖先 → 这个点不在 el 身上
  return hit;
};
const clickEl = (el, what) => {
  if (!el) throw new Error("找不到可点元素: " + (what ?? "?"));
  if (!el.isConnected) throw new Error("元素已不在文档上（被重绘换掉了）: " + (what ?? "?"));
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const 命中 = 真命中(el, cx, cy);
  const p = { bubbles:true, cancelable:true, composed:true, clientX:cx, clientY:cy,
              button:0, pointerId:1, isPrimary:true };
  for (const t of ["pointerover","mouseover","mousemove","pointermove",
                   "pointerdown","mousedown","pointerup","mouseup","click"])
    命中.dispatchEvent(new PointerEvent(t, p));
};
/*
 * 悬停一个元素 —— 与 clickEl 同一套规矩：走命中路径、发全那一串。
 * ⚠ mousemove 不能省：只发 mouseover 时，界面里任何「有没有人在操作」
 *   的判断都收不到信号，失败会长成别的样子，正好盖住要验的那一条
 *   （2026-08-07 踩过：自动收起被误触发，看起来像「移开之后内容没了」）。
 */
const hoverEl = (el, what) => {
  if (!el) throw new Error("找不到可悬停元素: " + (what ?? "?"));
  if (!el.isConnected) throw new Error("元素已不在文档上（被重绘换掉了）: " + (what ?? "?"));
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const 命中 = 真命中(el, cx, cy);
  const p = { bubbles:true, cancelable:true, composed:true, clientX:cx, clientY:cy,
              pointerId:1, isPrimary:true };
  for (const t of ["pointerover","mouseover","mousemove","pointermove"])
    命中.dispatchEvent(new PointerEvent(t, p));
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
