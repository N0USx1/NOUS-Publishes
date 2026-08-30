package com.nous.sylloge.android

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.nous.sylloge.FastKey
import com.nous.sylloge.FolderDefaults
import com.nous.sylloge.PhotoItem
import com.nous.sylloge.fastKey
import com.nous.sylloge.ui.BadgeState
import com.nous.sylloge.ui.GalleryFolder
import com.nous.sylloge.ui.GalleryPhoto
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 弹窗最多先取这么多张。⚠️ 真到顶要在弹窗里说出来（表头写「前 N · 共 M」），⛔ 不静默截断。 */
private const val PerFolderLimit = 600

/** 弹窗状态：正在确认哪个文件夹 + 它的照片。 */
data class FolderDialog(val folder: GalleryFolder, val photos: List<GalleryPhoto>)

/**
 * 下卡唯一一页（P5 去图库化后）的数据：文件夹焦点列表 + 确认弹窗。
 * ⚠️ 这一侧才允许碰 `android.*`；`com.nous.sylloge.ui` 只吃纯数据。
 * ★ 这里是**勾选的唯一入口**（行右侧确认框 + 弹窗确认按钮写的是同一个 pref）。
 */
class FolderDeckViewModel(app: Application) : AndroidViewModel(app) {

    private val source: PhotoSource get() = photoSourceOf(getApplication())
    private val db = CatalogDb(app)

    var rows by mutableStateOf<List<GalleryFolder>>(emptyList()); private set
    var dialog by mutableStateOf<FolderDialog?>(null); private set

    private var known: Set<FastKey> = emptySet()
    private var prefs: Map<String, Boolean> = emptyMap()
    private var failed: Set<String> = emptySet()

    /**
     * 引擎此刻正在拷的那张（🟡 的来源）。
     * ⚠️ 只认**真任务发的进度**，⛔ 不编。跑完置空并重载一次角标（🟡 → 🟢）。
     */
    var copyingName by mutableStateOf<String?>(null); private set

    /** 真扫描是否已经出过结果。⚠️ 出过就⛔不许再被磁盘缓存盖回去（缓存读得慢时会晚到）。 */
    private var freshLoaded = false

    init {
        // ★★ 冷启动先上屏**上次的列表**（Nous 2026-08-26：「每次软件重开都要重拉一遍，
        //    完全没有做缓存」）。真扫描（load()）照旧在后台跑，跑完替换。
        //    ⚠️ viewModelScope 的续体都在主线程串行 ⇒ 下面的 freshLoaded 检查没有并发竞态。
        viewModelScope.launch {
            val cached = withContext(Dispatchers.IO) { FolderRowsCache.load(getApplication()) }
            if (cached != null && !freshLoaded && rows.isEmpty()) {
                // ⚠️ enabled 的正本在 DB —— 缓存里那个是占位，必须重算再上屏
                prefs = withContext(Dispatchers.IO) { db.folderPrefs() }
                rows = cached.map { it.copy(enabled = enabledOf(it.path)) }
                Trace.i("下卡：先用上次的列表（" + cached.size + " 行），真扫描随后替换")
            }
        }
        // ⚠️ **下卡也必须听 FolderPrefsBus** —— 「隐藏 .nomedia」这个开关改的是
        //    取数范围，上卡的数字和下卡的文件夹列表**都要跟着变**。
        //    ⛔ 只 bump 不听 = 翻开关后上卡变了、下面这张列表还是旧的（2026-08-25 差点漏掉）。
        viewModelScope.launch {
            @OptIn(kotlinx.coroutines.FlowPreview::class)
            FolderPrefsBus.version.debounce(300).collect { v -> if (v != 0) load() }
        }
        viewModelScope.launch {
            WorkManager.getInstance(getApplication())
                .getWorkInfosForUniqueWorkFlow(BackupWorker.WORK_NAME)
                .collect { list ->
                    val wi = list.lastOrNull()
                    if (wi?.state == WorkInfo.State.RUNNING) {
                        copyingName = wi.progress.getString(BackupWorker.KEY_CURRENT)
                    } else {
                        val wasRunning = copyingName != null
                        copyingName = null
                        // 跑完了 ⇒ 重新捞一次 fastkey，🟡 才会变成 🟢
                        if (wasRunning) load()
                    }
                }
        }
    }

