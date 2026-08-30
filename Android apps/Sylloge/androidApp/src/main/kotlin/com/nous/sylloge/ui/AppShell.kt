package com.nous.sylloge.ui

import androidx.annotation.StringRes
import com.nous.sylloge.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.AnchoredDraggableDefaults
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * 上下两张卡的档位。**一条轴两档**（Nous 2026-08-25 由三档简化）。
 *
 * ⚠️ 原来有第三档 `6:4 看日志`，编目下沉后没了用途 ⇒ 删。
 * ★ 两档之后「两张卡都收起 = 空屏」这个非法态**结构性不存在**，
 * 拒绝动画（红 + 抖）随之一并删掉。
 */
enum class Detent(val topWeight: Float, @StringRes val labelRes: Int) {
    /** 看列表：上卡压成一条。⚠️ 试过 0.5，Nous 看了说不行 ⇒ 回 1。 */
    Gallery(1f, R.string.detent_list),
    /** 常态（默认） */
    Normal(3f, R.string.detent_normal),
}

/** 外壳内边距。⚠️ 抽成常量，⛔ 别多处各写一个 10.dp。 */
val ShellPadding = 10.dp
private const val SPAN = 10f

/**
 * 主外壳。⛔ 这个包里不许 import `android.*` —— 只吃纯数据 + 回调。
 *
 * P5（2026-08-25）后布局：上卡 = 会说话的卡（不分页）；
 * 下卡 = **唯一一页**（文件夹焦点列表）。中缝只剩右侧换档手柄 ——
 * 页点和返回键都随图库一起切掉了。
 */
@Composable
fun AppShell(
    deck: DeckState,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    /** 上卡第 2 页：日志（M7 的 UI 落点，Nous 2026-08-25 定）。 */
    logPage: @Composable () -> Unit,
    /** 下卡第 1 页：文件夹焦点列表。 */
    folderPage: @Composable () -> Unit,
    /** 下卡第 2 页：说明此 app（Nous 2026-08-25 加）。 */
    aboutPage: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    // ★★ **用官方的 AnchoredDraggable，⛔ 不手搓。**
    // 手搓版把跟手值和落位值拆成两个变量走散过（回弹跳变），官方 state.offset
    // 是单一真相源；flingBehavior 的速度/位置阈值和衰减是调校过的常数。
    // ⚠️ 教训：**手感这种东西尤其不能靠记忆写**。
    val density = LocalDensity.current
    val state = remember {
        AnchoredDraggableState(initialValue = Detent.Normal)
    }
    var containerPx by remember { mutableIntStateOf(0) }

    // 容器高度一知道就把锚点摆上去。锚点 = **中缝的位置**（上卡的高度，像素）。
    LaunchedEffect(containerPx) {
        if (containerPx > 0) {
            state.updateAnchors(
                DraggableAnchors {
                    Detent.Gallery at containerPx * (Detent.Gallery.topWeight / SPAN)
                    Detent.Normal at containerPx * (Detent.Normal.topWeight / SPAN)
                }
            )
        }
    }

    // ⚠️⚠️ **`state.offset` 只在 layout 阶段读**（2026-08-25 lint 抓出来的：
    //    `Reading a value annotated with @FrequentlyChangingValue inside composition`）——
    //    在组合里读它 = 推中缝的每一帧都重组整个外壳。
    //    ⇒ 用 `Modifier.layout`，和 FolderFocus/PrepWheel 同一条纪律。
    // ⚠️ 锚点还没摆上时 `offset` 是 NaN，⛔ 不能直接用（`requireOffset()` 会抛）。
    val topHeight = Modifier.layout { measurable, constraints ->
        val px = (if (state.offset.isNaN()) containerPx * (Detent.Normal.topWeight / SPAN)
                  else state.offset).toInt().coerceIn(0, constraints.maxHeight)
        val p = measurable.measure(constraints.copy(minHeight = px, maxHeight = px))
        layout(p.width, px) { p.place(0, 0) }
    }
    val compact = state.targetValue == Detent.Gallery
    val scope = rememberCoroutineScope()
    // ★ 下卡重新分页（文件夹选择 / 说明）⇒ 中缝的页点也跟着回来。
    // ⚠️ 页点是**有内容才画**：⛔ 不许为了"以后会有"先摆一个空页（分册 §7.5 假入口）。
    val bottomPager = rememberPagerState(pageCount = { 2 })
    // ★ 上卡也回到两页：会说话的卡 / 日志。⚠️ 是因为**日志有真内容了**才加的页，
    //   ⛔ 不是"先摆个位以后填"（分册 §7.5 假入口）。
    val topPager = rememberPagerState(pageCount = { 2 })

    // ★ 底色**黑**，炫光**铺满整块屏（含刘海）**（Nous 2026-08-25）。
    // ⚠️ 背景必须 full-bleed ⇒ ⛔ 最外层不裹 `safeDrawingPadding()`；
    // 内容由下面两个**显式空位**顶开。炫光画在 CardSurface（贴卡形状），不在这里手画。
    Column(
        modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        // ── 刘海槽：黑底 + 炫光从这里透出来 ──
        Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.safeDrawing))

        Column(
            Modifier
                .weight(1f)
                .padding(ShellPadding)
                .onSizeChanged { containerPx = it.height },
        ) {
            // ───────── 上卡：会说话的卡 ─────────
            CardSurface(
                state = deck,
                modifier = Modifier.fillMaxWidth().then(topHeight),
                // ★ 状态色跟着翻页淡出（Nous 2026-08-26 拍板）。
                //   连续位置 = 页码 + 偏移分数 ⇒ 手指滑到哪、色就淡到哪，
                //   ⛔ 不是"翻完了才切"（那会在手势收尾那一瞬间闪一下）。
                stateStrength = 1f -
                    (topPager.currentPage + topPager.currentPageOffsetFraction).coerceIn(0f, 1f),
            ) {
                // ★ 卡面固定，只有内容在滑（卡是锚，⛔ 锚不能跟着页跑）。
                HorizontalPager(topPager, Modifier.fillMaxSize()) { page ->
                    when (page) {
                        0 -> TalkingBody(deck, onConfirm, onCancel, compact)
                        else -> logPage()
                    }
                }
            }

            // ───────── 中缝：只剩换档手柄 ─────────
            SeamStrip(
                topPage = topPager.currentPage,
                bottomPage = bottomPager.currentPage,
                detent = state.settledValue,
                // ★ 点也能换档：swipe 对运动障碍用户不友好，而这里没有备用按钮。
                onTap = {
                    scope.launch {
                        state.animateTo(
                            if (state.settledValue == Detent.Normal) Detent.Gallery else Detent.Normal
                        )
                    }
                },
                dragModifier = Modifier.anchoredDraggable(
                    state = state,
                    orientation = Orientation.Vertical,
                    flingBehavior = AnchoredDraggableDefaults.flingBehavior(state),
                ),
            )

            // ───────── 下卡：唯一一页 ─────────
            // ⚠️ 下卡也用 M3 `Card`，⛔ 不用裸 Surface（白拿 token 和语义）
            Card(
                modifier = Modifier.fillMaxWidth().weight(1f),
                shape = RoundedCornerShape(CardCorner),
            ) {
                // ★ **卡面固定，只有内容在滑** —— Pager 在卡**里面**，
                //   ⛔ 不是把整张卡当成一页去滑（卡是锚，锚不能动）。
                HorizontalPager(bottomPager, Modifier.fillMaxSize()) { page ->
                    when (page) {
                        0 -> folderPage()
                        else -> aboutPage()
                    }
                }
            }
        }

        // ── 底 bar 槽 ──
        Spacer(Modifier.fillMaxWidth().windowInsetsBottomHeight(WindowInsets.safeDrawing))
    }
}

