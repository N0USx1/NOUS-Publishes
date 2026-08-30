package com.nous.sylloge.ui

import com.nous.sylloge.android.Failures
import androidx.compose.ui.platform.LocalContext
import com.nous.sylloge.android.R
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nous.sylloge.humanBytes
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 日志页的一次会话。⛔ 纯数据，这个包不认识数据库。 */
data class LogSession(
    val id: Long,
    val startedAtMs: Long,
    val finishedAtMs: Long?,
    val target: String,
    val copiedPhotos: Int,
    val copiedVideos: Int,
    val copied: Int,
    val skipped: Int,
    val failed: Int,
    val bytes: Long,
)

/** 展开后的一条失败记录。 */
/**
 * ⚠️ 存的是**原因键 + 技术串**，⛔ 不是拼好的句子 ——
 * 人话由 `Failures.render` 在**画这一行的时候**拼（Nous 2026-08-26 的架构）。
 */
data class LogFailure(val path: String, val reason: String, val technical: String)

/** 展开后的一条落盘记录。 */
data class LogEntry(
    val name: String,
    val path: String,
    val bytes: Long,
    val atMs: Long,
    /** true = 盘上已经有了，不是这次拷的 ⇒ **置灰**（Nous 2026-08-25）。 */
    val skipped: Boolean,
    val isVideo: Boolean = false,
)

/**
 * 上卡第 2 页：**日志**（Nous 2026-08-25：「上部分页现在可以做**时间为粒度**
 * + **展开详情**的 log 包了」）。
 *
 * ★ 一条 = 一次备份，**以时间为粒度**；点开展开那次的条目：
 *   **失败的排在最前面**（那才是用户要找的），其次是拷进去的，跳过的置灰。
 * ✅ 失败明细 2026-08-25 补上了（单独的失败表，⛔ 不进 entry —— 那是判重依据）。
 */
