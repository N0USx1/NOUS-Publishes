package com.nous.sylloge.ui

import com.nous.sylloge.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.ScrollableDefaults
import androidx.compose.foundation.gestures.rememberScrollableState
import androidx.compose.foundation.gestures.scrollable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.nous.sylloge.humanBytes
import kotlin.math.roundToInt

/**
 * 下卡唯一一页：**备份这些文件夹**（2026-08-25 去图库化定稿）。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ★★ 一、这一页的模型（**先定模型，下面的代码只是它的直译**）
 *
 * **随位置变化的只有缩略图这一族**：
 *   · 缩略图边长      —— 顶部满格，往下 FocusRows 行内收到 ThumbMinScale
 *   · 三层叠放的步距  —— 顶部推开一点点（「里面有多图」的暗示），往下收回叠着
 * **其余全是常量**：文字字号、确认框大小、确认框贴右的 x。
 * 派生量（⛔ 不是独立参数，别单独去调）：
 *   · 行高   = 缩略图边长 + 上下留白
 *   · 文字 x = 缩略图当前宽度 + 间距
 *   · 各元素 y = 该行的中线
 *
 * ⛔ **反模式（2026-08-25 犯过，Nous 连纠三次）**：把整行当成一个"括号"整体缩放 ——
 *    `行 = s ×(缩略图 + 文字 + 确认框)`。后果：字被图层放大糊掉、确认框一路左飘成斜梯。
 *    正确的是把它们**提到括号外面**：`行 = s × 缩略图 ＋ 文字 ＋ 确认框`。
 *    Nous 原话：「把这两个也放在括号外面，不要在上面打补丁」。
 *
 * ═══════════════════════════════════════════════════════════════════
 * ★★ 二、为什么**不用 LazyColumn**（帧数据 + 官方文档定案，⛔ 别改回去）
 *
 * ① 这个列表只有十几行 —— 虚拟化的开销全是白给的（那套是为几千行准备的）。
 * ② 要让尺寸随滚动变，在 LazyColumn 里只能改 item 高度，而
 *    **只要有 item 的尺寸在变，整列每帧重测**。release 包实测：
 *    | | 变高 Lazy | 固定高 Lazy | **本方案** |
 *    | legacy jank | 17.3% | 7.9% | **4.0%** |
 *    | 90th / 99th | 11/18ms | 9/13ms | **8/10ms** |
 *    ⛔ 试过"只让焦点区那几行订阅滚动态"的门控 —— **没用**（19.0%）：
 *       代价不在几个节点订阅，在"有 item 改尺寸"这件事本身。
 *
 * ⇒ 官方 Compose phases 原话：**「测量步骤和放置步骤有各自独立的重启作用域 ——
 *   在放置步骤里读状态，不会反过来触发测量」**。所以：
 *   · 所有子节点**只测一次**（⛔ measure 块里一个滚动状态都不读）
 *   · 每帧只在 **placement 块**读滚动量 → 算 y 与缩放 → `placeWithLayer`
 *   · y 由自己累加 ⇒ 缩小的行自然挨得更近 = 真的密度梯度，
 *     ⛔ 不像"固定槽位 + 缩放"会重叠或留空档
 *
 * ⚠️ 另：**手感只能在 release 包上判断**（官方硬规矩）—— 同一份代码 debug 的
 *    legacy jank 是 release 的近两倍，在 debug 上调手感等于跟幽灵较劲。
 * ═══════════════════════════════════════════════════════════════════
 */

// ── 唯一的基准尺寸：缩略图 ───────────────────────────────────────
/** 缩略图在最大处的边长。**整页的尺寸都由它派生。** */
private val ThumbMax = 88.dp
/** 缩到最小时占最大的多少。 */
private const val ThumbMinScale = 0.52f
/** 顶部这么多「行」内从 1.0 收到 ThumbMinScale。 */
private const val FocusRows = 3f

