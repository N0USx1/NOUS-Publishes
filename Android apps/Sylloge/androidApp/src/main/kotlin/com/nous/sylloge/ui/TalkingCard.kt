package com.nous.sylloge.ui

import androidx.compose.ui.text.style.TextAlign
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import kotlinx.coroutines.flow.first
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Animatable
import com.nous.sylloge.android.R
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.AnimationConstants
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.nous.sylloge.humanBytes
import kotlin.math.roundToInt

/** 圆角。⚠️ 试过 30dp，Nous 看了实机说「反而不好看」⇒ 回退 20dp。 */
val CardCorner = 20.dp

/**
 * 衰减曲线：**反抛物线 —— 急降、缓停**（Nous 2026-08-25 定的形状）。
 *
 * `d` 是"离亮区边缘的归一化距离"，返回还剩多少亮度。
 * 斜率 = `-p(1-d)^(p-1)`，在 d=0 处最陡、单调变缓 ⇒ 正是急降缓停。
 * ⛔ 别退回线性插值：两个色标之间 `horizontalGradient` 走的就是直线，看着生硬。
 */
private fun falloff(d: Float): Float {
    val t = (1f - d).coerceIn(0f, 1f)
    var v = t
    repeat(FalloffPower - 1) { v *= t }
    return v
}

/** 曲线幂次。越大越"急降"。3 = 立方衰减。 */
private const val FalloffPower = 3

/** 卡内填充块的亮度。卡面不再染色 ⇒ 对比全靠它。 */
private const val FillAlpha = 0.55f
/** 软边尾巴占卡宽的比例。 */
private const val EdgeTail = 0.14f
/** 尾巴采样几段。够顺就行，⛔ 不必很多。 */
private const val EdgeSteps = 6

/** 辉光层数。层数 × 曲线 = 光晕的形状。 */
private const val GlowLayers = 3
private val GlowMinRadius = 20.dp
private val GlowMaxRadius = 84.dp
/**
 * track（底衬）相对亮块的浓度。
 * ★ 结构照抄官方 `drawLinearIndicator`：**indicator + track 两层，永远铺满整条**。
 * ⚠️ 没有 track 的话，条子没走到的地方是空的 —— 那正是当初「一节一节」的一半原因。
 */
private const val TrackAlphaScale = 0.28f

private const val GlowAlpha = 1.0f

/**
 * 辉光的**鲜艳度 / 亮度**（Nous 2026-08-26：「辉光看起来暗淡」）。
 * ★ 里层最艳最亮、外层回落 —— 这才是"发光"，
 * ⛔ 不是把同一个颜色调低不透明度（那只会更灰）。
 */
private const val GlowSatMin = 1.0f
private const val GlowSatMax = 1.9f
private const val GlowLightMax = 0.38f

private val ReadyGreen = Color(0xFF1B5E20)
/** ⚠️ 卡面那个深绿太暗，拿去做光发不出来 ⇒ 光用亮一档的绿。 */
private val ReadyGlow = Color(0xFF43C463)
private val ReadyGreenOn = Color(0xFFE8F5E9)

/**
 * ★ **卡面是固定的**（Nous 2026-08-25）：卡本身不随横滑移动，**只有里面的内容在滑**。
 *
 * 所以卡面（圆角、状态色、进度填充、整块可点）由这个容器画，
 * 页内容由 `content` 传进来 —— ⛔ 各页不许再自己画一层 Surface。
 *
 * 为什么这个形态对（对着 cortex references/ui 核过）：
 * · 卡是**锚**，里面的内容是解释 —— 总纲「锚不动，解释挂上去」。
 *   卡跟着页一起滑 = 锚在动，正是那条禁的。
 * · 卡本身就是按钮 —— §14.6「看起来是一块的，就整块都能点」
 */