    fun load() {
        viewModelScope.launch {
            val fresh = withContext(Dispatchers.IO) {
                prefs = db.folderPrefs()
                // ★ 角标数据一次捞全，⛔ 绝不逐张查库。
                // ⚠️ 盘没插时 current() 拿不到身份 ⇒ 本机只认识一个备份集就用它 ——
                //    角标回答的是「这张在不在盘上」，不插盘也该答得出（Nous 2026-08-25 抓的遗留）。
                val sid = BackupSetId.current(getApplication(), db)
                    .ifEmpty { db.knownSetIds().singleOrNull() ?: "" }
                known = db.fastKeysOf(sid)
                // 🔴 = 失败过、而且**到现在盘上还是没有**（后来补上了的就不该再报红）
                failed = db.unresolvedFailures(sid)
                source.folderStats().map { st ->
                    val cover = source.enumerate(com.nous.sylloge.ui.CoverCount, setOf(st.path))
                        .map { source.thumbnailUri(it) }
                    GalleryFolder(st.path, st.photos, st.videos, st.bytes, enabledOf(st.path), cover)
                }
            }
            freshLoaded = true
            rows = fresh
            // ★ 落盘给下一次冷启动。⚠️ 在赋值之后、IO 线程上做，⛔ 别挡住屏
            withContext(Dispatchers.IO) { FolderRowsCache.save(getApplication(), fresh) }
        }
    }

    /** 行右侧确认框（或弹窗确认按钮）⇒ 翻这个夹的开关。 */
    fun toggle(f: GalleryFolder) {
        viewModelScope.launch {
            val now = !enabledOf(f.path)
            prefs = prefs + (f.path to now)   // ⚠️ 缓存立刻跟上，连点才不会翻错
            rows = rows.map { if (it.path == f.path) it.copy(enabled = now) else it }
            dialog?.let { d ->
                if (d.folder.path == f.path) dialog = d.copy(folder = d.folder.copy(enabled = now))
            }
            withContext(Dispatchers.IO) { db.setFolderPref(f.path, now) }
            FolderPrefsBus.bump()   // 上卡的「N 张新的」跟着重算（recount 轻量路径）
        }
    }

    fun setAll(on: Boolean) {
        viewModelScope.launch {
            val paths = rows.map { it.path }
            prefs = prefs + paths.associateWith { on }
            rows = rows.map { it.copy(enabled = on) }
            withContext(Dispatchers.IO) { db.setFolderPrefs(paths.associateWith { on }) }
            FolderPrefsBus.bump()
        }
    }

    /** 点行 ⇒ 开 4×4 确认弹窗（照片带五态角标）。 */
    fun open(f: GalleryFolder) {
        viewModelScope.launch {
            val photos = withContext(Dispatchers.IO) {
                source.enumerate(PerFolderLimit, setOf(f.path)).map { item ->
                    GalleryPhoto(
                        item.id,
                        source.thumbnailUri(item),
                        badgeOf(item, enabledOf(f.path)),
                        item.displayName,
                    )
                }
            }
            dialog = FolderDialog(rows.firstOrNull { it.path == f.path } ?: f, photos)
        }
    }

    fun close() { dialog = null }

    private fun enabledOf(path: String) = prefs[path] ?: FolderDefaults.defaultEnabled(path)

    /**
     * ⚠️ 这里只算得出三个状态。
     * · 🟡 `Copying` 由 [copyingName] 在**渲染时**覆盖（真任务的进度，见 init）
     * · 🔴 `Failed` = **失败过且至今没落盘**（2026-08-25 补上）。
     *   ⚠️ 失败登记在**单独的失败表**里，⛔ 绝不进 entry —— entry 是判重依据，
     *   把没落盘的文件写进去 = 以后永远跳过它。
     */
    private fun badgeOf(item: PhotoItem, folderEnabled: Boolean): BadgeState = when {
        // ★ 已备份**优先于**忽略（Nous 2026-08-25：昨晚备过的 Bluesky 全显灰）——
        //   ⚪ 只该说「不会被备份」，⛔ 不该把「已经在盘上」这个事实盖掉
        known.contains(item.fastKey()) -> BadgeState.Copied
        // 🔴 失败且至今没落盘 —— 排在"忽略"前面：**没备成功比没勾选更该被看见**
        failed.contains(item.relativePath) -> BadgeState.Failed
        !folderEnabled -> BadgeState.Ignored
        else -> BadgeState.Pending
    }
}