// ── 叠放扇出（也属于"缩略图这一族"）────────────────────────────
/** 叠着时每层探出的比例（相对边长）。 */
private const val PeekFrac = 0.08f
/**
 * 焦点行的最大步距 = 边长的 1/5（Nous：「不要全部推开，只推开一点点，
 * 目的是给用户一个里面有多图的概念」—— 是暗示，不是展开）。
 */
private const val PushFrac = 0.20f
/** 扇出在顶部这么多「行」内从推开收回叠着。 */
private const val SpreadRows = 2.5f
/** 叠放层数 = 取几张封面。 */
const val CoverCount = 3

// ── 常量：⛔ 这几个永远不随滚动变 ───────────────────────────────
/** 缩略图上下留白（行高 = 缩略图边长 + 它的两倍）。 */
private val RowVPad = 8.dp
/** 缩略图与文字之间的距离。 */
private val FanGap = 10.dp
/** 右侧确认框那一栏的宽度（贴右恒定，⛔ 不缩不飘）。 */
private val CheckColumn = 56.dp
/** 弹窗网格的格间距。 */
private val GridGap = 3.dp

@Composable
fun FolderFocusList(
    rows: List<GalleryFolder>,
    image: ImageSlot,
    onToggle: (GalleryFolder) -> Unit,
    onOpen: (GalleryFolder) -> Unit,
    onAll: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val thumbPx = with(density) { ThumbMax.roundToPx() }
    val rowPx = thumbPx + with(density) { RowVPad.roundToPx() } * 2

    // ⚠️ 滚动量是 Float state，但**只在 placement 块里读** ⇒ 变化时只重跑放置 + 绘制。
    var scroll by remember { mutableFloatStateOf(0f) }
    // 滚动上限在布局里算出来。⚠️ 用**普通对象**装，⛔ 不用 State ——
    // 布局阶段写 State 会再触发一轮布局（可能打转）；这个值只给输入回调读，不需要重组。
    val limit = remember { object { var max = 0f } }
    val scrollState = rememberScrollableState { delta ->
        val before = scroll
        scroll = (scroll - delta).coerceIn(0f, limit.max)
        before - scroll   // 实际消耗掉的量：到头了就还回去，惯性会自然停
    }

    Column(modifier.fillMaxSize().padding(horizontal = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.folders_title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            TextButton(onClick = { onAll(true) }) { Text(stringResource(R.string.select_all)) }
            TextButton(onClick = { onAll(false) }) { Text(stringResource(R.string.select_none)) }
        }
        Layout(
            // 一行发四个子节点，各摆各的 —— 这就是"提到括号外面"在代码里的样子：
            //   ①命中区（只缩高）②缩略图扇（缩）③文字（⛔常量）④确认框（⛔常量）
            content = {
                rows.forEachIndexed { i, f ->
                    Box(Modifier.clickable { onOpen(f) })
                    CoverFan(
                        f.covers, image,
                        // ⚠️ 扇出量是 lambda：在 CoverFan 的 **placement 块**里才调
                        spread = { (1f - (i - scroll / rowPx) / SpreadRows).coerceIn(0f, 1f) },
                    )
                    RowText(f)
                    Checkbox(checked = f.enabled, onCheckedChange = { onToggle(f) })
                }
            },
            modifier = Modifier
                .fillMaxSize()
                .clipToBounds()
                .scrollable(
                    state = scrollState,
                    orientation = Orientation.Vertical,
                    flingBehavior = ScrollableDefaults.flingBehavior(),
                ),
        ) { measurables, constraints ->
            val w = constraints.maxWidth
            val viewport = constraints.maxHeight
            val checkW = CheckColumn.roundToPx()
            val gap = FanGap.roundToPx()
            // 扇的宽度 = 缩略图 + 最大步距 ×(层数-1)：**常量**，⛔ 不随扇出量变，
            // 否则右边的文字会被挤来挤去。
            val fanW = thumbPx + (thumbPx * PushFrac).toInt() * (CoverCount - 1)
            val textW = (w - checkW - fanW - gap).coerceAtLeast(1)

            // ★ 只测一次：全部固定尺寸，⛔ 这里一个滚动状态都不读
            val placeables = measurables.mapIndexed { i, m ->
                when (i % 4) {
                    0 -> m.measure(Constraints.fixed(w - checkW, rowPx))              // 命中区
                    1 -> m.measure(Constraints.fixed(fanW, thumbPx))                  // 缩略图扇
                    2 -> m.measure(Constraints(minWidth = textW, maxWidth = textW))   // 文字
                    else -> m.measure(constraints.copy(minWidth = 0, minHeight = 0))  // 确认框
                }
            }

            layout(w, viewport) {
                // ★ 从这里开始才读 scroll ⇒ 只重跑放置，不重测
                val s0 = scroll
                var y = -s0
                for (i in placeables.indices step 4) {
                    val s = scaleAt(y / rowPx)         // ← 唯一的自变量
                    val rowH = rowPx * s               // 派生：行高
                    val mid = y + rowH / 2f            // 派生：该行中线

                    // ① 命中区：**只缩高**，x 方向铺满 ⇒ 右半边也点得到
                    placeables[i].placeWithLayer(0, y.roundToInt()) {
                        scaleX = 1f
                        scaleY = s
                        transformOrigin = TransformOrigin(0f, 0f)
                    }
                    // ② 缩略图扇：等比缩放，左对齐、行内居中
                    placeables[i + 1].placeWithLayer(0, (mid - thumbPx * s / 2f).roundToInt()) {
                        scaleX = s
                        scaleY = s
                        transformOrigin = TransformOrigin(0f, 0f)
                    }
                    // ③ 文字：⛔ 常量大小。x 挨着缩过的缩略图，y 走行中线
                    placeables[i + 2].place(
                        (fanW * s).toInt() + gap,
                        (mid - placeables[i + 2].height / 2f).roundToInt(),
                    )
                    // ④ 确认框：⛔ 常量大小，x 恒定贴右
                    placeables[i + 3].place(
                        w - checkW + (checkW - placeables[i + 3].width) / 2,
                        (mid - placeables[i + 3].height / 2f).roundToInt(),
                    )
                    y += rowH
                }
                limit.max = (y + s0 - viewport).coerceAtLeast(0f)
            }
        }
    }
}

