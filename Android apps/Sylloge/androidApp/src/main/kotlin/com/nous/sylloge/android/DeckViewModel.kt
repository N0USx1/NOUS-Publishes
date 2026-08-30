package com.nous.sylloge.android

import androidx.core.net.toUri
import android.app.Application
import android.content.Context
import android.net.Uri
import android.util.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.nous.sylloge.humanBytes
import com.nous.sylloge.PhotoItem
import com.nous.sylloge.ScanVerdict
import com.nous.sylloge.SetIdentity
import com.nous.sylloge.ui.DeckState
import com.nous.sylloge.ui.PrepLine
import com.nous.sylloge.ui.PrepFix
import com.nous.sylloge.ui.PrepStep
import com.nous.sylloge.ui.StepPhase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 把引擎的真实情况翻译成 `DeckState`。
 *
 * ⚠️ **这里是唯一允许碰 android.* 的一侧** —— `com.nous.sylloge.ui` 那个包只吃纯数据。
 * ⛔ **准备阶段那 8 步全部是真的**，一步对一个真实动作，⛔ 没有为了好看编假进度。
 */
/** 一次准备最多枚举这么多张。⚠️ 真到顶要在界面上说出来，⛔ 不静默截断。 */
private const val MaxScan = 200_000

/**
 * 每一步在焦点位停留多久。
 * ★ Nous 2026-08-25：「可以叠加 0.1 的延迟，**不至于刷刷的就下去了**」——
 *   步骤本身跑得快，不给停顿的话滚轮是一串糊影，用户读不到"发生了什么"。
 * ⚠️ 抽成常量：原来是散在六处的字面量 180/220（改一次要找六个地方）。
 */
private const val StepDwellMs = 280L

class DeckViewModel(app: Application) : AndroidViewModel(app) {

    private val source: PhotoSource get() = photoSourceOf(getApplication())
    private val db = CatalogDb(app)
    private val wm = WorkManager.getInstance(app)

    var deck by mutableStateOf<DeckState>(DeckState.Preparing(initialLines()))
        private set

    private var pending: List<PhotoItem> = emptyList()
    private var treeUri: Uri? = null
    /** prepare 最后一次认定的备份集 id —— recount 复用它，⛔ 不重新读盘。 */
    private var curSetId: String? = null
    /** 正在重算 ⇒ 此刻的 Preparing 是**我自己发的**，别把它当成"要从头准备"。 */
    private var recounting = false
    private var recountJob: kotlinx.coroutines.Job? = null

    init {
        observeWork()
        // L1：文件夹勾选变了 → 重算「N 张新的」。⚠️ 全量枚举不便宜 ⇒ 防抖 500ms，
        // 且只在**还没开跑**时重算（跑着的任务不动）。
        viewModelScope.launch {
            @OptIn(kotlinx.coroutines.FlowPreview::class)
            FolderPrefsBus.version.debounce(500).collect { v ->
                if (v == 0) return@collect
                when (deck) {
                    // ★ 已就绪 ⇒ 只重算数字。⛔ 不重放 U 盘那 8 步 —— 盘没变，
                    //   变的只是过滤口径（Nous 2026-08-25：「每次点新的 folder，
                    //   读 U 盘的流程他会再跑一遍」）。
                    is DeckState.Ready -> recount()
                    // ⚠️ 重算过程中卡面本来就是 Preparing（我自己发的）——
                    //    这时又来一次勾选，要接着重算，⛔ 不能当成"从头准备"（那会重放 8 步）。
                    is DeckState.Preparing -> if (recounting) recount() else prepare()
                    else -> Unit
                }
            }
        }
    }

    /** 取本地化字符串。⚠️ VM 不是 Composable ⇒ 走 Context，⛔ 不能用 stringResource。 */
    private fun str(id: Int, vararg args: Any): String =
        getApplication<android.app.Application>().getString(id, *args)