/**
 * 中缝。P5 后只干一件事：**推它 / 点它换档**（手柄靠右，单手拇指够得到）。
 * ⚠️ 视觉只有 4dp 的小横条，但**可操作区域给满** —— 摸得着的不能比看得见的小。
 */
@Composable
private fun SeamStrip(
    topPage: Int,
    bottomPage: Int,
    detent: Detent,
    onTap: () -> Unit,
    dragModifier: Modifier,
) {
    Box(Modifier.fillMaxWidth().height(34.dp)) {
        // ── 左边：两组页点，上面那组属于上卡、下面那组属于下卡 ──
        // ★ **位置本身说清了归属**，⛔ 不需要文字标签。
        Column(
            Modifier.align(Alignment.CenterStart).padding(start = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Dots(2, topPage, stringResource(R.string.card_top))
            Dots(2, bottomPage, stringResource(R.string.card_bottom))
        }
        // ⚠️ `semantics {}` 不是 Composable 上下文 ⇒ 字符串必须**先算好**再传进去，
        //    ⛔ 不能在块里调 stringResource（编译不过）。
        val dividerDesc = stringResource(R.string.divider_desc, stringResource(detent.labelRes))
        Box(
            Modifier
                .align(Alignment.CenterEnd)
                .height(34.dp)
                .width(96.dp)
                .then(dragModifier)
                .clickable(onClick = onTap)
                .semantics {
                    contentDescription = dividerDesc
                },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .padding(end = 14.dp)
                    .align(Alignment.CenterEnd)
                    .width(40.dp)
                    .height(4.dp)
                    .background(
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
                        RoundedCornerShape(2.dp),
                    )
            )
        }
    }
}

/** 页点：当前页那个**宽度补间成长圆条**（Google 的做法），⛔ 不用文字标签。 */
@Composable
private fun Dots(count: Int, current: Int, who: String) {
    val scheme = MaterialTheme.colorScheme
    val desc = stringResource(R.string.dots_desc, who, current + 1, count)
    Row(
        Modifier.semantics { contentDescription = desc },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { i ->
            val active = i == current
            val w: Dp by animateDpAsState(if (active) 16.dp else 5.dp, label = "dot$i")
            Box(
                Modifier
                    .width(w)
                    .height(5.dp)
                    // 圆角 50% ⇒ 不活跃时正好是正圆，活跃时正好是长圆条。一个公式两种形态。
                    .background(
                        if (active) scheme.primary else scheme.onSurfaceVariant.copy(alpha = 0.30f),
                        RoundedCornerShape(percent = 50),
                    )
            )
        }
    }
}