/** 缩略图在离视口顶 t 行处的缩放：顶部及以上 = 1.0，往下 FocusRows 行内收到 ThumbMinScale。 */
private fun scaleAt(t: Float): Float =
    if (t <= 0f) 1f else 1f - (1f - ThumbMinScale) * (t / FocusRows).coerceAtMost(1f)

/** 路径 + 张数。⛔ **常量大小**（在缩放的括号外面）。 */
@Composable
private fun RowText(f: GalleryFolder) {
    val scheme = MaterialTheme.colorScheme
    Column {
        Text(
            f.path,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            // ⚠️ 路径保尾部（com.whatsapp 教训：中间省略会把唯一有信息量的那段吃掉）
            overflow = TextOverflow.StartEllipsis,
        )
        Text(
            // ★ 照片和视频分开说（Nous 2026-08-25）
            mediaCountText(f.photos, f.videos) + " · " + f.bytes.humanBytes(),
            style = MaterialTheme.typography.labelSmall,
            color = scheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/**
 * 叠放的缩略图扇：顶部行推开一点点，往下收拢成叠。
 *
 * ⚠️ **自己的宽度是常量**（按最大步距算），只有里面三张的**位置**随滚动变 ——
 * 这样它不重测，也不会把右边的文字挤来挤去；滚动量在 placement 块里读。
 */
@Composable
private fun CoverFan(
    covers: List<Any>,
    image: ImageSlot,
    spread: () -> Float,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    // ★ 层缝：每张封面描一圈**卡底色**的细边（Nous：要 1-2px 缝隙，
    //   否则叠着的图糊成一块）—— 用底色当缝，看起来就是层与层之间的空隙。
    val seam = CardDefaults.cardColors().containerColor
    Layout(
        content = {
            // 后层先画（衬底、压暗），第 0 张最后画（在最上面）
            for (layer in CoverCount - 1 downTo 0) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(scheme.surfaceVariant)
                        .border(1.5.dp, seam, RoundedCornerShape(10.dp)),
                ) {
                    val cover = covers.getOrNull(layer) ?: covers.firstOrNull()
                    image(cover, Modifier.fillMaxSize(), 256)
                    if (layer > 0) {
                        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.18f * layer)))
                    }
                }
            }
        },
        modifier = modifier,
    ) { measurables, constraints ->
        val side = constraints.maxHeight
        val maxStep = (side * PushFrac).toInt()
        val placeables = measurables.map { it.measure(Constraints.fixed(side, side)) }
        layout(side + maxStep * (CoverCount - 1), side) {
            // ★ 只有这一句读滚动量 ⇒ 放置阶段，不重测
            val step = (side * (PeekFrac + (PushFrac - PeekFrac) * spread())).toInt()
            placeables.forEachIndexed { i, p ->
                val layer = CoverCount - 1 - i   // content 顺序是 2,1,0
                p.place(layer * step, 0)
            }
        }
    }
}