    /**
     * 「N 张照片 · M 个视频」的非 Compose 版本。
     * ⚠️ 同样走 `getQuantityString`，⛔ 不拼 "%d photos" —— 各语言单复数规则不同。
     * ⚠️ 为 0 的那一半不显示。
     */
    private fun mediaCount(photos: Int, videos: Int): String {
        val res = getApplication<android.app.Application>().resources
        val p = if (photos > 0) res.getQuantityString(R.plurals.n_photos, photos, photos) else ""
        val v = if (videos > 0) res.getQuantityString(R.plurals.n_videos, videos, videos) else ""
        return when {
            p.isNotEmpty() && v.isNotEmpty() -> str(R.string.media_join, p, v)
            v.isNotEmpty() -> v
            else -> p
        }
    }

    private fun initialLines() = PrepStep.entries.map { PrepLine(it, StepPhase.Pending) }

    /** 每一步做完就更新一次卡面 —— 用户看到的字是真的在往下滚。 */
    private fun emit(
        done: Int,
        active: Int,
        detail: String = "",
        failed: Boolean = false,
        fix: PrepFix = PrepFix.Retry,
    ) {
        deck = DeckState.Preparing(
            fix = fix,
            lines = PrepStep.entries.mapIndexed { i, s ->
                PrepLine(
                    step = s,
                    phase = when {
                        failed && i == active -> StepPhase.Failed
                        i < done -> StepPhase.Done
                        i == active -> StepPhase.Active
                        else -> StepPhase.Pending
                    },
                    detail = if (i == active) detail else "",
                )
            }
        )
    }

    /**
     * 回到前台时重新检查一遍。
     * ⛔ **拷贝进行中不动它** —— 那会把进度卡重置成准备流程，用户会以为备份断了。
     */
    fun refreshIfIdle() {
        if (deck is DeckState.Running) return
        // 用户可能刚拍了照片、或刚在设置页开了权限 ⇒ 让文件扫描缓存作废，重新扫一遍
        AllFilesSource.invalidate()
        prepare()
    }

