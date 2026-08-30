package com.nous.sylloge.android

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nous.sylloge.ui.LogEntry
import com.nous.sylloge.ui.LogFailure
import com.nous.sylloge.ui.LogPage
import com.nous.sylloge.ui.LogSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 一次列多少条会话 / 展开时最多列多少条文件。⚠️ 到顶要在界面上说出来，⛔ 不静默截断。 */
private const val SessionLimit = 200
private const val EntryLimit = 300

class LogViewModel(app: Application) : AndroidViewModel(app) {
    private val db = CatalogDb(app)

    var sessions by mutableStateOf<List<LogSession>>(emptyList()); private set
    var expandedId by mutableStateOf<Long?>(null); private set
    var entries by mutableStateOf<List<LogEntry>>(emptyList()); private set
    var failures by mutableStateOf<List<LogFailure>>(emptyList()); private set
    var truncated by mutableStateOf(false); private set

    fun load() {
        viewModelScope.launch {
            sessions = withContext(Dispatchers.IO) {
                db.sessions(SessionLimit).map {
                    LogSession(
                        id = it.id,
                        startedAtMs = it.startedAtMs,
                        finishedAtMs = it.finishedAtMs,
                        target = it.target,
                        copiedPhotos = it.copiedPhotos,
                        copiedVideos = it.copiedVideos,
                        copied = it.copied,
                        skipped = it.skipped,
                        failed = it.failed,
                        bytes = it.bytes,
                    )
                }
            }
        }
    }

    /** 点一条 ⇒ 展开；再点 ⇒ 收起。⚠️ 一次只展开一条，⛔ 别一屏全摊开。 */
    fun toggle(s: LogSession) {
        if (expandedId == s.id) { expandedId = null; entries = emptyList(); failures = emptyList(); return }
        expandedId = s.id
        viewModelScope.launch {
            failures = withContext(Dispatchers.IO) { db.failuresOf(s.id, EntryLimit) }
                .map { LogFailure(it.relPath, it.reason, it.technical) }
            val rows = withContext(Dispatchers.IO) { db.entriesOf(s.id, EntryLimit) }
            truncated = rows.size >= EntryLimit
            entries = rows.map { LogEntry(it.storedName, it.relPath, it.sizeBytes, it.copiedAtMs, it.skipped, it.isVideo) }
        }
    }
}

/** 上卡第 2 页：日志。 */
@Composable
fun LogPane(vm: LogViewModel = viewModel()) {
    // ⚠️ 每次进这一页都重读 —— 备份刚跑完就切过来，得看得到最新那条
    LaunchedEffect(Unit) { vm.load() }
    LogPage(
        sessions = vm.sessions,
        expandedId = vm.expandedId,
        entries = vm.entries,
        failures = vm.failures,
        entriesTruncated = vm.truncated,
        onToggle = { vm.toggle(it) },
    )
}