@Composable
fun LogPage(
    sessions: List<LogSession>,
    expandedId: Long?,
    entries: List<LogEntry>,
    failures: List<LogFailure>,
    entriesTruncated: Boolean,
    onToggle: (LogSession) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (sessions.isEmpty()) {
        Box(modifier.fillMaxSize(), Alignment.Center) {
            Text(stringResource(R.string.log_empty), style = MaterialTheme.typography.bodyMedium)
        }
        return
    }
    LazyColumn(modifier.fillMaxSize().padding(horizontal = 18.dp)) {
        items(count = sessions.size, key = { sessions[it].id }) { i ->
            val s = sessions[i]
            SessionRowUi(s, expanded = s.id == expandedId, onClick = { onToggle(s) })
            AnimatedVisibility(
                visible = s.id == expandedId,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut(),
            ) {
                Column(Modifier.padding(start = 14.dp, bottom = 8.dp)) {
                    // ★ 失败排最前 —— 用户翻日志十有八九是来找它的
                    failures.forEach { f -> FailureRowUi(f) }
                    if (s.failed > 0 && failures.isEmpty()) {
                        Text(
                            // ⚠️ 老会话（补失败登记之前跑的）没有明细，如实说
                            stringResource(R.string.log_failed_no_detail, s.failed),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                    entries.forEach { e -> EntryRowUi(e) }
                    if (entriesTruncated) {
                        // no silent caps：截断了就说出来
                        Text(
                            stringResource(R.string.log_truncated, entries.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                    if (entries.isEmpty() && s.failed == 0) {
                        Text(
                            stringResource(R.string.log_nothing_new),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 4.dp),
                        )
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun SessionRowUi(s: LogSession, expanded: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // ⚠️ 这几段必须**在 Composable 作用域里**先算好 —— buildString 的块
        //    不是 Composable 上下文，⛔ 里面调不了 stringResource。
        val copiedText = stringResource(R.string.log_copied, s.copied)
        val inclText = if (s.copiedVideos > 0)
            stringResource(
                R.string.log_incl,
                pluralStringResource(R.plurals.n_videos, s.copiedVideos, s.copiedVideos),
            ) else ""
        val skipText = if (s.skipped > 0) stringResource(R.string.log_skipped, s.skipped) else ""
        val failText = if (s.failed > 0) stringResource(R.string.log_failed, s.failed) else ""
        Column(Modifier.weight(1f)) {
            Text(fmtTime(s.startedAtMs), style = MaterialTheme.typography.titleSmall)
            Text(
                // 拷 N · 跳过 N · 失败 N —— 失败为 0 时不提它（⛔ 别用"失败 0"制造焦虑）
                buildString {
                    // ★ 拷贝的按类型拆开（Nous 2026-08-25）。
                    // ⚠️ **主数字用引擎的计数**，视频数只当补充 —— v5 之前的老会话
                    //    推导会差一条（"哈希命中补登记"的行分不出来），
                    //    并排摆"拷 65（照片 66）"就自相矛盾了。
                    // ⚠️ **跳过的推不出拆分**（快筛跳过的根本不写 entry）⇒ 只报总数，⛔ 不编。
                    append(copiedText)
                    if (inclText.isNotEmpty()) append(" ").append(inclText)
                    if (skipText.isNotEmpty()) append(" · ").append(skipText)
                    if (failText.isNotEmpty()) append(" · ").append(failText)
                    if (s.bytes > 0) append(" · ").append(s.bytes.humanBytes())
                },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                s.target,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
            )
            Text(
                // 没有 finished_at = 那次没跑完（被杀 / 掉盘）—— ⛔ 不许显示成"完成"
                if (s.finishedAtMs == null) stringResource(R.string.log_unfinished) else fmtSpan(s.startedAtMs, s.finishedAtMs),
                style = MaterialTheme.typography.labelSmall,
                color = if (s.finishedAtMs == null) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** 失败的一行：路径 + **为什么** —— ⛔ 只说"失败了"等于没说。 */
@Composable
private fun FailureRowUi(f: LogFailure) {
    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(
            f.path,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error,
            maxLines = 1,
            overflow = TextOverflow.StartEllipsis,
        )
        Text(
            Failures.render(LocalContext.current, f.reason, f.technical),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.error.copy(alpha = 0.75f),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * 明细里的一行。
 * ★ **跳过的置灰**（Nous 2026-08-25：「log 里面也会显示跳过的，那个部分应该置灰」）——
 *   否则会话写着"拷 0"、展开却列出一堆文件，看着像都拷过了。
 */
@Composable
private fun EntryRowUi(e: LogEntry) {
    val color =
        if (e.skipped) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
        else MaterialTheme.colorScheme.onSurface
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            e.path,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            // ⚠️ 路径保尾部（com.whatsapp 教训）
            overflow = TextOverflow.StartEllipsis,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            // 视频在明细里也要认得出来
            if (e.skipped) stringResource(R.string.log_already_there)
            else (if (e.isVideo) stringResource(R.string.log_video_prefix) else "") + e.bytes.humanBytes(),
            style = MaterialTheme.typography.labelSmall,
            color = color,
        )
    }
}

private fun fmtTime(ms: Long): String =
    SimpleDateFormat("MM-dd HH:mm", Locale.ROOT).format(Date(ms))

/** 耗时。⚠️ 秒级就说秒，别给"0 分钟"这种没信息的话。 */
@Composable
private fun fmtSpan(fromMs: Long, toMs: Long): String {
    val sec = ((toMs - fromMs) / 1000).coerceAtLeast(0).toInt()
    return when {
        sec < 60 -> stringResource(R.string.dur_sec, sec)
        sec < 3600 -> stringResource(R.string.dur_min_sec, sec / 60, sec % 60)
        else -> stringResource(R.string.dur_hour_min, sec / 3600, sec % 3600 / 60)
    }
}