@Composable
fun CardSurface(
    state: DeckState,
    modifier: Modifier = Modifier,
    /**
     * **状态色的强度**：1 = 整张卡按状态上色，0 = 完全回到主题底色。
     *
     * ★ 立它的原因（Nous 2026-08-26 抓到）：卡色和辉光原来**只看 state、不看当前哪一页**，
     * 而日志页和状态页共用同一张卡 ⇒ **翻到日志页还骑在绿卡上，密集小字看不清**。
     * ⇒ 绿说的是「就绪，可以开始」—— 那是在讲**状态页上那个动作**，
     *   翻走之后它就没有指涉对象了。**状态色只属于状态页。**
     *
     * ⚠️ 淡出的是**全部状态表达**，⛔ 不只是绿：失败红、拷贝中的进度块与辉光同理 ——
     * 它们在日志页上是同一个可读性问题，只修绿色 = 换个状态再犯一次。
     *
     * ⚠️ 由翻页手势**直接**驱动、不补间：补间会让颜色追不上手指。
     * 状态之间的切换仍然补间 —— 两件事分开，⛔ 别合成一个动画。
     */
    stateStrength: Float = 1f,
    content: @Composable () -> Unit,
) {
    val strength = stateStrength.coerceIn(0f, 1f)
    val scheme = MaterialTheme.colorScheme
    // ⚠️ 绿色说的是「可以开始了」。**一个文件夹都没勾时它也是假话** ——
    //    那是个待办状态，不是就绪状态（2026-08-25 真机抓到，与卡面文案同一类问题）。
    //    ⚠️「已全部备份」仍然给绿：那确实是"一切就绪、没事可做"。
    val ready = state is DeckState.Ready && !state.nothingSelected

    // ⛔ **卡面不再整体染色**（Nous 2026-08-25 解除）：
    // 有了够强的辉光之后，再给整张卡掺一层 accent 会让画面发浑 ——
    // 光、填充块、卡面三个东西都带同一个色，反而分不出层次。
    // ⇒ 颜色只由**填充块 + 辉光**承担，卡面保持主题色。
    val runAccent = (state as? DeckState.Running)?.accent
    val container by animateColorAsState(
        targetValue = when {
            ready -> ReadyGreen
            // ⭐ 权限不够也走红卡：这件事和「失败」一样严重，⛔ 别用普通底色
            state is DeckState.Failed || state is DeckState.NoPhotoPermission -> scheme.errorContainer
            else -> scheme.surfaceContainerHigh
        },
        label = "card-container",   // ⛔ 不拍时长，用 animateColorAsState 的默认
    )
    val onContainer by animateColorAsState(
        targetValue = when {
            ready -> ReadyGreenOn
            state is DeckState.Failed || state is DeckState.NoPhotoPermission -> scheme.onErrorContainer
            else -> scheme.onSurface
        },
        label = "card-on",
    )

    val running = state as? DeckState.Running
    // ★ 进度块：长度 = 总进度；块内部的涌动负责"活"（见文件末尾）
    // ★ 条子的长度 = **总进度**（单调、可测）；"活"的感觉交给块内部的涌动
    val progress = running?.overallProgress() ?: 0f
    val phase = surgePhase()
    // 颜色必须补间：拷得快时一秒过好几张，逐张跳会闪。比位置补得更慢。
    val accent by animateColorAsState(
        targetValue = running?.accent ?: scheme.primary,
        // ⚠️ 这一个**故意**比默认慢很多，有具体理由：拷得快时一秒过好几张照片，
        // 颜色逐张跳会闪，而颜色跳动比位置跳动更刺眼。⇒ 保留这个自定数字。
        animationSpec = tween(900),
        label = "card-accent",
    )

    // ⚠️ 用 M3 的 `Card`，⛔ 不自己 `Surface + clickable` 拼一个 ——
    // 自己拼会丢掉**涟漪、无障碍语义、状态层、形状/高度 token**，
    // 而这些是「不写就没有、且没人会提醒你」的东西（cortex references/ui §〇·七）。
    // ★ 顺序要紧：**先补间、再 lerp** —— 补间管"状态变了"，lerp 管"翻页翻到哪了"。
    //   反过来会把手势也塞进补间里，手指停了颜色还在爬。
    val cardContainer = lerp(scheme.surfaceContainerHigh, container, strength)
    val cardOn = lerp(scheme.onSurface, onContainer, strength)
    val colors = CardDefaults.cardColors(containerColor = cardContainer, contentColor = cardOn)
    val shape = RoundedCornerShape(CardCorner)

    // ★ 拷贝中：整张卡就是进度条。
    // ⚠️ 填充要画在**卡的背景之上、内容之下** ⇒ 放进 Card 的内容里，
    // ⛔ 不能挂在 Card 的 modifier 上 drawBehind（那样会被卡自己的背景盖住）。
    val body: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize()) {
            if (running != null) {
                Box(
                    Modifier.fillMaxSize().drawBehind {
                        // ① track：铺满整条。⚠️ 没有它，块与块之间是空的 ⇒「一节一节」
                        //    （结构照抄官方 `drawLinearIndicator`：indicator + track 两层）
                        drawRect(accent.copy(alpha = FillAlpha * TrackAlphaScale * strength))

                        // ② 亮块。⚠️ 边缘保持**软**的（Nous：「别加硬边」）——
                        //    形态归 Nous，照抄官方的是周期/结构，⛔ 不是外观。
                        drawRect(fillBrush(accent, FillAlpha * strength, progress, phase))
                    }
                )
            }
            content()
        }
    }

    // ★ 炫光 = **模糊掉的色块**（官方 `Modifier.blur`）。
    //
    // 走过三条弯路，都记下来：
    //  ① 手画径向渐变 —— 圆形色块，**不认卡的圆角矩形**，看着假。
    //  ② `Modifier.shadow(ambientColor/spotColor)` —— **纯黑底上几乎看不见**：
    //     阴影的本质是"变暗"，黑底没有可变暗的空间。彩色阴影只在浅色底上成立。
    //  ③ 让**整张卡**发光 —— 而真正在"发光"的是**进度填充那一块**。
    //     ⇒ 光的形状和发光物的形状对不上，Nous：「看起来磕碜」。
    // ★ 结论：**辉光要跟着发光的那个东西的形状走** —— 这里是"从进度线到 0% 的整块"。
    // ★ **谁在发光，光就是谁的形状**（cortex references/ui）：
    //  · 拷贝中 → 发光的是**填充块** ⇒ 光只有 fill 那么宽
    //  · 就绪 / 失败 → 发光的是**整张卡** ⇒ 光罩满卡
    // ⚠️ 就绪用的深绿（卡面色）太暗，做光会发不出来 ⇒ 光单独给一个亮一档的绿。
    val glowColor: Color? = when {
        ready -> ReadyGlow
        state is DeckState.Failed || state is DeckState.NoPhotoPermission -> scheme.error
        runAccent != null -> accent
        else -> null
    }
    val glowWidth = when {
        ready || state is DeckState.Failed || state is DeckState.NoPhotoPermission -> 1f
        // 光跟着**亮块的头**走 —— 谁在发光，光就是谁的形状
        // ⚠️ 循环模式下亮块会绕回左边，光要跟着绕，⛔ 不能一路推到 1 再瞬间归零
        // 有进度就画光；形状由 fillBrush 承担，这里只决定要不要画
        running != null -> if (progress > 0f) 1f else 0f
        else -> 0f
    }
    val glowAlpha by animateFloatAsState(
        targetValue = if (glowColor != null && glowWidth > 0f) 1f else 0f,
        label = "glow-alpha",
    )
    // ⚠️ 乘在补间**之后**：翻页要立刻见效，⛔ 不排队等动画
    val glow = glowAlpha * strength
    val flat = CardDefaults.cardElevation(defaultElevation = 0.dp)

    Box(modifier) {
        if (glow > 0.01f && glowColor != null && glowWidth > 0f) {
            // ★ 三层辉光，**半径和透明度都走同一条 (1-d)^p 曲线** ——
            // 近处紧而亮、远处宽而淡，合起来就是"急降、缓停"的光晕，
            // ⛔ 不是几个各自拍出来的常数。
            repeat(GlowLayers) { i ->
                val d = i.toFloat() / (GlowLayers - 1)          // 0 = 最里层
                val radius = GlowMinRadius + (GlowMaxRadius - GlowMinRadius) * d
                val a = GlowAlpha * falloff(d) * glow
                Box(Modifier.matchParentSize()) {
                    if (running != null) {
                        // ★★ **光的形状 = 亮块的形状**（共用 [fillBrush]）。
                        // ⚠️ 原来这里是「从左边铺到 w」的一块，到头会**瞬间归零**，
                        //    而条子是环绕流动的 ⇒ 接缝处断层，看起来就是「一节一节」
                        //    （Nous 2026-08-25 一眼指出）。⛔ 形状不许两处各写一份。
                        Box(
                            Modifier
                                .matchParentSize()
                                // ⚠️ Unbounded 才允许模糊溢出边界 —— 光被裁在里面等于没有
                                .blur(radius, BlurredEdgeTreatment.Unbounded)
                                .drawBehind {
                                    drawRect(
                                        fillBrush(
                                            // ⚠️ 越靠里越亮越艳 —— 光是"加光"，
                                            //    ⛔ 不是同一个颜色调低不透明度（那样只会更灰）
                                            glowColor.vivid(
                                                GlowSatMin + (GlowSatMax - GlowSatMin) * (1f - d),
                                                GlowLightMax * (1f - d),
                                            ),
                                            a, progress, phase,
                                        )
                                    )
                                }
                        )
                    } else {
                        // 就绪 / 失败：发光的是**整张卡** ⇒ 光罩满卡
                        Box(
                            Modifier
                                .matchParentSize()
                                .blur(radius, BlurredEdgeTreatment.Unbounded)
                                .background(glowColor.copy(alpha = a), shape)
                        )
                    }
                }
            }
        }
        // ⚠️⚠️ **永远是同一个 Card，⛔ 不在 `Card(onClick=)` 和 `Card()` 之间切**（2026-08-25 的 bug）：
        //   那是两个不同的 composable，切换会**重建整棵子树 —— 包括里面的 HorizontalPager**。
        //   而当时决定切哪个的条件里含 `pager.currentPage` ⇒ **子树的身份依赖了子树自己的状态**，
        //   手一滑页码刚过半就翻转 → 卡被重建 → 手势连同 pager 一起没了 → 弹回去。
        //   症状：Nous「那个开始备份的辉光把这个 ui 卡死了，我没法在那个情况翻页」。
        //   ⚠️ 当时看着像性能问题（三层大面积模糊），量了帧才发现**带辉光反而更顺** ——
        //   分辨它俩的观测是 gfxinfo：卡顿 0.65% vs 2.13%，但**渲染帧数 306 vs 423**
        //   （帧少 = 根本没东西在动 = 手势没生效，不是画不动）。
        // ⇒ 可点性下放到**页内容**里（见 TalkingBody），卡本身只管长相。
        Card(modifier = Modifier.fillMaxSize(), shape = shape, colors = colors, elevation = flat) { body() }
    }
}