    /** 走一遍准备流程。⚠️ 每一步都真的去问引擎，⛔ 不是定时器在走过场。 */
    fun prepare() {
        viewModelScope.launch {
            val ctx: Context = getApplication()

            // ⭐⭐ **正在跑就别碰卡面。**
            // prepare() 每步有几百毫秒的停顿 ⇒ 它总是**最后一个**写 deck，
            // 回到前台时会把正在跑的进度卡盖成「上次没做完」（2026-08-25 隔离测试里抓到，
            // 差点带着这个 bug 交付）。⛔ 这里必须先让路。
            // ⭐⭐ **有任务在跑/排队就整个不做。**
            //
            // ⚠️ 光看 `workRunning` 不够：prepare() 常常在 WorkManager 第一次发出状态
            //    **之前**就启动了，那时它还是 false ⇒ 必须**主动问一次** WorkManager。
            // ⚠️ 守卫必须在**发出第一步之前**：prepare() 的那 8 步本身就会把进度卡冲掉，
            //    只挡最后一次赋值的话，卡面会停在「准备完成」上（2026-08-25 隔离测试连抓三次）。
            // ⚠️ `.get()` 阻塞 ⇒ 放 IO，⛔ 不在主线程上等（ANR）。
            val busy = workRunning || withContext(Dispatchers.IO) {
                runCatching {
                    wm.getWorkInfosForUniqueWork(BackupWorker.WORK_NAME).get()
                        .any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
                }.getOrDefault(false)
            }
            if (busy) { Trace.i("prepare: 有任务在跑，让路"); return@launch }

            // ⚠️ 留一条痕迹：这条会进诊断包的「运行痕迹」，
            //    支持时能看出「他到底重试了几次、每次停在哪一步」。
            Trace.i("prepare: 开始走准备流程")
            // 0 · 等待 U 盘
            emit(0, 0)
            val grant = UsbAccess.persisted(ctx).firstOrNull()
            if (grant == null) { emit(0, 0, str(R.string.prep_need_usb_grant), failed = true, fix = PrepFix.PickUsb); return@launch }
            val tree = grant.uri
            treeUri = tree
            delay(StepDwellMs)

            // 1 · 已插入 U 盘（⛔ describeTree 是取证串，界面用 displayName）
            emit(1, 1, UsbAccess.displayName(ctx, tree))
            delay(StepDwellMs)

            // 2 · 检测（盘还在吗、可写吗）
            emit(2, 2)
            when (val a = withContext(Dispatchers.IO) { UsbAccess.checkAccess(ctx, tree) }) {
                is Access.Ok -> emit(3, 2, a.name)
                is Access.ReadOnly -> { emit(2, 2, str(R.string.prep_readonly), failed = true); return@launch }
                is Access.NotMounted -> { emit(2, 2, str(R.string.prep_not_mounted), failed = true); return@launch }
            }
            delay(StepDwellMs)

            // 3 · 验证形式（这盘上是谁的备份集）
            emit(3, 3)
            // ★ 接管陌生盘就发生在这一步。放在**准备流程里**而不是备份开始时，
            //   是为了让卡上的数字**一开始就是对的** —— 否则会先显示"7500 张要拷"，
            //   点下去又全部跳过（⛔ 那是说假话）。
            // ⚠️ 导入之后这块盘就变成 Known 了，引擎那边不必再做一次（⛔ 不写两处）。
            var imported = 0
            val setId = withContext(Dispatchers.IO) {
                when (val id = BackupSetStore.identify(ctx, tree, db.knownSetIds())) {
                    is SetIdentity.Known -> id.marker.setId
                    is SetIdentity.Foreign -> {
                        when (val r = ForeignImport.tryImport(ctx, tree, id.marker, db)) {
                            is ForeignImport.Result.Imported -> imported = r.count
                            // ⚠️ 其余情况**照旧沿用它的 setId**：判重落空 → 走哈希兜底
                            //    ⇒ 结果仍然正确，只是第一次慢。⛔ 绝不因为导入失败就当新盘乱拷。
                            else -> Unit
                        }
                        id.marker.setId
                    }
                    is SetIdentity.Fresh -> ""
                    is SetIdentity.Unreadable -> null
                }
            }
            if (setId == null) { emit(3, 3, str(R.string.prep_marker_unreadable), failed = true); return@launch }
            curSetId = setId
            emit(
                4, 3,
                when {
                    imported > 0 -> str(R.string.prep_imported, imported)
                    setId.isEmpty() -> str(R.string.prep_fresh_drive)
                    else -> str(R.string.prep_set, setId.take(8))
                },
            )
            delay(StepDwellMs)

            // 4 · 查找 log（本机记了多少条）
            emit(4, 4)
            val known = withContext(Dispatchers.IO) { db.entryCount(setId) }
            emit(5, 4, str(R.string.prep_known_count, known))
            delay(StepDwellMs)

            // 5 · 收集要上传的部分
            emit(5, 5)

            // ⭐⭐ **先问"我能看到全部照片吗"**，再去数。
            //    Android 14 的"仅选中的照片"会让 MediaStore **安静地少返回几千张** ——
            //    不报错、不抛异常。当成"没有照片"往下走 = 用户带着"备份完成"的错觉丢东西。
            //    ⛔ 这一步必须挡在数数之前（2026-08-25 真机实测：部分授权 ⇒ 0 个文件夹）。
            when (MediaStoreSource.access(ctx)) {
                MediaAccess.Full -> Unit
                // ⛔ **不写成准备流程里的一行小字** —— 那行会被右边夹掉（Nous 2026-08-25：
                //    「那个把字给夹没了，这个情况需要爆红卡 点击重申请权限」），
                //    而且这件事严重到不该和「某一步失败」长得一样。
                //    ⇒ 整张卡爆红，卡本身就是「重新申请权限」按钮。
                MediaAccess.Partial -> { deck = DeckState.NoPhotoPermission(partial = true); return@launch }
                MediaAccess.None -> { deck = DeckState.NoPhotoPermission(partial = false); return@launch }
            }

            var noneSelected = false
            val (news, skips) = withContext(Dispatchers.IO) {
                // 过滤口径唯一出处 = FolderFilter（⛔ 别在这里再抄一份公式）。
                // ⚠️ 只取一次：它要扫 MediaStore + 读库，调两遍是白花的（2026-08-25 顺手修）。
                val allowed = FolderFilter.allowed(db, source)
                noneSelected = allowed.isEmpty()
                // ⚠️ ⛔ 别用 `Int.MAX_VALUE` 当"不限量"的哨兵 —— 它会被下游当成容量去预分配。
                // 这里给一个明确的、够大的实数上限：⚠️ 一旦真到顶要在界面上说出来，
                // ⛔ 不做静默截断（cortex：no silent caps）。
                // ⚠️ 一趟 `partition`：⛔ 别写成 `filter{...}` + `filter{ it !in n }`，
                //    那是 **O(n²)**（4391 项要上千万次比较），而且 classify 会被调两遍。
                val all = source.enumerate(MaxScan, allowed)
                all.partition { db.classify(it, setId).verdict != ScanVerdict.DUPLICATE }
            }
            pending = news
            emit(6, 5, str(R.string.prep_to_copy, mediaCount(news.count { !it.isVideo }, news.count { it.isVideo })))
            delay(StepDwellMs)

            // 6 · 准备完成
            emit(7, 6, str(R.string.prep_total, news.sumOf { it.sizeBytes }.humanBytes()))
            delay(StepDwellMs + 40)

            // ⭐⭐ 上次没跑完 ⇒ 给出「继续」出口，⛔ 不要装作什么都没发生过。
            //
            // Nous 2026-08-25 真机踩到：中断之后卡面直接回到全新的「开始备份」，
            // 数字只掉了几十（因为他刚停），看起来就是「**断点续传直接没了**」。
            // 数据其实是好的（那 34 个已登记、下次会跳过），但**沟通上等于丢了**。
            //
            // ⚠️ 判据取自**库**（finished_at 为空），⛔ 不取自 WorkManager 的 progress ——
            //    那份数据在任务被取消后会被清空，所以原来那条分支从来没触发过。
            val unfinished = withContext(Dispatchers.IO) { db.lastUnfinishedSession(setId) }
            if (unfinished != null && news.isNotEmpty()) {
                val doneThen = unfinished.second
                deck = DeckState.NeedsResume(doneThen, doneThen + news.size)
                return@launch
            }

            // 7 · 等待确认 ⇒ 整张卡变绿
            deck = DeckState.Ready(
                // ⚠️ 照片和视频**分开报**（Nous 2026-08-25）
                newPhotos = news.count { !it.isVideo },
                newVideos = news.count { it.isVideo },
                newBytes = news.sumOf { it.sizeBytes },
                skipPhotos = skips.count { !it.isVideo },
                skipVideos = skips.count { it.isVideo },
                target = UsbAccess.displayName(ctx, tree),
                nothingSelected = noneSelected,
            )
        }
    }

