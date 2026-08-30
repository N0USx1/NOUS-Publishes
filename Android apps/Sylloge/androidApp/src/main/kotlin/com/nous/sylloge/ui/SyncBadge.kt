package com.nous.sylloge.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 缩略图角标的五个状态。**靠形状区分，颜色只做加强。**
 *
 * 验收判据（cortex references/ui §12.5）：**不并排放也认得出来吗** ——
 * 用户永远只看得到当下那一个，没有另一个可以对照。
 * ⇒ 把颜色全换成同一个灰，五个还分得出来才算过。
 *
 * ⛔ **缩略图本身一律不做处理**（不降透明度）：Nous 2026-08-25 驳回，理由成立 ——
 * 降透明度是"正在加载 / 打不开"的通用视觉语言，会让用户读出一个**错误的事实**。
 */
enum class BadgeState { Copied, Copying, Pending, Failed, Ignored }

@Composable
fun SyncBadge(state: BadgeState, modifier: Modifier = Modifier, size: Dp = 16.dp) {
    val s = MaterialTheme.colorScheme
    val tint = when (state) {
        BadgeState.Copied -> s.primary
        BadgeState.Copying -> s.tertiary
        BadgeState.Pending -> s.onSurfaceVariant
        BadgeState.Failed -> s.error
        BadgeState.Ignored -> s.outline
    }
    val on = when (state) {
        BadgeState.Copied -> s.onPrimary
        BadgeState.Failed -> s.onError
        else -> Color.Unspecified
    }
    // 只有"正在拷"需要连续动画 —— ★它是五个里唯一会动的，动静本身是第三条编码通道。
    val spin: Float = if (state == BadgeState.Copying) {
        val t = rememberInfiniteTransition(label = "badge")
        val v by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1100, easing = LinearEasing)), label = "spin")
        v
    } else 0f
    Canvas(modifier.size(size)) { drawBadge(state, tint, on, spin) }
}

/** 五个形状全由**同一组比例**推出来，⛔ 不写绝对坐标；换尺寸不变形。 */
private fun DrawScope.drawBadge(st: BadgeState, tint: Color, on: Color, spin: Float) {
    val d = size.minDimension
    val r = d / 2f
    val c = Offset(r, r)
    val w = d * 0.14f
    val inset = w / 2f
    // 底：暗色圆，保证角标压在任何照片上都读得出来。⚠️ 它盖在角标底下，⛔ 不碰缩略图。
    drawCircle(Color.Black.copy(alpha = 0.35f), r, c)
    when (st) {
        BadgeState.Copied -> { drawCircle(tint, r - inset * 0.4f, c); check(c, d, on, w) }
        BadgeState.Copying -> {
            drawCircle(tint.copy(alpha = 0.30f), r - inset, c, style = Stroke(w))
            drawArc(tint, spin - 90f, 90f, false, Offset(inset, inset), Size(d - w, d - w), style = Stroke(w, cap = StrokeCap.Round))
        }
        BadgeState.Pending -> drawCircle(tint, r - inset, c, style = Stroke(w))
        BadgeState.Failed -> { drawCircle(tint, r - inset * 0.4f, c); bang(c, d, on, w) }
        BadgeState.Ignored -> {
            // 环 + 横杠 =「不适用」。⚠️ 刻意不用 ⊘，它跟空心环太近。
            drawCircle(tint, r - inset, c, style = Stroke(w))
            val h = d * 0.22f
            drawLine(tint, Offset(c.x - h, c.y), Offset(c.x + h, c.y), w, StrokeCap.Round)
        }
    }
}

private fun DrawScope.check(c: Offset, d: Float, color: Color, w: Float) {
    drawPath(Path().apply {
        moveTo(c.x - d * 0.22f, c.y + d * 0.02f)
        lineTo(c.x - d * 0.06f, c.y + d * 0.18f)
        lineTo(c.x + d * 0.24f, c.y - d * 0.18f)
    }, color, style = Stroke(w, cap = StrokeCap.Round))
}

private fun DrawScope.bang(c: Offset, d: Float, color: Color, w: Float) {
    drawLine(color, Offset(c.x, c.y - d * 0.24f), Offset(c.x, c.y + d * 0.04f), w, StrokeCap.Round)
    drawCircle(color, w * 0.55f, Offset(c.x, c.y + d * 0.20f))
}