/** 上卡第 1 页的内容。⛔ 不画卡面 —— 卡面归 [CardSurface]。 */
@Composable
fun TalkingBody(
    state: DeckState,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    compact: Boolean = false,
) {
    // ⚠️ 可点性在**这一页的内容**上，⛔ 不在外面的卡上 —— 见 CardSurface 的说明。
    // 「看起来是一块的就整块都能点」（cortex references/ui §14.6）在这里仍然成立：
    // 这一页本来就铺满整张卡。
    // ⚠️ Ready 且 **0 张新的** ⇒ 不可点（2026-08-25 Nous 真机踩到：0 张还写着「开始备份」，
    //    点下去入队一个空任务）。Done / Failed 也可点 = **点一下回到检查** ——
    //    原来它们是死胡同：跑完就卡在「备份完成」，不重启 app 回不去（同日踩到）。
    val actionable = (state is DeckState.Ready && state.newCount > 0) ||
        state is DeckState.NeedsResume ||
        state is DeckState.Done ||
        state is DeckState.Failed ||
        (state is DeckState.Preparing && state.lines.any { it.phase == StepPhase.Failed })

    // ★ **两段式确认**（Nous 2026-08-25 拍板）：整卡可点 + 一点就跑 = 误触会开跑
    //   13.6 GB（我误触过一次）。⇒ 第一下只"上膛"，卡面自己说「再次点击确认」，
    //   ⛔ 不弹对话框（保住"整张卡就是按钮"这个形态）。几秒无操作自动退膛。
    var armed by remember { mutableStateOf(false) }
    LaunchedEffect(armed) { if (armed) { kotlinx.coroutines.delay(ArmedTimeoutMs); armed = false } }
    // ⚠️ 状态一变（开跑了 / 失败了 / 重新准备）立刻退膛，⛔ 别把上膛状态带到别的状态里
    LaunchedEffect(bodyKey(state)) { armed = false }
    val onCardClick: () -> Unit = {
        if (state is DeckState.Ready) {
            if (armed) { armed = false; onConfirm() } else armed = true
        } else onConfirm()
    }
    val root = if (actionable) Modifier.fillMaxSize().clickable(onClick = onCardClick) else Modifier.fillMaxSize()
    val running = state as? DeckState.Running
    // ⛔ **不传 transitionSpec** —— 用官方默认（先出后进：旧的淡出 90ms，新的延迟 90ms 才进）。
    //
    // ⚠️⚠️ **`contentKey` 和 `targetState` 是两件事，别混**（2026-08-25 的 bug）：
    //   我原来写的是 `targetState = bodyKey(state)`，然后 `{ _ -> when (state) {...} }` ——
    //   **参数用 `_` 丢掉了，于是要淡出的旧槽和要淡入的新槽都拿外层 `state` 渲染**。
    //   结果：旧内容**瞬间变成新内容**，再对着一模一样的东西播一遍淡入淡出。
    //   Nous 看到的症状：**「点不同的测试目录时字体会闪一下」**。
    //
    // ★ 正解：`targetState` 给**完整状态**，`contentKey` 只决定**什么时候播动画**，
    //   内容一律用 lambda 的参数 `s` 渲染。
    //   这样进度每秒跳动不会重播动画（key 没变），而换状态时两个槽各渲染各的。
    AnimatedContent(
        targetState = state,
        modifier = root,
        contentKey = { bodyKey(it) },
        label = "card-body",
    ) { s ->
        // ★★ **PrepWheel 只能有一个调用点**（2026-08-25 Nous：「下面的字符数据…
        //    基本上还是闪现」的真正根因）：Compose 的**组件身份由调用点决定**，
        //    写成 `when { Preparing -> PrepWheel(…); Ready -> PrepWheel(…) }` 是
        //    **两个调用点** ⇒ 状态一翻转，整条滚动带被销毁重建 ⇒ 里面所有动画
        //    （包括末条那几个数字）全部退回"首次组合"，而**首次组合不播动画**。
        //    ⚠️ 这和 §〇·八「别让子树的身份依赖子树自己的状态」是同一根轴。
        val wheelLines = when (s) {
            // ★ Preparing 与 Ready 是**同一条滚动带**：滚到底那一条就是「开始备份」。
            //   Nous：「居中滚动，变大缩放滚动（固定式）到 开始备份/其他的提示词」
            is DeckState.Preparing -> s.lines
            is DeckState.Ready -> readyLines()
            else -> null
        }
        if (wheelLines != null) {
            PrepWheel(wheelLines, s as? DeckState.Ready, armed, compact)
        } else when (s) {
            is DeckState.Running -> RunningBody(s, onCancel, compact)
            is DeckState.Done -> SimpleBody(
                stringResource(R.string.done_title),
                stringResource(R.string.done_detail, s.copied, s.skipped, s.failed),
                compact,
            )
            is DeckState.Failed -> SimpleBody(
                stringResource(R.string.failed_title),
                stringResource(R.string.failed_detail, s.reason),
                compact,
            )
            is DeckState.NeedsResume -> ResumeBody(s, onConfirm, compact)
            is DeckState.NoPhotoPermission ->
                if (s.partial) SimpleBody(
                    stringResource(R.string.perm_partial_title),
                    stringResource(R.string.perm_partial_detail),
                    compact,
                ) else SimpleBody(
                    stringResource(R.string.perm_none_title),
                    stringResource(R.string.perm_none_detail),
                    compact,
                )
            else -> Unit   // Preparing / Ready 上面已经处理
        }
    }
}