    /**
     * 勾选变了 ⇒ 只重算「N 张新的」。盘的身份用 prepare 缓存的，缺了才退回全流程。
     *
     * ★ **界面要如实回到「收集要上传的部分」那一步再走下来**（Nous 2026-08-25：
     *   「机器逻辑上无所谓，但是 UI 上应该是回到『收集要上传的部分』然后再下来」）——
     *   这不是装饰：recount **真的在重跑那一步**（重新枚举 + 重新判重）。
     *   ⛔ 不许在结果那一行原地跳个数字了事，那是把真实发生的事藏起来。
     */
    private fun recount() {
        val tree = treeUri
        val sid = curSetId
        if (tree == null || sid == null) { prepare(); return }
        recountJob?.cancel()          // ⚠️ 连着勾几个 ⇒ 旧的那次不要了，⛔ 别让两次交错
        recounting = true
        recountJob = viewModelScope.launch {
            val ctx: Context = getApplication()
            var noneSelected = false
            // ★ 先把带子滚回"收集要上传的部分"
            emit(5, 5)
            delay(StepDwellMs)
            val (news, skips) = withContext(Dispatchers.IO) {
                val allowed = FolderFilter.allowed(db, source)
                noneSelected = allowed.isEmpty()
                val all = source.enumerate(MaxScan, allowed)
                all.partition { db.classify(it, sid).verdict != ScanVerdict.DUPLICATE }
            }
            pending = news
            // ★ 再顺着原来的语言走下来：结果 → 共多少 → 就绪
            emit(6, 5, str(R.string.prep_to_copy, mediaCount(news.count { !it.isVideo }, news.count { it.isVideo })))
            delay(StepDwellMs)
            emit(7, 6, str(R.string.prep_total, news.sumOf { it.sizeBytes }.humanBytes()))
            delay(StepDwellMs + 40)
            recounting = false
            deck = DeckState.Ready(
                // ⚠️ 照片和视频**分开报**（Nous 2026-08-25）
                newPhotos = news.count { !it.isVideo },
                newVideos = news.count { it.isVideo },
                newBytes = news.sumOf { it.sizeBytes },
                skipPhotos = skips.count { !it.isVideo },
                skipVideos = skips.count { it.isVideo },
                target = UsbAccess.displayName(ctx, tree),
                nothingSelected = noneSelected,
            )
        }
    }

