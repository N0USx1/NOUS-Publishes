package com.nous.sylloge.android

import android.content.Context
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import com.nous.sylloge.BackupOutcome
import com.nous.sylloge.BackupSetMarker
import com.nous.sylloge.SetIdentity
import com.nous.sylloge.Layout
import com.nous.sylloge.LogLine
import com.nous.sylloge.ManifestRow
import com.nous.sylloge.SessionLog
import com.nous.sylloge.SessionTally
import com.nous.sylloge.PhotoItem
import com.nous.sylloge.fastKey
import com.nous.sylloge.humanBytes
import com.nous.sylloge.ScanVerdict
import com.nous.sylloge.sanitizeForFat
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive

/**
 * 拷贝引擎。按最终形态写全，M3 阶段只喂 5 张 —— 出问题时 U 盘上只有 5 个文件要查。
 *
 * 三条不可违背的规矩：
 *  1. **先写 `.part` 再 rename**。中途拔盘只留一个能识别的残片，不会有半截文件冒充完整文件
 *  2. **只有 rename 成功之后才登记 catalog**。提前登记会造出「catalog 说备份了、U 盘上其实没有」的假记录
 *  3. ⛔ **绝不覆盖**。同名不同内容一律另存 `~2`
 */
class BackupEngine(
    private val ctx: Context,
    private val db: CatalogDb,
    private val source: PhotoSource,
    /**
     * 人为限速（字节/秒），0 = 不限。
     *
     * ⭐ **这是测试基础设施，不是玩具**：把「小数据量」和「长时间」解耦 ——
     * 20 张照片限到 200 KB/s 就是三四分钟，够测后台运行 / 取消 / 杀进程 / 断点续传，
     * 而 U 盘上只写几十 MB。⛔ 反复全量压测对 U 盘 P/E 寿命是真实消耗，不能那么测。
     *
     * 附带好处：限速用的是可挂起的 `delay()`，**取消会变得非常跟手**。
     */
    private val throttleBytesPerSec: Long = 0L,
) {

    data class Progress(
        /** 已处理的**文件数**（通知栏用这个） */
        val done: Int,
        val total: Int,
        val current: String,
        /** 当前这个文件已写入的字节 / 总字节。跳过的文件这两个都是 0。 */
        val fileDone: Long = 0L,
        val fileTotal: Long = 0L,
        /**
         * 当前这张的原图 URI。
         * ★ 界面拿它采主色做炫光 —— ⛔ 别让界面自己去列表里找那张照片：
         *   那份列表是上一次准备流程的快照，**进程重启后是空的**，炫光就永远不亮。
         */
        val currentUri: String = "",
        val outcomes: List<BackupOutcome> = emptyList(),
    )

    /** 块级回报的最小间隔。⚠️ 不限流的话 256KB 一块能一秒回报几十次，
     *  通知和 WorkManager 的进度表都会被刷爆。 */
    private val emitIntervalMs = 200L

    /**
     * `DocumentFile.findFile()` 是 O(n) 线性扫目录 —— 每存一个文件都去 findFile 一遍父目录，
     * 7000 张时会慢到不可用。目录对象缓存起来，键是相对路径。
     */
    private val dirCache = HashMap<String, DocumentFile>()

    /**
     * 针对文件的 `findFile` 同样是 O(n) 的。
     * 如果文件夹内有成千上万个文件，逐文件 `findFile` 或多次查找空闲文件名，会引发 O(N^2) 指数级耗时。
     * 缓存：目录 URI 字符串 -> (文件名 -> DocumentFile)
     */
    private val childrenCache = HashMap<String, MutableMap<String, DocumentFile>>()

    private fun getChildrenOf(dir: DocumentFile): MutableMap<String, DocumentFile> {
        val key = dir.uri.toString()
        return childrenCache.getOrPut(key) {
            val map = HashMap<String, DocumentFile>()
            dir.listFiles().forEach { f ->
                f.name?.let { map[it] = f }
            }
            map
        }
    }

    private fun rootDir(tree: DocumentFile): DocumentFile {
        val name = Layout.rootDirName(Build.MODEL)
        return tree.findFile(name)
            ?: tree.createDirectory(name)
            ?: Failures.cannotCreate(name)
    }


    /** 逐段建目录，全程走缓存。相对目录形如 `DCIM/Camera`。 */
    private fun ensureDir(root: DocumentFile, relDir: String): DocumentFile {
        if (relDir.isEmpty()) return root
        dirCache[relDir]?.let { return it }
        var cur = root
        val acc = StringBuilder()
        for (raw in relDir.split('/')) {
            if (raw.isEmpty()) continue
            val seg = sanitizeForFat(raw)
            if (acc.isNotEmpty()) acc.append('/')
            acc.append(seg)
            val key = acc.toString()
            val cached = dirCache[key]
            if (cached != null) { cur = cached; continue }
            
            val children = getChildrenOf(cur)
            val next = children[seg]?.takeIf { it.isDirectory }
                ?: cur.createDirectory(seg)?.also { children[seg] = it }
                ?: Failures.cannotCreate(key)
            
            dirCache[key] = next
            cur = next
        }
        return cur
    }

    private fun freeName(dir: DocumentFile, wanted: String, children: MutableMap<String, DocumentFile>): String {
        if (!children.containsKey(wanted)) return wanted
        val dot = wanted.lastIndexOf('.')
        val base = if (dot > 0) wanted.substring(0, dot) else wanted
        val ext = if (dot > 0) wanted.substring(dot) else ""
        var n = 2
        while (n < 1000) {
            val cand = base + "~" + n + ext
            if (!children.containsKey(cand)) return cand
            n++
        }
        throw SylError("too_many_dupes", wanted)
    }

    private fun sha256(uri: Uri): String? = runCatching {
        val md = MessageDigest.getInstance("SHA-256")
        ctx.contentResolver.openInputStream(uri)!!.use { ins ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = ins.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        md.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }.getOrNull()

    /** 开工前清掉上次留下的 `.part` 残片。⚠️ 这一步不做，U 盘会越积越多垃圾。 */
    fun cleanupParts(treeUri: Uri): Int {
        // 清残片时还不知道 setId，用空串 => hasStoredName 恒 false =>
        // 只靠"名字像残片"这一条判据。⚠️ 所以命名前缀必须足够独特。
        val setIdForCleanup = ""
        val tree = DocumentFile.fromTreeUri(ctx, treeUri) ?: return 0
        val root = tree.findFile(Layout.rootDirName(Build.MODEL)) ?: return 0
        var n = 0
        fun walk(d: DocumentFile) {
            d.listFiles().forEach { f ->
                if (f.isDirectory) { walk(f); return@forEach }
                val name = f.name ?: return@forEach
                val looksLikePart = name.startsWith(Layout.PART_PREFIX) ||
                    name.contains(Layout.PART_SUFFIX)          // 兼容旧后缀方案的历史残留
                // ⚠️ 双重判据：像残片 **而且** catalog 里没登记过。
                //    只有 rename 成功才会登记，所以残片永远不在 catalog 里；
                //    反过来，用户真有个叫 `x.part.jpg` 的照片被正常备份了，它在 catalog 里，不会被删。
                if (looksLikePart && !db.hasStoredName(setIdForCleanup, name) && f.delete()) {
                    Trace.w("清掉残片: " + name)
                    n++
                }
            }
        }
        walk(root)
        if (n > 0) Trace.w("cleanupParts: 清掉 " + n + " 个残片")
        return n
    }

    suspend fun run(
        treeUri: Uri,
        items: List<PhotoItem>,
        onProgress: (Progress) -> Unit,
    ): List<BackupOutcome> {
        when (val a = UsbAccess.checkAccess(ctx, treeUri)) {
            is Access.Ok -> Unit
            else -> error(Failures.text(ctx, a))
        }
        val tree = DocumentFile.fromTreeUri(ctx, treeUri) ?: throw SylError("tree_unopenable", "")
        val volumeId = UsbAccess.volumeIdOf(treeUri)
        // ⚠️ **两份缓存必须一起清** —— 只清一份就是「两份状态只清一份」那类 bug。
        //    今天不发作（引擎每次任务新建），但一旦有人复用实例，就会读到过期的目录列表。
        dirCache.clear()
        childrenCache.clear()
        val root = rootDir(tree)

        // ── 双层验证：卷 ID 只是快路径，真正的身份在盘上的标识文件里 ──────
        val identity = BackupSetStore.identify(ctx, treeUri, db.knownSetIds())
        val setId = when (identity) {
            is SetIdentity.Known -> identity.marker.setId
            // 陌生备份集：本机没记录，但盘上确实是一份 Sylloge 备份。
            // 沿用它的 setId，判重会全部落空 → 走哈希校验兜底 → 结果正确，只是第一次慢。
            is SetIdentity.Foreign -> identity.marker.setId
            SetIdentity.Fresh -> BackupSetStore.newSetId()
            is SetIdentity.Unreadable -> throw SylError("marker_bad", identity.reason)
        }
        Trace.i("备份集身份: " + identity::class.simpleName + " setId=" + setId + " volume=" + volumeId)

        // ⚠️ `tree.name` 是卷 ID（"A0F5-37E5"），**不是人话盘名** ——
        //    它会一路显示到日志页上（2026-08-25 抓到）。⇒ 用 displayName（「NOUS sync」）。
        //    ⛔ 界面上要出现的东西，别在写库时就存成调试串。
        val sid = db.startSession(Build.MODEL, setId, volumeId, UsbAccess.displayName(ctx, treeUri))
        val startedAt = System.currentTimeMillis()
        val outs = ArrayList<BackupOutcome>(items.size)

        // ★★ **先把已备份的一次滤掉，⛔ 不逐张进 copyOne 查库再说"跳过"**
        //   （Nous 2026-08-26 报的设计 bug：准备阶段明明算出了"412 张新的"，
        //    真开始备份却全盘 9330 张逐张走一遍 —— 每张 1–2 次 rawQuery，
        //    8900 多张只是为了查库然后跳过，非常卡，进度条还从 0/9330 走起）。
        //   ⇒ 和准备侧同一个思路：快筛键**一次捞全进内存**（fastKeysOf），
        //     整批 partition。口径与 classify 完全同源（都是 fastKey 命中=重复）；
        //     CONFLICT（同路径但变了）不在 known 里 ⇒ 留在 toCopy 走慢路径，语义不变。
        //   ⚠️ 滤掉的照样计进 outs（skipped 统计、盘上日志的汇总数字都不变），
        //     只是不再一张一张地"走过场"。
        val known = db.fastKeysOf(setId)
        val (dups, toCopy) = items.partition { it.fastKey() in known }
        dups.forEach { outs += BackupOutcome.SkippedDuplicate(it, "快筛命中（开工前整批预滤）") }
        Trace.i("run: 预滤掉 " + dups.size + " 张已备份，实际要拷 " + toCopy.size + " 张")

        // ⚠️⚠️ **取消也必须把会话结掉**（统计照写、finished_at 留空）——
        //    否则 `ensureActive()` 抛出后直接跳过下面的收尾，这次会话永远停在
        //    "拷=0 跳过=0 失败=0"，而它其实拷了几十个（2026-08-25 Nous 真机抓到）。
        try {
        toCopy.forEachIndexed { i, item ->
            // 协作式取消：点「中断」时从这里退出，不会留下半截文件（.part 还在，下次清掉）
            currentCoroutineContext().ensureActive()
            val uri = source.contentUri(item).toString()
            // ⚠️ 一律用**具名参数** —— Progress 加过字段，位置参数会静默错位
            onProgress(
                Progress(
                    done = i, total = toCopy.size, current = item.relativePath,
                    outcomes = outs.toList(), currentUri = uri,
                )
            )
            val r = copyOne(root, sid, setId, item) { fDone, fTotal ->
                onProgress(
                    Progress(
                        done = i, total = toCopy.size, current = item.relativePath,
                        fileDone = fDone, fileTotal = fTotal,
                        outcomes = outs.toList(), currentUri = uri,
                    )
                )
            }
            outs += r
            // ⚠️ 一失败就先确认盘还在不在。备份跑到一半被拔盘的话，
            //    逐文件 catch 会**一口气刷出几千条"失败"**，既没用又掩盖真正的原因。
            if (r is BackupOutcome.Failed) {
                // ★ 登记失败（M7）。⛔ 写进**失败表**，不是 entry ——
                //   entry 是判重依据，写进去等于以后永远跳过这张。
                db.recordFailure(sid, setId, item.relativePath, r.reason, r.technical)
                val a = UsbAccess.checkAccess(ctx, treeUri)
                if (a !is Access.Ok) {
                    Trace.e("盘不可用，中止本次备份: " + a)
                    db.finishSession(sid, outs)
                    error(Failures.text(ctx, a))
                }
            }
        }
        } catch (t: Throwable) {
            // ⚠️ 这里刻意抓 **Throwable** 而不只是 CancellationException ——
            //    任何异常退出都必须把统计落下来，否则日志页会说"拷 0"而其实拷了几十个。
            //    ⛔ 只抓 CancellationException 会漏掉别的中止路径（2026-08-25 实测：
            //    优雅取消时那个 catch 就没进来，登记了 3 条却报 0）。
            db.finishSession(sid, outs, completed = false)
            Trace.w("中止(" + t.javaClass.name + ")：会话 " + sid + " 记 " + outs.size + " 项，finished_at 留空")
            throw t
        }
        db.finishSession(sid, outs)

        // ── 收尾：让这块盘变成**自描述**的 ─────────────────────────────
        // 标识文件 = 身份 + 人话说明；catalog 快照 = 索引，换手机/重装/拷到新盘时能导回来。
        // ⚠️ 一定要在 finishSession 之后导出，否则快照里少了本次会话的统计。
        val now = System.currentTimeMillis()
        val created = (identity as? SetIdentity.Known)?.marker?.createdAtMs
            ?: (identity as? SetIdentity.Foreign)?.marker?.createdAtMs ?: now
        BackupSetStore.writeMarker(
            ctx, treeUri,
            BackupSetMarker(
                setId = setId,
                device = Build.MODEL,
                createdAtMs = created,
                lastBackupAtMs = now,
                entryCount = db.entryCount(setId),
            ),
        )
        BackupSetStore.exportCatalog(ctx, treeUri, ctx.getDatabasePath(CatalogDb.DB_NAME))
        writeDriveReports(treeUri, setId, sid, outs, startedAt, now)

        onProgress(Progress(done = toCopy.size, total = toCopy.size, current = "", outcomes = outs.toList()))
        Trace.i("run: 完成 " + outs.size + " 项")
        return outs
    }

    private suspend fun copyOne(
        root: DocumentFile,
        sid: Long,
        setId: String,
        item: PhotoItem,
        onBytes: (Long, Long) -> Unit,
    ): BackupOutcome = try {
        // ⚠️ 这道逐张快筛只是**最后一道闸**（防调用方漏过滤）—— 正常路径上
        //    run() 开工时已整批预滤，这里几乎不会命中。⛔ 别把它当成主判重路径。
        if (db.classify(item, setId).verdict == ScanVerdict.DUPLICATE) {
            BackupOutcome.SkippedDuplicate(item, "快筛命中（路径+大小+时间全同）")
        } else {
            val relDir = item.relativePath.substringBeforeLast('/', "")
            val dir = ensureDir(root, relDir)
            val wanted = sanitizeForFat(item.displayName)
            val children = getChildrenOf(dir)
            val existing = children[wanted]

            var target = wanted
            var isRename = false
            var skipReason: String? = null

            if (existing != null) {
                // 目标名已被占用但 catalog 里没记录 —— 换机 / 重装 / 清过 catalog。
                // 这时候必须**比内容**，不能瞎猜，更不能覆盖。
                val srcHash = sha256(source.contentUri(item))
                val dstHash = sha256(existing.uri)
                if (srcHash != null && srcHash == dstHash) {
                    db.record(sid, setId, item, wanted, srcHash, skipped = true)   // 补一条，下次快筛就能挡住
                    skipReason = "内容哈希相同（U 盘上已有这张）"
                } else {
                    target = freeName(dir, wanted, children)
                    isRename = true
                }
            }

            if (skipReason != null) {
                BackupOutcome.SkippedDuplicate(item, skipReason)
            } else {
                val wantPart = Layout.PART_PREFIX + target
                val part = dir.createFile(source.mimeType(item), wantPart)
                    ?: Failures.cannotCreate(wantPart)
                // ⚠️ SAF 可能按 MIME 改名（后缀方案就被改成过 xxx.jpg.part.jpg）。
                //    前缀方案理论上不会，但这是**实测才能确认的事**，所以留一条日志。
                val actualPart = part.name ?: wantPart
                if (actualPart != wantPart) {
                    Trace.w("⚠️ 临时文件名被 SAF 改写: " + wantPart + " -> " + actualPart)
                } else {
                    Trace.i("临时文件名原样保留: " + actualPart)
                }
                var written = 0L
                var lastEmit = 0L
                onBytes(0L, item.sizeBytes)
                ctx.contentResolver.openInputStream(source.contentUri(item))!!.use { ins ->
                    ctx.contentResolver.openOutputStream(part.uri)!!.use { o ->
                        val buf = ByteArray(if (throttleBytesPerSec in 1..262_144) 32 * 1024 else 256 * 1024)
                        val startNs = System.nanoTime()
                        while (true) {
                            // ⚠️ 取消检查必须放在**块循环里面**，不能只放在文件之间 ——
                            //    否则一个几十 MB 的视频正在写，点了「中断」也得等它写完。
                            currentCoroutineContext().ensureActive()
                            val n = ins.read(buf)
                            if (n <= 0) break
                            o.write(buf, 0, n)
                            written += n
                            val nowMs = System.nanoTime() / 1_000_000
                            if (nowMs - lastEmit >= emitIntervalMs) {
                                lastEmit = nowMs
                                onBytes(written, item.sizeBytes)
                            }
                            if (throttleBytesPerSec > 0) {
                                val targetMs = written * 1000 / throttleBytesPerSec
                                val elapsedMs = (System.nanoTime() - startNs) / 1_000_000
                                if (targetMs > elapsedMs) delay(targetMs - elapsedMs)
                            }
                        }
                        o.flush()
                    }
                }
                onBytes(written, item.sizeBytes)
                check(part.renameTo(target)) { "rename 失败（FAT 上有非法字符？）" }
                children[target] = part

                // ⚠️ SAF 可能按 mime 给文件名补扩展名 —— 以**实际落盘的名字**为准，
                // 记想当然的名字会让 catalog 和 U 盘对不上。
                val actual = part.name ?: target
                if (actual != target) Trace.w("rename 后名字被改写: " + target + " -> " + actual)

                db.record(sid, setId, item, actual, null)   // ⚠️ 只有走到这里才登记
                if (isRename) BackupOutcome.Renamed(item, actual)
                else BackupOutcome.Copied(item, written)
            }
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        // ⛔ 绝不能被下面的 catch(Exception) 吞掉当成"失败" —— 取消不是错误，
        //    而且吞掉之后协程不会真的停下来。半截的 .part 留在盘上，下次开工会清掉。
        throw e
    } catch (e: Exception) {
        Trace.e("copyOne 失败 " + item.relativePath, e)
        Failures.of(e, item.sizeBytes).let { BackupOutcome.Failed(item, it.first, it.second) }
    }

    /**
     * 收尾时往盘上写两份**人类可读**的东西（M7）。
     * ★ 目的：**这块盘离开 app 也能自证** —— 插到电脑上就看得懂发生过什么。
     *
     * 分工（⛔ 别把两者混成一个）：
     * - `log/YYYY-MM-DD.log` = **这次发生了什么**（流水，追加）
     * - `manifest.csv`       = **盘上现在有什么**（快照，整份重写）
     *
     * ⚠️ 流水里**跳过的只写汇总数字，⛔ 不逐条列**：没插新照片时一次会跳过几千条，
     * 逐条列会把真正发生的三五件事彻底淹掉。要完整清单去看 manifest.csv。
     * ⚠️ 整段包在 runCatching 里 —— **写报告失败绝不能让"照片已经拷好了"这件事翻车**。
     */
    private fun writeDriveReports(
        treeUri: Uri,
        setId: String,
        sessionId: Long,
        outs: List<BackupOutcome>,
        startedAt: Long,
        finishedAt: Long,
    ) = runCatching {
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date(startedAt))
        val clock = SimpleDateFormat("HH:mm:ss", Locale.ROOT)

        // ⚠️ 跳过的**只计数不成行** —— 见 SessionLog.render 的说明
        var copied = 0; var skipped = 0; var failed = 0; var renamed = 0; var bytes = 0L
        val lines = ArrayList<LogLine>()
        outs.forEach { o ->
            when (o) {
                is BackupOutcome.Copied -> {
                    copied++; bytes += o.bytesWritten
                    lines += LogLine("copied", o.item.relativePath, o.bytesWritten.humanBytes())
                }
                is BackupOutcome.Renamed -> {
                    renamed++
                    lines += LogLine("renamed", o.item.relativePath,
                        "-> " + o.newName + " (a different file with that name was already here)")
                }
                is BackupOutcome.Failed -> {
                    failed++
                    // ⚠️ 盘上写的是**技术串**，⛔ 不是本地化句子 —— 盘要能被任何语言读
                    lines += LogLine("failed", o.item.relativePath,
                        (if (o.reason.isEmpty()) "" else o.reason + ": ") + o.technical)
                }
                is BackupOutcome.SkippedDuplicate -> skipped++
            }
        }
        val text = SessionLog.render(
            startClock = clock.format(Date(startedAt)),
            endClock = clock.format(Date(finishedAt)),
            target = UsbAccess.displayName(ctx, treeUri),
            lines = lines,
            tally = SessionTally(copied, renamed, skipped, failed, bytes),
            seconds = ((finishedAt - startedAt) / 1000).coerceAtLeast(0),
            humanBytes = bytes.humanBytes(),
        )

        BackupSetStore.appendDayLog(ctx, treeUri, day, text)

        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT)
        BackupSetStore.writeManifest(
            ctx, treeUri,
            db.allEntries(setId).map {
                ManifestRow(
                    relPath = it.relPath,
                    storedName = it.storedName,
                    isVideo = it.isVideo,
                    bytes = it.sizeBytes,
                    copiedAt = stamp.format(Date(it.copiedAtMs)),
                )
            },
        )
    }.getOrElse { Trace.e("写盘上报告失败（不影响已备份的文件）", it) }

}