private fun bodyKey(s: DeckState): String = when (s) {
    // ⚠️ Preparing 和 Ready **故意同一个 key** —— 它们是一条带子的两个位置，
    //    不是两个页面。给不同 key 就会播淡入淡出，那条"滚到底"的连续感就断了。
    is DeckState.Preparing -> "wheel"
    is DeckState.Ready -> "wheel"
    is DeckState.Running -> "run"
    is DeckState.Done -> "done"
    is DeckState.Failed -> "fail"
    is DeckState.NeedsResume -> "resume"
    is DeckState.NoPhotoPermission -> "perm"
}

/**
 * ★★ **准备滚轮**（Nous 2026-08-25 拍板：「居中滚动，变大缩放滚动（固定式）
 * 到 开始备份/其他的提示词」）。
 *
 * ═══════════════════════════════════════════════════════════════════
 * **模型（先定模型，下面的代码是它的直译）**
 *
 * 准备的 8 步 + 最终提示词 = **同一条滚动带**，⛔ 不是两个页面之间切换
 * （所以 `bodyKey` 里 Preparing 和 Ready 是同一个 key）。
 *
 * · **唯一的自变量** = 每条离焦点多少「条」；它决定这条的**缩放**与**透明度**
 * · **焦点位固定在卡的正中**，带子滚过它 —— ⛔ 不是焦点跟着条跑
 * · 派生量：每条的 y（从焦点条往两边**累加缩放后的高度** ⇒ 越远挤得越紧）
 *
 * ⚠️ 这里**整条一起缩**，和下卡的文件夹行（只缩缩略图）不冲突：
 *    那边一行里有"必须恒定可读/可点"的东西（文字、确认框）；
 *    这边非焦点条本来就只是上下文，条里没有点击目标 ⇒ 整条就是那个"该缩的东西"。
 *
 * **性能纪律**（同 FolderFocus，帧数据换来的）：
 * · 每条**只测一次**，⛔ measure 块里不读滚动量
 * · 滚动量是 `Animatable`，**只在 placement 块里读** ⇒ 只重放置 + 绘制
 * ═══════════════════════════════════════════════════════════════════
 */
/**
 * 最远条缩到多小。⚠️ **要的是对比，不是整体变大**（Nous 2026-08-25：
 * 「当前的那个变大，其他的缩小，而且间距也变小」）——
 * 焦点条用大字号，靠这个值把其余条压下去。
 */
private const val WheelMinScale = 0.46f
/** 离焦点这么多条之后就到最小。⚠️ 收紧它 = 相邻条也明显小一圈。 */
private const val WheelSpan = 1.8f
/** 最远条还剩多少透明度。 */
private const val WheelMinAlpha = 0.14f
/** 上膛后多久自动退膛。 */
private const val ArmedTimeoutMs = 4000L

/** Ready 状态下带子上的 8 条：前 7 步都已完成，焦点落在最后一条。 */
private fun readyLines(): List<PrepLine> = PrepStep.entries.mapIndexed { i, st ->
    PrepLine(st, if (i < PrepStep.entries.lastIndex) StepPhase.Done else StepPhase.Active)
}