    /**
     * 确认 ⇒ 真的入队备份。
     * @param throttleBytesPerSec 限速（字节/秒），0 = 全速。默认就是正确行为；
     *   限速只给验收观察用（把"小数据量"和"长时间"解耦），由调试侧显式传。
     */
    fun confirm(throttleBytesPerSec: Long = 0L) {
        val tree = treeUri ?: return
        val req = OneTimeWorkRequestBuilder<BackupWorker>()
            .setInputData(BackupWorker.input(tree, limit = 0, throttle = throttleBytesPerSec))
            .build()
        wm.enqueueUniqueWork(BackupWorker.WORK_NAME, ExistingWorkPolicy.KEEP, req)
    }

    fun cancel() = wm.cancelUniqueWork(BackupWorker.WORK_NAME)

    /**
     * 现在有没有备份任务在跑 / 排队。
     * ⚠️ 由 [observeWork] 维护，⛔ 别在别处推断 —— WorkManager 才知道真相。
     */
    private var workRunning = false

    /** 观察真实任务，翻译成 Running / Done / Failed / NeedsResume。 */
    private fun observeWork() {
        viewModelScope.launch {
            wm.getWorkInfosForUniqueWorkFlow(BackupWorker.WORK_NAME).collectLatest { list ->
                val wi = list.lastOrNull() ?: return@collectLatest
                // ⭐ 这是「现在有没有任务在跑」的**唯一真相源**。
                //   prepare() 靠它避免把进度卡盖掉（见 prepare 开头的守卫）。
                workRunning = wi.state == WorkInfo.State.RUNNING || wi.state == WorkInfo.State.ENQUEUED
                when (wi.state) {
                    WorkInfo.State.RUNNING -> {
                        val p = wi.progress
                        val name = p.getString(BackupWorker.KEY_CURRENT).orEmpty()
                        deck = DeckState.Running(
                            done = p.getInt(BackupWorker.KEY_DONE, 0),
                            total = p.getInt(BackupWorker.KEY_TOTAL, 0),
                            currentName = name,
                            // ⚠️⚠️ 字节数是 **Long**，必须 `getLong` —— WorkManager 的 Data
                            //    **类型严格**：用 getInt 读一个 Long 会**静默返回默认值 0**。
                            //    ⇒ 文件内进度一直是 0，这段代码从来没生效过（2026-08-25 Nous 指出
                            //    「进度条不是按照每个单个的文件的」才顺藤查出来）。
                            fileFraction = p.getLong(BackupWorker.KEY_FILE_TOTAL, 0L)
                                .let { t -> if (t > 0) p.getLong(BackupWorker.KEY_FILE_DONE, 0L).toFloat() / t else 0f },
                            accent = accentFor(p.getString(BackupWorker.KEY_CURRENT_URI).orEmpty()),
                        )
                    }
                    WorkInfo.State.SUCCEEDED -> {
                        val o = wi.outputData
                        deck = DeckState.Done(
                            copied = o.getInt(BackupWorker.KEY_COPIED, 0),
                            skipped = o.getInt(BackupWorker.KEY_SKIPPED, 0),
                            failed = o.getInt(BackupWorker.KEY_FAILED, 0),
                        )
                    }
                    WorkInfo.State.FAILED ->
                        deck = DeckState.Failed(
                            wi.outputData.getString(BackupWorker.KEY_ERROR) ?: str(R.string.err_no_reason),
                        )
                    // ⚠️ Android 12+ 禁止后台启动前台服务 ⇒ 被杀的任务**无法静默恢复**。
                    // ★ 正确行为是下次打开时告诉用户，⛔ 不是偷偷重试。
                    WorkInfo.State.CANCELLED -> {
                        val p = wi.progress
                        val d = p.getInt(BackupWorker.KEY_DONE, 0)
                        val t = p.getInt(BackupWorker.KEY_TOTAL, 0)
                        if (t > 0 && d < t) deck = DeckState.NeedsResume(d, t)
                    }
                    else -> Unit
                }
            }
        }
    }