/**
 * ★ 点行弹出的「备份此文件夹」确认弹窗：4 列可滚动照片网格 + 五态角标。
 * ⛔ 点照片**没有任何反应**（BigViewer 已全切，Nous 定：不模拟图库）。
 */
@Composable
fun FolderConfirmDialog(
    folder: GalleryFolder,
    photos: List<GalleryPhoto>,
    image: ImageSlot,
    /**
     * 引擎此刻正在拷的那张的文件名（没在跑就是 null）。
     * ★ 🟡 **是实时的**：⛔ 不在数据里预先编一个 Copying 出来，
     *   它只在"引擎真的在拷这一张"的那几十毫秒里成立。
     */
    copyingName: String?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Card(shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text(stringResource(R.string.folder_dialog_title), style = MaterialTheme.typography.titleMedium)
                Text(
                    folder.path,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.StartEllipsis,
                )
                Text(
                    // L3 规矩：取到的比总数少就明说，⛔ 不静默截断
                    if (photos.size < folder.count)
                        stringResource(
                            R.string.folder_first_n,
                            photos.size,
                            mediaCountText(folder.photos, folder.videos) +
                                " · " + folder.bytes.humanBytes(),
                        )
                    else mediaCountText(folder.photos, folder.videos) +
                        " · " + folder.bytes.humanBytes(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                // ★ 弹窗高度 = 恰好 4.5 行（Nous：7.5 行太多）—— 半行露头 = 「还能滚」的暗示
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val cell = (maxWidth - GridGap * 3) / 4
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(4),
                        modifier = Modifier.fillMaxWidth().height(cell * 4.5f + GridGap * 4),
                        horizontalArrangement = Arrangement.spacedBy(GridGap),
                        verticalArrangement = Arrangement.spacedBy(GridGap),
                    ) {
                        items(count = photos.size, key = { photos[it].id }) { i ->
                            val p = photos[i]
                            Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(4.dp))) {
                                image(p.model, Modifier.fillMaxSize(), 192)
                                // 🟡 正在拷的那一张就地覆盖角标；其余用算好的
                                val badge =
                                    if (copyingName != null && p.name == copyingName) BadgeState.Copying
                                    else p.badge
                                SyncBadge(badge, Modifier.align(Alignment.BottomEnd).padding(2.dp))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
                    Spacer(Modifier.width(6.dp))
                    Button(onClick = onConfirm) {
                        Text(if (folder.enabled) stringResource(R.string.folder_stop_backup) else stringResource(R.string.folder_do_backup))
                    }
                }
            }
        }
    }
}