@Composable
private fun PrepWheel(
    lines: List<PrepLine>,
    ready: DeckState.Ready?,
    armed: Boolean,
    compact: Boolean,
) {
    val last = lines.lastIndex
    // 焦点落在"正在做的那一步"；就绪时落在最后一条（= 提示词那条）。
    //
    // ⚠️⚠️ **兜底不能是 0**（2026-08-25 Nous 插盘后报「每行在乱跳」，根因就在这）：
    //    引擎发的序列里有一半状态**根本没有 Active 行** —— `emit(3, 2, 盘名)` 的意思是
    //    "第 2 步做完了，这是它的结果"，而 done=3 会让第 2 行判成 Done ⇒ 一个 Active 都没有。
    //    这样的 emit 有五处，隔一次来一下，焦点就在"顶部 ↔ 当前步"之间来回弹。
    // ⇒ 找不到 Active 时**停在最后一条 Done 上**（那正是刚做完的那步），焦点因此是单调的。
    val target = when {
        ready != null -> last.toFloat()
        else -> {
            val active = lines.indexOfFirst { it.phase == StepPhase.Active || it.phase == StepPhase.Failed }
            if (active >= 0) active.toFloat()
            else lines.indexOfLast { it.phase == StepPhase.Done }.coerceAtLeast(0).toFloat()
        }
    }

    val scroll = remember { androidx.compose.animation.core.Animatable(target) }
    LaunchedEffect(target) { scroll.animateTo(target) }   // ⛔ 不拍时长，用官方默认 spring

    Layout(
        content = {
            lines.forEachIndexed { i, line ->
                // ★★ 末条**永远是同一个组件**（2026-08-25 Nous：「最后那个开始备份下面的
                //    字符数据没做动画」）——原来是 `if (ready) ReadyRow else StepRow`，
                //    两个不同的组件在同一个槽位互换 ⇒ 每次重算这一行都被**销毁重建**，
                //    而 `AnimatedContent` **首次组合不播动画** ⇒ 数字永远是闪现的。
                //    ⇒ 换成一个 LastRow，只换里面的字，动画就有得播了。
                if (i == last) LastRow(line, ready, armed, compact)
                else StepRow(line)
            }
        },
        modifier = Modifier.fillMaxSize().clipToBounds(),
    ) { measurables, constraints ->
        val w = constraints.maxWidth
        val viewport = constraints.maxHeight
        // ★ 只测一次：宽度固定、高度按内容 —— ⛔ 这里不读 scroll
        val placeables = measurables.map {
            it.measure(Constraints(minWidth = w, maxWidth = w))
        }
        layout(w, viewport) {
            // ★ 从这里开始才读滚动量 ⇒ 只重放置，不重测
            val f = scroll.value
            val n = placeables.size
            val scales = FloatArray(n) { wheelScale(it - f) }
            // 每条缩放后的高度，累加出各自的顶边
            val tops = FloatArray(n)
            var acc = 0f
            for (i in 0 until n) { tops[i] = acc; acc += placeables[i].height * scales[i] }
            // 焦点点 = 在 floor(f) 与 ceil(f) 两条的中心之间插值
            fun center(i: Int) = tops[i] + placeables[i].height * scales[i] / 2f
            val i0 = f.toInt().coerceIn(0, n - 1)
            val i1 = (i0 + 1).coerceAtMost(n - 1)
            val focusY = center(i0) + (center(i1) - center(i0)) * (f - i0)
            val shift = viewport / 2f - focusY      // ★ 把焦点点搬到卡心

            for (i in 0 until n) {
                val sc = scales[i]
                placeables[i].placeWithLayer(0, (tops[i] + shift).roundToInt()) {
                    scaleX = sc
                    scaleY = sc
                    // ★ 锚点：**水平在中心**（Nous 2026-08-25：「和那个开始备份一样来居中」——
                    //   锚在左边的话条一缩就往左跑，居中当场破功）；
                    //   ⚠️ **垂直必须锚在顶边**：上面的 y 是按"缩放后的高度"累加出来的，
                    //   垂直锚一旦挪到中心，图层就绕自身中心缩 ⇒ 视觉高度和累加用的高度对不上，
                    //   焦点会偏到上一条去（2026-08-25 截图里抓到）。**改锚点 = 改几何。**
                    transformOrigin = TransformOrigin(0.5f, 0f)
                    alpha = wheelAlpha(i - f)
                }
            }
        }
    }
}

/**
 * 离焦点 d 条处还剩多少"分量"：1 → 0，**急降缓停**。
 * ⚠️ 与卡上辉光用的是同一条曲线形状（cortex：一个界面里的衰减该是一家人）——
 * 线性的话相邻条只小一点点，看不出"当前那个变大了"。
 */
private fun wheelFall(d: Float): Float {
    val t = (kotlin.math.abs(d) / WheelSpan).coerceAtMost(1f)
    val u = 1f - t
    return u * u
}

/** 离焦点 d 条处的缩放。 */
private fun wheelScale(d: Float): Float = WheelMinScale + (1f - WheelMinScale) * wheelFall(d)

/** 离焦点 d 条处的透明度。 */
private fun wheelAlpha(d: Float): Float = WheelMinAlpha + (1f - WheelMinAlpha) * wheelFall(d)