    // ── 从当前照片采主色 ─────────────────────────────────
    // ⛔ 不引 androidx.palette：缩略图本来就要解码，取个平均色二十行的事。
    // ⚠️ 采到的色由 UI 层补间（拷得快时一秒过好几张，逐张跳会闪）。

    private val accentCache = HashMap<String, Color>()

    private fun accentFor(uriStr: String): Color? {
        if (uriStr.isBlank()) return null
        accentCache[uriStr]?.let { return it }
        // ★ 直接用引擎发过来的 URI 采色 —— ⛔ 不再去 `pending` 里找那张照片：
        //   那是上一次准备流程的快照，进程重启后为空，炫光会永远不亮。
        val c0 = runCatching { sampleAccent(uriStr.toUri()) }.getOrNull()
        if (c0 != null) { accentCache[uriStr] = c0; if (accentCache.size > 64) accentCache.clear(); return c0 }
        return null
    }

    @Suppress("unused")
    private fun accentForLegacy(key: String): Color? {
        accentCache[key]?.let { return it }
        // ⚠️ 进度里传过来的是**相对路径**（`DCIM/Camera/IMG.jpg`），⛔ 不是文件名 ——
        //    只按 displayName 找永远匹配不上，炫光就一直是灰的（2026-08-25 抓到）。
        //    两个都认，谁先中算谁。
        val item = pending.firstOrNull { it.relativePath == key || it.displayName == key }
            ?: return null
        val c = runCatching { sampleAccent(source.thumbnailUri(item)) }.getOrNull() ?: return null
        accentCache[key] = c
        if (accentCache.size > 64) accentCache.clear()
        return c
    }

    /**
     * 取一张小图用来采色。
     *
     * ⚠️⚠️ **`loadThumbnail` 只认 `content://`。** 切到 [AllFilesSource] 之后 URI 变成了
     * `file://`，它会直接抛异常 ⇒ accent 变 null ⇒ **整张卡的炫光消失**
     * （2026-08-25 Nous 报「炫光效果毁了」才查出来）。
     * ⇒ content:// 走系统缩略图（快、有缓存），其余一律自己**降采样解码**。
     * ⚠️ 必须 `inSampleSize`，⛔ 别整张 4000×3000 解进内存。
     */
    private fun thumbOf(uri: Uri): android.graphics.Bitmap? {
        val cr = getApplication<Application>().contentResolver
        if (uri.scheme == "content") {
            runCatching { return cr.loadThumbnail(uri, Size(32, 32), null) }
        }
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { cr.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) } }
        val big = maxOf(bounds.outWidth, bounds.outHeight)
        if (big <= 0) return null
        var sample = 1
        while (big / sample > 64) sample *= 2
        val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
        return runCatching {
            cr.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, opts) }
        }.getOrNull()
    }

    /**
     * 32×32 的加权平均色。
     * ⚠️ 直接平均会灰掉（互补色相消）⇒ **按饱和度加权**，让主色调压过灰底。
     */
    private fun sampleAccent(uri: Uri): Color {
        val bmp = thumbOf(uri) ?: return Color.Gray
        var r = 0.0; var g = 0.0; var b = 0.0; var wsum = 0.0
        val px = IntArray(bmp.width * bmp.height)
        bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        for (p in px) {
            val pr = (p shr 16) and 0xFF
            val pg = (p shr 8) and 0xFF
            val pb = p and 0xFF
            val mx = maxOf(pr, pg, pb); val mn = minOf(pr, pg, pb)
            val w = 0.15 + (mx - mn) / 255.0   // 饱和度越高权重越大
            r += pr * w; g += pg * w; b += pb * w; wsum += w
        }
        if (wsum <= 0.0) return Color.Gray
        return Color((r / wsum).toInt() / 255f, (g / wsum).toInt() / 255f, (b / wsum).toInt() / 255f, 1f)
    }
}
