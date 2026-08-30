package com.nous.sylloge.android

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import com.nous.sylloge.CatalogSchema
import com.nous.sylloge.FastKey
import com.nous.sylloge.PhotoItem
import com.nous.sylloge.ScanResult
import com.nous.sylloge.ScanVerdict
import com.nous.sylloge.fastKey

/**
 * 去重索引。
 *
 * ⚠️ **工作库放 app 内部存储，不放 U 盘** —— SQLite 打不开 SAF 的 content:// URI。
 * 每次备份结束再导出一份快照到 U 盘的 `_backup/catalog.db` 给 Windows 端读（M6）。
 *
 * 表结构的**唯一来源**是 `shared` 里的 [CatalogSchema]，桌面端用 JDBC 读同一份 DDL。
 */
class CatalogDb(
    ctx: Context,
    /**
     * 库文件名。⚠️ **只有测试才该传别的值** —— 让验证能用**同一段写入代码**
     * 写进一个一次性的库，⛔ 不碰用户真库，也⛔ 不复制一份插入逻辑（那就不是在验真东西了）。
     */
    dbName: String = DB_NAME,
) : SQLiteOpenHelper(ctx, dbName, null, CatalogSchema.VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        // ★ 新库也走同一条 [migrate] —— ⛔ 别在这里再写一遍建表：
        //   两条路各写一份，迟早分叉，而分叉不报错，只是新装的机器少一列。
        migrate(db)
        Trace.i("CatalogDb: 建表完成 (v${CatalogSchema.VERSION})")
    }

    /**
     * ⭐⭐ **降级不许崩**（2026-08-25 真机抓到）：
     * `SQLiteOpenHelper` 的默认 `onDowngrade` **直接抛异常** ⇒
     * 库是 v7、装上一个只认 v6 的包，app **每次打开必崩，用户完全无法自救**：
     *
     * ```
     * SQLiteException: Can't downgrade database from version 7 to 6
     *     at CatalogDb.folderPrefs(CatalogDb.kt:206)
     * ```
     *
     * 现实里会发生：Play 回滚、旁载旧包、从旧备份恢复 app。
     *
     * ⛔ **绝不能"降级就重建"** —— 那会抹掉备份历史和判重索引，
     * 下次备份要把几十 GB 全部重传一遍（对备份 app 是最坏的结果）。
     * ⇒ **什么都不做，让旧代码在新库上跑**。这之所以安全，是因为本项目的
     * 迁移**全部是加法**（ALTER TABLE ADD COLUMN / 新建表），旧代码读它自己那几列没问题。
     *
     * ⚠️⚠️ **这条安全性是有前提的：以后每一次迁移都必须继续是加法。**
     * 一旦有人改名/删列/改语义，这里就不再安全 —— 那时要改成"看懂就跑，看不懂就明确报错"，
     * ⛔ 而不是回到崩溃。
     */
    /**
     * ⭐⭐ **升级和降级走同一条幂等路径**（2026-08-25 真机连炸两次才定的形）。
     *
     * 原来是一堆 `if (old==6 && new==7)` 的版本对分支，两个真实事故打穿了它：
     *
     * 1. **降级直接崩**：`SQLiteOpenHelper` 默认的 `onDowngrade` 抛异常 ⇒
     *    库是 v7、装上只认 v6 的包，**每次打开必崩，用户无法自救**
     *    （Play 回滚、旁载旧包、从旧备份恢复都会发生）。
     * 2. **降级之后再升级又崩**：`onDowngrade` 就算不抛，框架**仍会把版本号写回旧值** ⇒
     *    下次升级把已经做过的迁移**重放一遍** ⇒ `duplicate column name: is_video`。
     *
     * ★ 根治不是"把版本号记对"，是**让每一步迁移都幂等**：
     * 建表 `IF NOT EXISTS`、加列先查 `PRAGMA table_info`。
     * 这样无论从哪个版本来、来过几次、中间降过没降过，结果都一样。
     *
     * ⛔ **绝不走"重建"那条路** —— 那会抹掉备份历史和判重索引，
     * 下次备份要把几十 GB 全部重传（对一个备份 app 是最坏的结果）。
     */
    override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
        Trace.i("CatalogDb: 迁移 v" + old + " → v" + new)
        migrate(db)
    }

    override fun onDowngrade(db: SQLiteDatabase, old: Int, new: Int) {
        // 库比这个 app 新。本项目的迁移**全是加法**，旧代码读自己那几列没问题 ⇒ 照常用。
        // ⚠️⚠️ 前提是**以后每次迁移都继续是加法**。哪天真删了列 / 改了语义，
        //    这里要改成"看不懂就明确报错"，⛔ 而不是回到崩溃。
        Trace.w("库版本 v" + old + " 比本 app 认识的 v" + new + " 新；按加法迁移的前提继续使用，不重建")
        migrate(db)
    }

    /** 幂等：跑几次、从哪个版本跑，结果都一样。 */
    private fun migrate(db: SQLiteDatabase) {
        CatalogSchema.DDL.forEach(db::execSQL)          // 全部带 IF NOT EXISTS
        db.execSQL(CatalogSchema.FAIL_DDL)
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_fail_session ON ${CatalogSchema.T_FAIL}(session_id)")

        // v5 补的：跳过的条目要能和真拷的区分开
        if (addColumn(db, CatalogSchema.T_ENTRY, "skipped", "INTEGER NOT NULL DEFAULT 0")) {
            // ⚠️ 只在**刚补上这一列**时回填，⛔ 不能每次迁移都跑一遍
            db.execSQL(
                "UPDATE ${CatalogSchema.T_ENTRY} SET skipped=1 WHERE session_id IN " +
                    "(SELECT id FROM ${CatalogSchema.T_SESSION} WHERE copied=0)"
            )
        }
        // v7 补的：照片 / 视频要分得开
        addColumn(db, CatalogSchema.T_ENTRY, "is_video", "INTEGER NOT NULL DEFAULT 0")

        // ★ 失败改存"原因键 + 技术串"（2026-08-26）。⚠️ 老行的 `reason` 里是**整句人话**，
        //   `Failures.render` 认不出键就原样吐出来 ⇒ **老记录不用迁移也读得懂**。
        addColumn(db, CatalogSchema.T_FAIL, "technical", "TEXT NOT NULL DEFAULT ''")
    }

    /**
     * 加一列，**已经有就跳过**。返回 true 表示这次真的加了。
     * ★ 用 `PRAGMA table_info` 去问库本身，⛔ 不靠版本号推断"这一列应该在不在"——
     *   版本号会因为降级被写回，列不会自己消失。**问事实，别问账本。**
     */
    private fun addColumn(db: SQLiteDatabase, table: String, col: String, decl: String): Boolean {
        val has = db.rawQuery("PRAGMA table_info(" + table + ")", null).use { c ->
            val idx = c.getColumnIndex("name")
            generateSequence { if (c.moveToNext()) c.getString(idx) else null }.any { it == col }
        }
        if (has) return false
        db.execSQL("ALTER TABLE " + table + " ADD COLUMN " + col + " " + decl)
        Trace.i("CatalogDb: 补列 " + table + "." + col)
        return true
    }

    /**
     * 一级快筛：**同一个卷上**路径 + 大小 + 修改时间三者全同 => 同一张，跳过。
     *
     * ⚠️ `setId` 不能省。用户会有多个 U 盘：备份到 A 盘之后换 B 盘，
     * 如果判重不分卷，就会以为"都备过了"，**B 盘上一张都不拷**。
     */
    private fun hasFastKey(setId: String, k: FastKey): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM ${CatalogSchema.T_ENTRY} " +
            "WHERE set_id=? AND rel_path=? AND size_bytes=? AND modified_sec=? LIMIT 1",
        arrayOf(setId, k.relativePath, k.sizeBytes.toString(), k.modifiedEpochSec.toString()),
    ).use { it.moveToFirst() }

    /** 同路径在这个卷上备份过（但大小/时间对不上）=> 冲突，另存名字，⛔绝不覆盖。 */
    private fun hasRelPath(setId: String, relPath: String): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM ${CatalogSchema.T_ENTRY} WHERE set_id=? AND rel_path=? LIMIT 1",
        arrayOf(setId, relPath),
    ).use { it.moveToFirst() }

    /**
     * 判一张照片在**这个卷上**属于哪一类。**只读，不写任何东西。**
     *
     * `setId` 为空串时表示"还没认出备份集"，一律判 NEW（扫描页在没插盘时也要能看）。
     */
    fun classify(item: PhotoItem, setId: String): ScanResult = ScanResult(
        item = item,
        verdict = when {
            setId.isEmpty() -> ScanVerdict.NEW
            hasFastKey(setId, item.fastKey()) -> ScanVerdict.DUPLICATE
            hasRelPath(setId, item.relativePath) -> ScanVerdict.CONFLICT
            else -> ScanVerdict.NEW
        },
    )

    /**
     * 把这个备份集**全部**的快筛键一次性捞进内存。
     *
     * ⛔ **图库角标绝不许逐张调 `classify()`** —— 7370 张 = 7370 次 rawQuery，滚动必卡。
     * 一次性捞：7370 行 × 几十字节 ≈ 几百 KB，随便放得下。
     * （UI 合同 §3.4）
     */
    fun fastKeysOf(setId: String): Set<FastKey> {
        if (setId.isEmpty()) return emptySet()
        val out = HashSet<FastKey>()
        readableDatabase.rawQuery(
            "SELECT rel_path, size_bytes, modified_sec FROM ${CatalogSchema.T_ENTRY} WHERE set_id=?",
            arrayOf(setId),
        ).use { c ->
            while (c.moveToNext()) {
                out += FastKey(c.getString(0), c.getLong(1), c.getLong(2))
            }
        }
        return out
    }

    /**
     * 登记一条「已经落到 U 盘上」的记录。
     *
     * ⚠️ M2 阶段没有真拷贝，这个方法只被「模拟登记」按钮调用，用来验证判重逻辑。
     * M3 拷贝引擎接进来之后，**只有 rename 成功之后**才允许调它 ——
     * 提前登记会造出「catalog 说备份了、U 盘上其实没有」的假记录。
     */
    fun record(
        sessionId: Long,
        setId: String,
        item: PhotoItem,
        storedName: String,
        hash: String? = null,
        /** true = 盘上已经有了，这条只是补登记 ⇒ 日志明细里要置灰（Nous 2026-08-25）。 */
        skipped: Boolean = false,
    ) {
        writableDatabase.insertWithOnConflict(
            CatalogSchema.T_ENTRY, null,
            ContentValues().apply {
                put("session_id", sessionId)
                put("set_id", setId)
                put("skipped", if (skipped) 1 else 0)
                put("is_video", if (item.isVideo) 1 else 0)
                put("rel_path", item.relativePath)
                put("stored_name", storedName)
                put("size_bytes", item.sizeBytes)
                put("modified_sec", item.modifiedEpochSec)
                put("content_hash", hash)
                put("copied_at", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_IGNORE,
        )
    }

    /**
     * 把陌生盘快照里的条目**批量导进本机**（见 [ForeignImport]）。
     *
     * ⚠️ **必须包在一个事务里**：7000 条逐条 insert 会各自开一次事务，
     * 慢几十倍（SQLite 的老坑）。
     * ⚠️ `CONFLICT_IGNORE`：本机已有的条目原样保留，⛔ 不覆盖。
     * ⚠️ `skipped = 1` —— 这些不是这次拷的，是"盘上本来就有"，日志里要置灰。
     */
    fun importEntries(sessionId: Long, setId: String, rows: List<ImportRow>) {
        val d = writableDatabase
        d.beginTransaction()
        try {
            val now = System.currentTimeMillis()
            rows.forEach { r ->
                d.insertWithOnConflict(
                    CatalogSchema.T_ENTRY, null,
                    ContentValues().apply {
                        put("session_id", sessionId)
                        put("set_id", setId)
                        put("skipped", 1)
                        // ⚠️ 快照里没有可靠的 is_video ⇒ 按扩展名判，⛔ 别瞎填 0
                        put("is_video", if (isVideoName(r.storedName)) 1 else 0)
                        put("rel_path", r.relPath)
                        put("stored_name", r.storedName)
                        put("size_bytes", r.sizeBytes)
                        put("modified_sec", r.modifiedSec)
                        put("copied_at", now)
                    },
                    SQLiteDatabase.CONFLICT_IGNORE,
                )
            }
            d.setTransactionSuccessful()
        } finally {
            d.endTransaction()
        }
    }

    /** 导入会话的收尾：⚠️ 拷 0、跳过 N —— 如实说"这些是认回来的，不是拷的"。 */
    fun finishImportSession(sessionId: Long, imported: Int) {
        writableDatabase.update(
            CatalogSchema.T_SESSION, null.let {
                ContentValues().apply {
                    put("finished_at", System.currentTimeMillis())
                    put("copied", 0)
                    put("skipped", imported)
                    put("failed", 0)
                    put("bytes_written", 0L)
                }
            },
            "id=?", arrayOf(sessionId.toString()),
        )
    }

    private fun isVideoName(name: String): Boolean =
        name.substringAfterLast('.', "").lowercase() in AllFilesSource.VIDEO_EXT

    fun startSession(
        deviceLabel: String,
        setId: String,
        volumeId: String,
        volumeLabel: String,
    ): Long =
        writableDatabase.insert(
            CatalogSchema.T_SESSION, null,
            ContentValues().apply {
                put("started_at", System.currentTimeMillis())
                put("device_label", deviceLabel)
                put("set_id", setId)
                put("volume_id", volumeId)
                put("volume_label", volumeLabel)
            },
        )

    /** 收尾一次会话：把统计写回去。Windows 端的「备份历史」读的就是这张表。 */
    /**
     * 收尾一次会话。
     *
     * ⚠️⚠️ `completed = false` 用在**被取消**的时候：统计要照写（否则日志页会把
     * "拷了 34 个"显示成"拷 0"，那是说假话），但 **`finished_at` 留空** ——
     * 它是"这次没跑完"的唯一判据，界面靠它给出「继续」入口。
     * （2026-08-25 Nous 真机踩到：中断之后卡面回到全新状态，看起来就是"断点续传没了"。）
     */
    fun finishSession(
        sessionId: Long,
        outcomes: List<com.nous.sylloge.BackupOutcome>,
        completed: Boolean = true,
    ) {
        writableDatabase.update(
            CatalogSchema.T_SESSION,
            ContentValues().apply {
                if (completed) put("finished_at", System.currentTimeMillis())
                put("copied", outcomes.count { it is com.nous.sylloge.BackupOutcome.Copied ||
                        it is com.nous.sylloge.BackupOutcome.Renamed })
                put("skipped", outcomes.count { it is com.nous.sylloge.BackupOutcome.SkippedDuplicate })
                put("failed", outcomes.count { it is com.nous.sylloge.BackupOutcome.Failed })
                put("bytes_written", outcomes.filterIsInstance<com.nous.sylloge.BackupOutcome.Copied>()
                    .sumOf { it.bytesWritten })
            },
            "id=?", arrayOf(sessionId.toString()),
        )
    }

    /**
     * 这个名字是不是一条**正经登记过**的备份？
     * 清理残片时用它做判据：只有 rename 成功才会登记，所以**残片永远不在 catalog 里**。
     * 比"名字里带 .part 就删"安全得多 —— 后者会误删用户真有的 `x.part.jpg`。
     */
    fun hasStoredName(setId: String, name: String): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM " + CatalogSchema.T_ENTRY + " WHERE set_id=? AND stored_name=? LIMIT 1",
        arrayOf(setId, name),
    ).use { it.moveToFirst() }

    /** @param setId 空串 = 统计全部卷 */
    // ── 文件夹勾选 ────────────────────────────────────────────────
    // ⚠️ 这张表描述的是**源**（手机上哪些文件夹要备份），不按卷分 ——
    //    换一块 U 盘不该让用户重新勾一遍。

    /** 读所有已记录的勾选。没记录过的文件夹不在里面，由调用方套用默认规则。 */
    fun folderPrefs(): Map<String, Boolean> = readableDatabase
        .rawQuery("SELECT path, enabled FROM ${CatalogSchema.T_FOLDER}", null)
        .use { c ->
            HashMap<String, Boolean>().apply {
                while (c.moveToNext()) put(c.getString(0), c.getInt(1) != 0)
            }
        }

    fun setFolderPref(path: String, enabled: Boolean) {
        writableDatabase.insertWithOnConflict(
            CatalogSchema.T_FOLDER, null,
            ContentValues().apply {
                put("path", path)
                put("enabled", if (enabled) 1 else 0)
                put("seen_at", System.currentTimeMillis())
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
    }

    fun setFolderPrefs(prefs: Map<String, Boolean>) {
        writableDatabase.beginTransaction()
        try {
            prefs.forEach { (p, e) -> setFolderPref(p, e) }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
    }

    /** 本机认识的所有备份集 ID —— 用来判断插上的盘是"熟盘"还是"陌生盘"。 */
    fun knownSetIds(): Set<String> {
        val out = HashSet<String>()
        readableDatabase.rawQuery(
            "SELECT DISTINCT set_id FROM ${CatalogSchema.T_ENTRY}", null,
        ).use { c -> while (c.moveToNext()) out += c.getString(0) }
        return out
    }

    /** 这个备份集本机记了多少条 —— 写进盘上的标识文件，也给准备阶段报数。 */
    fun entryCount(setId: String): Int {
        if (setId.isEmpty()) return 0
        return readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM ${CatalogSchema.T_ENTRY} WHERE set_id=?",
            arrayOf(setId),
        ).use { c -> if (c.moveToNext()) c.getInt(0) else 0 }
    }

    /**
     * 登记一条**失败**。⛔⛔ 绝不写进 `entry` —— 那是判重依据，
     * 把没落盘的文件写进去 = 以后永远跳过它（用户永久丢那张）。
     */
    fun recordFailure(
        sessionId: Long, setId: String, relPath: String,
        reason: String, technical: String,
    ) {
        writableDatabase.insert(
            CatalogSchema.T_FAIL, null,
            ContentValues().apply {
                put("session_id", sessionId)
                put("set_id", setId)
                put("rel_path", relPath)
                put("reason", reason)
                put("technical", technical)
                put("at", System.currentTimeMillis())
            },
        )
    }

    /** 最后一次**跑完**的备份写到的盘的卷名（说明页 Saved location 用）。 */
    fun lastTargetLabel(): String? = readableDatabase.rawQuery(
        "SELECT volume_label FROM ${CatalogSchema.T_SESSION} " +
            "WHERE finished_at IS NOT NULL AND volume_label IS NOT NULL " +
            "ORDER BY id DESC LIMIT 1", null,
    ).use { c -> if (c.moveToFirst()) c.getString(0) else null }

    /** 某次会话失败了哪些。 */
    fun failuresOf(sessionId: Long, limit: Int): List<FailRow> {
        val out = ArrayList<FailRow>(16)
        readableDatabase.rawQuery(
            "SELECT rel_path, reason, at, technical FROM ${CatalogSchema.T_FAIL} " +
                "WHERE session_id=? ORDER BY at DESC LIMIT ?",
            arrayOf(sessionId.toString(), limit.toString()),
        ).use { c -> while (c.moveToNext()) out += FailRow(c.getString(0), c.getString(1), c.getLong(2), c.getString(3) ?: "") }
        return out
    }

    /**
     * **还没解决**的失败：失败过、而且到现在也没在 entry 里（= 盘上仍然没有）。
     * ⇒ 🔴 角标的来源。⚠️ 后来补上了的就不该再报红。
     */
    fun unresolvedFailures(setId: String): Set<String> {
        if (setId.isEmpty()) return emptySet()
        val out = HashSet<String>()
        readableDatabase.rawQuery(
            "SELECT DISTINCT f.rel_path FROM ${CatalogSchema.T_FAIL} f " +
                "WHERE f.set_id=? AND NOT EXISTS (SELECT 1 FROM ${CatalogSchema.T_ENTRY} e " +
                "WHERE e.set_id=f.set_id AND e.rel_path=f.rel_path)",
            arrayOf(setId),
        ).use { c -> while (c.moveToNext()) out += c.getString(0) }
        return out
    }

    /**
     * 历次备份会话，新的在前 —— 上卡「日志」页读它（M7 的 UI 落点）。
     * ⚠️ 2026-08-25 收拢时删过一版同类查询，这次是照 roadmap M7 的记录重写的。
     */
    /**
     * 这个备份集**上一次没跑完**的会话（`finished_at` 为空），以及它当时登记了多少条。
     * 返回 null = 上一次是正常跑完的。
     *
     * ★ 判据取自**库**，⛔ 不取自 WorkManager 的 progress ——
     * 那份数据在任务被取消后会被清空（2026-08-25 抓到：所以「继续」入口从来没出现过），
     * 而且进程被杀就没了。库不会。
     */
    fun lastUnfinishedSession(setId: String): Pair<Long, Int>? =
        readableDatabase.rawQuery(
            // ⚠️⚠️ 取的是「**最近那一次**」，再看它跑完没有 ——
            //    ⛔ **不是**「存不存在未完成的会话」。历史上留下 16 条中断记录很正常
            //    （测试、被系统杀、用户暂停），但只要**最后一次是跑完的**，
            //    就没有什么可续的了。原来的写法会一直喊「上次没做完」
            //    （2026-08-26 抓到；当时因为待拷为 0 才没暴露）。
            "SELECT id, finished_at FROM ${CatalogSchema.T_SESSION} WHERE set_id=? " +
                "ORDER BY id DESC LIMIT 1",
            arrayOf(setId),
        ).use { c ->
            if (!c.moveToNext() || !c.isNull(1)) null else {
                val id = c.getLong(0)
                val n = readableDatabase.rawQuery(
                    "SELECT COUNT(*) FROM ${CatalogSchema.T_ENTRY} WHERE session_id=?",
                    arrayOf(id.toString()),
                ).use { c2 -> if (c2.moveToNext()) c2.getInt(0) else 0 }
                id to n
            }
        }

    fun sessions(limit: Int): List<SessionRow> {
        val out = ArrayList<SessionRow>(limit.coerceIn(0, 512).coerceAtLeast(16))
        readableDatabase.rawQuery(
            "SELECT id, started_at, finished_at, volume_label, copied, skipped, failed, bytes_written " +
                "FROM ${CatalogSchema.T_SESSION} ORDER BY started_at DESC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0)
                // ⚠️ 拷贝的可以按 is_video 推导；**跳过的推不出来**
                //    （快筛跳过的那些根本不写 entry）⇒ 跳过只报总数，⛔ 不编一个假的拆分
                var cp = 0; var cv = 0
                readableDatabase.rawQuery(
                    "SELECT is_video, COUNT(*) FROM ${CatalogSchema.T_ENTRY} " +
                        "WHERE session_id=? AND skipped=0 GROUP BY is_video",
                    arrayOf(id.toString()),
                ).use { d ->
                    while (d.moveToNext()) {
                        if (d.getInt(0) == 1) cv = d.getInt(1) else cp = d.getInt(1)
                    }
                }
                // ⭐⭐ **没跑完的那一条，统计要从 entry 表数出来。**
                //
                // 汇总字段是收尾时一次性写的，而中止有两条路**都可能跑不到收尾**：
                // 进程被系统杀掉（catch/finally 根本不执行）、以及协程被取消的某些时序。
                // 2026-08-25 实测：一次中止的会话登记了 3 条 entry，汇总却是「拷 0」
                // —— 日志页就会说假话（Nous 抓过同类问题：「会话写拷 0、展开却列出一堆文件」）。
                //
                // ⇒ ⭐ **不去修"收尾一定要跑到"（那是修不硬的），改成从 durable 的数据推。**
                //   entry 是每拷完一个就落盘的，进程怎么死它都在。
                // ⚠️ 跳过的仍然推不出来（快筛跳过的不写 entry）⇒ 只能沿用汇总值。
                val unfinished = c.isNull(2)
                val bytesFromEntries = if (!unfinished) 0L else readableDatabase.rawQuery(
                    "SELECT COALESCE(SUM(size_bytes),0) FROM ${CatalogSchema.T_ENTRY} " +
                        "WHERE session_id=? AND skipped=0",
                    arrayOf(id.toString()),
                ).use { d -> if (d.moveToNext()) d.getLong(0) else 0L }
                out += SessionRow(
                    id = id,
                    copiedPhotos = cp,
                    copiedVideos = cv,
                    startedAtMs = c.getLong(1),
                    finishedAtMs = if (unfinished) null else c.getLong(2),
                    target = c.getString(3) ?: "",
                    copied = if (unfinished) cp + cv else c.getInt(4),
                    skipped = c.getInt(5),
                    failed = c.getInt(6),
                    bytes = if (unfinished) bytesFromEntries else c.getLong(7),
                )
            }
        }
        return out
    }

    /**
     * 某次会话**真正落盘**的条目。
     * ⚠️ **失败的不在这里** —— 只有 rename 成功才登记（这正是残片判据的基础）。
     * ⇒ 明细里给不出"哪张失败、为什么"，⛔ 别在界面上假装能给（M7 要补失败登记）。
     */
    fun entriesOf(sessionId: Long, limit: Int): List<EntryRow> {
        val out = ArrayList<EntryRow>(limit.coerceIn(0, 4096).coerceAtLeast(16))
        readableDatabase.rawQuery(
            "SELECT rel_path, stored_name, size_bytes, copied_at, skipped, is_video FROM ${CatalogSchema.T_ENTRY} " +
                "WHERE session_id=? ORDER BY copied_at DESC LIMIT ?",
            arrayOf(sessionId.toString(), limit.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out += EntryRow(c.getString(0), c.getString(1), c.getLong(2), c.getLong(3), c.getInt(4) == 1, c.getInt(5) == 1)
            }
        }
        return out
    }

    /**
     * 整个备份集**盘上现有的全部条目**，给 `manifest.csv` 用。
     * ⚠️ 和 [entriesOf] 不同：那个是"某一次会话"，这个是"这块盘上到底有什么"。
     * ⛔ 不加 LIMIT —— 清单少一行就等于说谎；几万行也就几 MB。
     */
    fun allEntries(setId: String): List<EntryRow> {
        val out = ArrayList<EntryRow>(1024)
        readableDatabase.rawQuery(
            "SELECT rel_path, stored_name, size_bytes, copied_at, skipped, is_video FROM ${CatalogSchema.T_ENTRY} " +
                "WHERE set_id=? ORDER BY rel_path",
            arrayOf(setId),
        ).use { c ->
            while (c.moveToNext()) {
                out += EntryRow(c.getString(0), c.getString(1), c.getLong(2), c.getLong(3), c.getInt(4) == 1, c.getInt(5) == 1)
            }
        }
        return out
    }

    companion object {
        const val DB_NAME = "catalog.db"
    }
}

/** 一次备份会话（给日志页）。 */
data class SessionRow(
    val id: Long,
    /** 拷贝的按类型拆开（从 entry 推导）。⚠️ **跳过的推不出来**，只有总数。 */
    val copiedPhotos: Int,
    val copiedVideos: Int,
    val startedAtMs: Long,
    val finishedAtMs: Long?,
    val target: String,
    val copied: Int,
    val skipped: Int,
    val failed: Int,
    val bytes: Long,
)

/** 一条失败记录。 */
data class FailRow(val relPath: String, val reason: String, val atMs: Long, val technical: String)

/** 会话里的一条落盘记录。 */
data class EntryRow(
    val relPath: String,
    val storedName: String,
    val sizeBytes: Long,
    val copiedAtMs: Long,
    /** true = 这条不是这次拷的，是"盘上已经有了"补登记的。 */
    val skipped: Boolean,
    val isVideo: Boolean,
)