/**
 * ★ **变化量的挤入动画**（Nous 2026-08-25：「增添字符之类的变化量都没有做动画（闪现），
 * 要打磨出扩展挤入的文字动画，查查官方的接口」）。
 *
 * ⚠️ **先出后进**（照官方默认的时序：出 90ms，进**延迟 90ms** 再走 220ms）——
 * 同时进出会让新旧两段字**半透明地叠在一起**，那正是"看着还是闪/糊"的来源
 * （2026-08-25 把动画放慢到 3 秒截图，一帧就看见了）。
 *
 * 用官方的 `AnimatedContent` + **`SizeTransform`（用 `using` 挂上）**，⛔ 不手搓：
 * · `SizeTransform` 让**容器宽度**跟着动 ⇒ 旁边的字被"挤"开，这是"扩展"那一半
 * · `slideInHorizontally + fadeIn` 是"挤入"那一半
 * · `clip = false` ⇒ 动画期间不裁切（否则挤入的字会被自己的框切掉）
 *
 * ⚠️⚠️ **必须渲染 lambda 参数 `t`，⛔ 不许读外层的 `text`** —— 官方文档专门强调这条，
 *    而我们真踩过：两个槽都渲染外层状态 ⇒ 旧内容瞬间变成新内容，再对着一模一样的东西
 *    播一遍淡入淡出，Nous 当时看到的症状是「字体会闪一下」。
 */
/** 挤入的时长（照官方默认：旧的先出 90ms，新的延迟 90ms 再走 220ms）。 */
private const val MorphInMs = 220
private const val MorphOutMs = 90

@Composable
private fun MorphText(
    text: String,
    style: androidx.compose.ui.text.TextStyle,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
) {
    AnimatedContent(
        targetState = text,
        modifier = modifier,
        transitionSpec = {
            (fadeIn(tween(MorphInMs, delayMillis = MorphOutMs)) +
                slideInHorizontally(tween(MorphInMs, delayMillis = MorphOutMs)) { it / 3 })
                .togetherWith(
                    fadeOut(tween(MorphOutMs)) +
                        slideOutHorizontally(tween(MorphOutMs)) { -it / 3 }
                )
                .using(SizeTransform(clip = false))
        },
        label = "morph",
    ) { t ->
        if (t.isBlank()) Spacer(Modifier)
        else Text(t, style = style, color = color, maxLines = 1, softWrap = false)
    }
}

/**
 * 带子上的一条普通步骤。
 * ★ **水平居中**，和带子末端那条「开始备份」同构（Nous 2026-08-25 定）——
 * ⛔ 左边不留固定的记号列：那样就不是居中了，记号跟文字一起居中。
 */
@Composable
private fun StepRow(line: PrepLine) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 3.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepGlyph(line.phase)
        Spacer(Modifier.width(10.dp))
        Text(
            stepText(line),
            // ★ 与带子末端那条「开始备份」**同一档字号**（Nous：「字体大小可以变大」）
            style = MaterialTheme.typography.headlineSmall,
            maxLines = 1,
            overflow = TextOverflow.MiddleEllipsis,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        // ⚠️ **仍然是同一行**（Nous：「不要断行」）—— 只是把"会变的那一截"单独拿出来，
        //    好让它能挤入；⛔ 不是拆成第二行。
        if (line.step != PrepStep.WaitUsb) {
            MorphText(
                if (line.detail.isBlank()) "" else "  " + line.detail,
                style = MaterialTheme.typography.titleMedium,
                color = LocalContentColor.current.copy(alpha = 0.66f),
            )
        }
    }
}

/**
 * ⚠️ 「等待 U 盘」那一条要说**人话**：光写"等待 U 盘"用户不知道该干嘛。
 * （这两句文案是 Nous 认可过的，⛔ 别顺手改。）
 */
@Composable
private fun stepText(line: PrepLine): String = when {
    line.step == PrepStep.WaitUsb && line.phase == StepPhase.Failed -> stringResource(R.string.idle_no_usb)
    // ⚠️ 只在**还在等**的时候说这句；已经插上了还写"插上 U 盘就开始"是时态错的
    line.step == PrepStep.WaitUsb && line.phase == StepPhase.Active -> stringResource(R.string.idle_plug_in)
    // ⚠️ detail 由 StepRow 用 MorphText 单独画（同一行），⛔ 别再拼回来
    else -> stringResource(line.step.labelRes)
}

/**
 * 带子的**最后一条 = 提示词**。滚到这里，卡也正好变绿。
 * ★ 两段式：第一下只上膛，这条自己改口说「再次点击确认」。
 */
@Composable
private fun LastRow(line: PrepLine, state: DeckState.Ready?, armed: Boolean, compact: Boolean) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 还没就绪时它就是普通一步（带记号）；就绪后记号收进去，⛔ 别硬切
            androidx.compose.animation.AnimatedVisibility(
                visible = state == null,
                enter = androidx.compose.animation.expandHorizontally() + fadeIn(),
                exit = androidx.compose.animation.shrinkHorizontally() + fadeOut(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    StepGlyph(line.phase)
                    Spacer(Modifier.width(10.dp))
                }
            }
            MorphText(
                when {
                    state == null -> stepText(line)
                    // ⚠️ 一个文件夹都没勾 ⇒ ⛔ 不许说"已全部备份"（假话，见 DeckState.Ready）
                    state.nothingSelected -> stringResource(R.string.ready_nothing_selected)
                    state.newCount == 0 -> stringResource(R.string.ready_all_backed_up)
                    armed -> stringResource(R.string.ready_confirm_again)
                    else -> stringResource(R.string.ready_start)
                },
                style = MaterialTheme.typography.headlineSmall,
            )
        }
        if (!compact) {
            MorphText(
                // ★ 照片和视频分开报（Nous 2026-08-25：「需要说明多少照片 多少个视频」）
                if (state != null && state.newCount > 0)
                    mediaCountText(state.newPhotos, state.newVideos) +
                        " · " + state.newBytes.humanBytes()
                else "",
                style = MaterialTheme.typography.bodyMedium,
            )
            MorphText(
                when {
                    state == null -> ""
                    state.nothingSelected ->
                        stringResource(R.string.ready_pick_folders) + state.target
                    else ->
                        stringResource(
                            R.string.ready_skip,
                            mediaCountText(state.skipPhotos, state.skipVideos),
                        ) + state.target
                },
                style = MaterialTheme.typography.labelSmall,
                color = LocalContentColor.current.copy(alpha = 0.7f),
            )
        }
    }
}

