# 轮盘几何 · 交接说明

> 2026-08-05。这一轮**只动了形状**,功能一行没碰。
> 方法走的是 `claude-draws` skill(五步:识别 → 分解 → 重构 → 验证 → 交付)。

## ⚠ 先说清楚这个文件夹

| 位置 | 是什么 |
|---|---|
| `Made by NOUS\FoundryVTT mods\player-action-ui-hub\`(**本文件夹**) | 2026-08-04 立项时的空壳(`module.json` 是 `v0.0.0`,README 写着"尚未实施")+ 本次交接材料 |
| `Desktop\NOUS-Publishes\FoundryVTT mods\player-action-ui-hub\` | **真源码**(`v0.2.0`,git 工作副本)。改代码去这里 |

本文件夹的 `module.json` / `README.md` 是**过时残留**,不要当真;
`wheel-preview.html` 和本文件是这次的交接材料。

## 交接材料

- **`wheel-preview.html`** —— 双击即可打开。内嵌的是**真模块**不是复制品:
  几何 = `src/geometry.ts` 的打包产物,样式 = `styles/wheel.css` 原文,
  常量 = 从 `src/wheel-app.ts` 抠出来的同一组数字。
  页面底部会实时打印参数分解。
  **改几何请改源码后重新生成,别在这个 HTML 里改。**

## 几何:三个自由量,其余全算出来

```
R_HUB  = 68     中心毂半径
GUTTER = 5      毂与环之间的切割（留空，不画任何东西）
W      = 13.5   笔半径 → 环宽 = 2W = 27

R       = R_HUB + GUTTER + W = 86.5    环中线（笔尖走的那条圆）
R_OUTER = R + W = 100                  环外缘
VIEW    = 2 × R_OUTER = 200            viewBox 边长 —— 「环的外缘就是 UI 边缘」由此保证
```

**动 `R_HUB` / `GUTTER` / `W` 任意一个,后面三个自动跟上,画布也跟着改。**
不要直接去改 `R` / `R_OUTER` / `VIEW`,它们是派生量。

## 环 = 一支笔沿中线走

扇区不是"大圆减小圆"的 path,是**一条描边弧**:

- 一个 `<circle r=R>` + `stroke-width = 2W` + `stroke-dasharray`
- 分格、缝隙、缺口全由 `dasharray` 表达
- 命中区域是浏览器原生的(描边区域),**没有自己写的 hitTest**

`src/geometry.ts` 导出四个函数,外环和底部胶囊**共用同一套**:

| 函数 | 作用 |
|---|---|
| `sectorArc(spec, i)` | 第 i 格怎么画 → `{dash, rotate, strokeWidth}` |
| `sectorCentroid(spec, i)` | 第 i 格的视觉中心(落在中线上),摆图标/文字用 |
| `ringCapPath(spec, which, bulge?)` | 端头的**半圆**帽 |
| `capOvershoot(R, W, bulge?)` | 圆头在笔心之外多占的角 = `asin(W·bulge/R)` |

`RingSpec.center` 默认 `-π/2`(正上方);底部胶囊传 `π/2` 就整套复用。

## 缺口是算出来的,不是估的

```
GAP_ANGLE = CAP_INK + 2·CAP_CLEAR + 2·capOvershoot(R, W, CAP_BULGE)
          = 56°    + 2×4°        + 2×9°                    = 82°
ARC_SPAN  = 360° − GAP_ANGLE
```

三项各自的意思:胶囊自己跨多少 / 胶囊两侧留白 / **环两端圆头多占的角**。

> **最后一项是最容易漏的,漏了圆头就会侵进缺口压住胶囊** —— 这正是这一轮修掉的原始 bug,
> 已钉成回归测试(含一个"复现老 bug 形状"的反向用例)。

## 底部胶囊 = 一段带端帽的分段弧

和外环同构,同一条中线(`R`),所以贴合是几何保证的。

```
CAP_H     = 23              胶囊厚度（径向）→ 它的笔半径 W_CAP = 11.5
CAP_SEAM  = 1.6             格与格之间的缝（弧长）
CAP_INK   = 56°             胶囊墨迹跨多少（含它自己两端圆头）
CAP_CLEAR = 4°              胶囊与环端帽之间的留白
```

⚠ **格子顺序是反的**:角度从正上方顺时针增大,底部一带下标越大越靠左,
所以 `‹` 排在数组**最后**。

## 想调什么 → 动哪个

| 想要 | 动 | 会牵动 |
|---|---|---|
| 环更粗/更细 | `W` | 环外缘、viewBox、缺口(圆头占角变了) |
| 中心毂更大 | `R_HUB` | 整体尺寸链 |
| 毂和环离远点 | `GUTTER` | 同上 |
| 胶囊更宽 | `CAP_INK` | 缺口自动变宽 |
| 端帽往两边挤、给胶囊腾地方 | `CAP_CLEAR` | 缺口变宽,扇区变短 |
| 胶囊更厚 | `CAP_H` | 它自己的圆头占角 |
| 端头胖瘦 | `CAP_BULGE`(现 1) | 缺口(它吃同一个值) |

**一个手填的坐标都没有。** 所有位置都由这几个数算出来。

## 验证怎么跑

```bash
npm run guard      # tsc --noEmit && esbuild && vitest    ← 51 个测试
```

几何的回归测试在 `tests/geometry.test.ts`,重点两组:

- `capOvershoot` —— 钉住"缺口必须把圆头算进去"
- `ringCapPath` —— 钉住半圆帽的两端落在 `R±W` 上、两端 sweep 相反、`bulge` 只收切向

改完形状要看效果,重新生成预览:

```bash
npx esbuild src/geometry.ts --bundle --format=iife --global-name=Geo --outfile=<tmp>/geo.js
# 然后把 geo.js / wheel.css / wheel-app.ts 的常量重新拼进 wheel-preview.html
```

## 这一轮改了什么(给下一个窗口的上下文)

1. 扇区从**扇形 path** 换成**笔扫掠**(`R`/`W` 正交,端头圆角是笔尖形状)
2. 缺口补上圆头占角那一项(原始 bug)
3. 毂与环之间那圈从"亮环"改成**切割**(留空,让底下透上来)
4. `R_OUTER` 74 → 100,环外缘顶满 viewBox
5. 底部胶囊:三颗独立药丸 → 一整条切三份 → **弧形分段弧**(跟着环弯)
6. 删掉从未被调用的 `hitTest`(命中一直是浏览器在做)
7. `.pauih-sector ~ .pauih-label` 这类兄弟选择器改成直接挂 state class
   (扇区包进 `<g>` 后兄弟关系会断,**静默失效**)

## ⛔ 接下来别碰外观

`docs/2026-08-05-plan-v0.3-v0.6.md` 的 Task 10–16 是采集器/执行器/分页的活,
一律**复用现有样式类,不新增 CSS、不调几何常量**。形状要再改就单独开一轮。

要动形状时先读 `claude-draws` skill —— 尤其是
`references/pitfalls.md`(半透明形状不要重叠、`<circle>` 的 fill 默认不是 none、
发光要挂组上、椭圆弧的 rx/ry 是旋转后的轴)。