@Composable
private fun RunningBody(state: DeckState.Running, onCancel: () -> Unit, compact: Boolean) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        // ⚠️ total == 0 = 任务刚起、引擎还在预滤/识别盘，**真数字还没出来** ——
        //   这时画 "0 / 0  0%" 等于报一个假进度（Nous 2026-08-30 报的）。
        //   ⇒ 挂「正在准备…」，第一个真 Progress 一到自然换成数字。
        if (state.total == 0) {
            Text(
                stringResource(R.string.running_preparing),
                style = MaterialTheme.typography.titleMedium,
            )
        } else Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                state.done.toString() + " / " + state.total,
                style = MaterialTheme.typography.titleMedium,
                fontFamily = FontFamily.Monospace,
            )
            Spacer(Modifier.weight(1f))
            // ★ 报的是**总进度**（Nous 2026-08-26：「回到最初的总 % 的设置」）——
            //   它是可测的（已完成文件数 + 当前这个的字节比例），⛔ 不是编的。
            //   ⚠️ 一度改成"当前文件的百分比"，那个数字在小文件上是假的（耗时在
            //   flush/close，没有可报的量）—— 见文件末尾 overallProgress 的说明。
            Text(
                (state.overallProgress() * 100).toInt().toString() + "%",
                style = MaterialTheme.typography.labelLarge,
            )
        }
        Text(
            state.currentName,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.MiddleEllipsis,   // 照片名尾部信息量大 ⇒ 中间省略
            color = LocalContentColor.current.copy(alpha = 0.7f),
        )
        if (!compact) {
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.End)) {
                Text(stringResource(R.string.running_stop))
            }
        }
    }
}

@Composable
private fun ResumeBody(state: DeckState.NeedsResume, onConfirm: () -> Unit, compact: Boolean) {
    Column(
        Modifier.fillMaxSize().clickable(onClick = onConfirm).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.resume_title),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        if (!compact) {
            Text(
                stringResource(R.string.resume_detail, state.done, state.total),
                style = MaterialTheme.typography.bodySmall,
                color = LocalContentColor.current.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun SimpleBody(title: String, detail: String, compact: Boolean) {
    Column(
        Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // ⚠️⚠️ `horizontalAlignment = CenterHorizontally` 只居中**这一块**，
        //    **换行之后每一行不会自己居中** —— 必须给 `textAlign = TextAlign.Center`。
        //    中文几乎不换行，所以这个 bug 一直藏着；一翻成法语立刻露出来
        //    （Nous 2026-08-26：「这个断行没做居中啊」）。
        // ★ 规则：**凡是居中的文本，一律带 textAlign**，⛔ 别赌它不会换行。
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (!compact) {
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = LocalContentColor.current.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** 每一步左边那个小记号。⛔ 不引图标库，画出来。 */
@Composable
private fun StepGlyph(phase: StepPhase) {
    val c = LocalContentColor.current
    // ⚠️ 跟着字号一起放大 —— 24sp 的字配 14dp 的记号会显得记号缩水了
    Canvas(Modifier.size(19.dp)) {
        val d = size.minDimension
        val r = d / 2f
        val ctr = Offset(r, r)
        val w = d * 0.16f
        when (phase) {
            StepPhase.Done -> {
                drawLine(c.copy(alpha = 0.5f), Offset(d * 0.16f, d * 0.52f), Offset(d * 0.42f, d * 0.76f), w, StrokeCap.Round)
                drawLine(c.copy(alpha = 0.5f), Offset(d * 0.42f, d * 0.76f), Offset(d * 0.86f, d * 0.24f), w, StrokeCap.Round)
            }
            // ★ 向下的小箭头，不是圆点 —— 箭头在说"接着往下走"。
            StepPhase.Active -> {
                drawLine(c, Offset(d * 0.22f, d * 0.40f), Offset(d * 0.50f, d * 0.68f), w, StrokeCap.Round)
                drawLine(c, Offset(d * 0.50f, d * 0.68f), Offset(d * 0.78f, d * 0.40f), w, StrokeCap.Round)
            }
            StepPhase.Pending -> drawCircle(c.copy(alpha = 0.35f), r * 0.5f, ctr, style = Stroke(w * 0.8f))
            StepPhase.Failed -> {
                drawLine(c, Offset(d * 0.24f, d * 0.24f), Offset(d * 0.76f, d * 0.76f), w, StrokeCap.Round)
                drawLine(c, Offset(d * 0.76f, d * 0.24f), Offset(d * 0.24f, d * 0.76f), w, StrokeCap.Round)
            }
        }
    }
}

/**
 * 「N 张照片 · M 个视频」的本地化版本。
 *
 * ⚠️ **必须走 `pluralStringResource`**，⛔ 不能拼 "%d photos"：
 * 英/意/法/西 的单复数规则各不相同（法语的 **0 算单数**："0 photo"）。
 * ⚠️ 数量为 0 的那一半**不显示** —— ⛔ 别写 "0 videos"，那是噪音。
 */
@Composable
fun mediaCountText(photos: Int, videos: Int): String {
    val p = if (photos > 0) pluralStringResource(R.plurals.n_photos, photos, photos) else ""
    val v = if (videos > 0) pluralStringResource(R.plurals.n_videos, videos, videos) else ""
    return when {
        p.isNotEmpty() && v.isNotEmpty() -> stringResource(R.string.media_join, p, v)
        v.isNotEmpty() -> v
        else -> p
    }
}

/**
 * 进度 0..1 的**唯一出处** —— ★★ **它是「当前这一张」的进度，⛔ 不是总体进度。**
 *
 * Nous 2026-08-25 两次纠正才定形。设计原文就是这个意思：
 * 「整张卡就是进度条，**填充块横扫整张卡**；accent 从当前正在拷的那张照片采出来」——
 * 7000 张的总体进度不可能"横扫"，而且颜色会在一次横扫里换 7000 遍，
 * **只有"一张扫一次"才讲得通**：一张照片拷完 = 填充块横扫一遍 = 一个颜色。
 *
 * 分工：**数字 `3 / 40` 报总体走到哪，填充块 + 百分比报这一张**。
 *
 * ⛔⛔ **不许在别处再写一遍这个公式。** 2026-08-25 它被抄成了两份
 * （一份驱动色块、一份驱动百分比），改了一份之后色块在动、数字还是 0%。
 */

// ══════════════════════════════════════════════════════════════════════
//  进度条：**照搬 Material 3 官方 indeterminate 的写法**
//  —— 它的"线条"就是我们的"块"（Nous 2026-08-25：「你按照它的写法去写我们的，
//     动画块=动画线条 不就可以了」）
// ══════════════════════════════════════════════════════════════════════

/**
 * ★★ **进度 = 总体百分比**（Nous 2026-08-26：「回到最初的总 % 的设置」）。
 *
 * ⚠️ 走过的弯路记在这里，⛔ 别再回去：
 * 1. 只按文件数 `done/total` ⇒ 大文件时条子长时间纹丝不动；
 * 2. 换成"一张 = 一次横扫" ⇒ 单文件的完成度**本来就不可测**（耗时在 flush/close），
 *    条子贴着 0 不动；
 * 3. 换成官方 indeterminate 的两条线 ⇒ 它的缓动是**加速型**，一轮里速度不均匀，
 *    loop 起来仍有顿挫（Nous：「他们做的加速度效果 loop 起来有速度差，
 *    还是有一节一节的质感」）。
 * ⇒ **最终：条子的长度就是总进度（单调、可测、永不倒退），"活"的感觉交给块内部的涌动。**
 *
 * 把当前文件的字节进度也折进去，让它在文件之间平滑推进。
 */
private fun DeckState.Running.overallProgress(): Float =
    if (total > 0) ((done + fileFraction.coerceIn(0f, 1f)) / total).coerceIn(0f, 1f) else 0f

/**
 * 块**内部**的涌动相位 0..1。
 *
 * ★ **匀速**（[LinearEasing]）+ **正弦波** ⇒ 数学上天然无缝：
 * 正弦是周期函数，走满一个周期回到原点，⛔ 不存在"播完重开"的接缝，
 * 也不存在官方那种加速缓动带来的速度差。
 * ⚠️ 这几个数是我定的（平台没有"进度块内部涌动"这种现成组件），可以随便调。
 */
private const val SurgePeriodMs = 2200

/** 一个波在整卡宽度里出现几次。 */
private const val SurgeWaves = 1.6f

/** 涌动的深浅：0 = 完全均匀，1 = 波谷全透明。 */
private const val SurgeDepth = 0.42f

@Composable
private fun surgePhase(): Float {
    val t = rememberInfiniteTransition(label = "surge")
    val v by t.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(SurgePeriodMs, easing = LinearEasing),
        ),
        label = "surge-phase",
    )
    return v
}

/**
 * ★★ **亮块的形状 —— 填充和辉光共用这一个函数。**
 *
 * 项目里早有这条规矩：「**谁在发光，光就是谁的形状**」。
 * ⚠️ 2026-08-25 我自己破过一次：条子换了运动模式，辉光却还是旧形状
 * ⇒ 接缝处断层，看起来「一节一节」（Nous 一眼指出）。
 * ⇒ ⛔ 形状不许两处各写一份。这里是唯一出处。
 *
 * 形状 = 「0 到 progress 之间是亮的（带内部涌动），右边按 falloff 收」。
 */
private fun fillIntensity(x: Float, progress: Float, phase: Float): Float {
    val edge = when {
        x <= progress -> 1f
        x - progress >= EdgeTail -> 0f
        else -> falloff((x - progress) / EdgeTail)
    }
    if (edge <= 0f) return 0f
    // 内部涌动：正弦，⛔ 不是"扫一段再重来"
    val wave = kotlin.math.sin((x * SurgeWaves - phase) * 2f * kotlin.math.PI.toFloat())
    return edge * (1f - SurgeDepth * (0.5f - 0.5f * wave))
}

/** 把形状采样成一条横向渐变。⚠️ 填充和辉光**形状完全相同**，只是颜色不同。 */
private fun fillBrush(color: Color, alpha: Float, progress: Float, phase: Float): Brush {
    val stops = Array(GradientSamples + 1) { k ->
        val x = k.toFloat() / GradientSamples
        x to color.copy(alpha = alpha * fillIntensity(x, progress, phase))
    }
    return Brush.horizontalGradient(colorStops = stops)
}

/**
 * ★ 让颜色**更亮更艳**（Nous 2026-08-26：「辉光的 fx 是单颜色，而不是走亮度/饱和度，
 * 所以这个辉光看起来暗淡」）。
 *
 * ⚠️ 光的本质是**加光**，不是"同一个颜色调低不透明度" ——
 * 后者只会让它更灰。⇒ 先把饱和度推开（各通道离开灰轴），再整体往白里提。
 * ⛔ 这个包不许 import `android.*`，所以不走 `Color.colorToHSV`，用通道运算等效实现。
 */
private fun Color.vivid(sat: Float, light: Float): Color {
    val m = (red + green + blue) / 3f
    fun ch(c: Float): Float {
        val s = (m + (c - m) * sat).coerceIn(0f, 1f)     // 拉开饱和度
        return (s + (1f - s) * light).coerceIn(0f, 1f)   // 往白里提亮度
    }
    return Color(ch(red), ch(green), ch(blue), alpha)
}

/** 把亮块采样成多少个色标。⚠️ 太少边缘会有台阶；48 段在整卡宽度上肉眼已经连续。 */
private const val GradientSamples = 48

