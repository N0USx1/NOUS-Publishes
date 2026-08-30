package com.nous.sylloge.android

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import androidx.documentfile.provider.DocumentFile
import com.nous.sylloge.BackupSetMarker
import java.io.File

/**
 * 陌生备份集（[com.nous.sylloge.SetIdentity.Foreign]）的接管：
 * **把盘上的 catalog 快照抽样核对之后导进本机**。
 *
 * ## 为什么需要
 * 换手机 / 重装 app / 清过数据之后，盘上明明是一份完整的 Sylloge 备份，
 * 但本机 catalog 一条记录都没有 ⇒ 判重全部落空。
 * ⚠️ 旧行为「沿用它的 setId，落空就走哈希兜底」**结果是对的，但要把两边各几十 GB
 * 全读一遍**（源文件 + 盘上文件都要算 SHA-256），几十分钟起步。
 *
 * ## 做法
 * 我们每次备份收尾都会往盘上导出 `_backup/catalog.db`（见 [BackupSetStore.exportCatalog]）。
 * ⇒ 读那份快照，**抽样**核对若干条与盘上真实文件对不对得上：
 * - 对得上 ⇒ 信任它，整份导入本机 catalog（换机/重装即刻恢复）
 * - 对不上 ⇒ 当成新盘，从零开始
 *
 * ⛔ **不哈希全盘**（那正是要避免的几十分钟）。
 * ⛔ **也不无条件信任盘上的元数据** —— 快照可能是别人拷过去的、或者盘被手动删过文件。
 * ★ 抽样是这两个极端之间唯一站得住的中间点：代价 O(抽样数)，而不是 O(全盘)。
 */
object ForeignImport {

    /**
     * 抽查几条。
     *
     * ★ 这个数是**推出来的不是拍的**：若快照里有比例 p 的条目对不上，
     * 抽 k 条全都恰好命中好条目的概率是 `(1-p)^k`。
     * p = 10% 时：k=20 → 12% 漏判；**k=32 → 3.4%**；k=64 → 0.1% 但耗时翻倍。
     * ⚠️ 每条抽查 = 一次目录树查找，32 条是"够狠又不拖慢开机"的折中。
     */
    const val SampleSize = 32

    /**
     * 抽样里允许几条对不上。
     * ⚠️ **0 容忍**：盘上少一个文件就说明这份快照和盘已经不一致了，
     * 宁可当成新盘重来（慢但正确），⛔ 不能把"其实不在盘上"的条目导进来 ——
     * 那会让用户**以为备份过、实际永远跳过**，是这个 app 最坏的失败。
     */
    const val AllowedMismatch = 0

    /** 空跑用的一次性库名。⚠️ 用完即删，⛔ 绝不碰 `catalog.db`。 */
    private const val DryRunDb = "dryrun-catalog.db"

    /** 结果。⚠️ 每一种都要能在界面上说人话，⛔ 不许只回一个 Boolean。 */
    sealed interface Result {
        /** 导入成功，本机多了 [count] 条记录。 */
        data class Imported(val count: Int) : Result
        /** 盘上没有快照（老版本写的盘，或用户手动删过）。 */
        data object NoSnapshot : Result
        /** 抽样对不上 ⇒ 不信任，当新盘处理。 */
        data class Rejected(val checked: Int, val missing: Int) : Result
        data class Failed(val reason: String) : Result
    }

    /**
     * 试着接管这块盘。
     *
     * ⚠️ 这是**只读 + 只往本机库里加**的操作：⛔ 不动盘上任何文件，
     * ⛔ 也不覆盖本机已有的条目（插入用 CONFLICT_IGNORE）。
     */
    fun tryImport(
        ctx: Context,
        treeUri: Uri,
        marker: BackupSetMarker,
        db: CatalogDb,
        /**
         * 只跑不写：拉快照、解析、抽样核对全做，**最后一步不导入**。
         * ★ 用来在**不破坏本机 catalog** 的前提下验证这条路 ——
         * 制造真实的"陌生盘"要先让本机忘掉这块盘，那会毁掉用户的记录（⛔ 不可接受）。
         */
        dryRun: Boolean = false,
    ): Result {
        val snapshot = pullSnapshot(ctx, treeUri) ?: return Result.NoSnapshot
        try {
            val rows = readRows(snapshot, marker.setId)
            if (rows.isEmpty()) return Result.NoSnapshot

            // ── 抽样核对 ────────────────────────────────────────────
            // ⚠️ 用**确定性**的抽样（等距）而不是随机：同一块盘每次判定一致，
            //    ⛔ 随机会让"这次认了、下次不认"，用户无法复现也无法信任。
            val step = (rows.size / SampleSize).coerceAtLeast(1)
            val picks = rows.indices.step(step).take(SampleSize).map { rows[it] }
            val root = DocumentFile.fromTreeUri(ctx, treeUri)
                ?.findFile(com.nous.sylloge.Layout.rootDirName(marker.device.ifEmpty { Build.MODEL }))
                ?: return Result.Rejected(picks.size, picks.size)

            // ⚠️⚠️ **按目录分组，每个目录只 `listFiles()` 一次。**
            //    第一版是每个样本从根往下逐段 `findFile`、末端再 `findFile` 一次 ——
            //    那正是 Nous 2026-08-26 刚修掉的 O(n) 陷阱，**我在新代码里当天又犯了一遍**：
            //    实测 32 个样本烧掉 2 分多钟 CPU 还没跑完。
            // ★ 教训：**这条坑不是"某个函数"的毛病，是 SAF 的普遍性质** ——
            //    凡是要按名字找文件，先 listFiles 建表，⛔ 永远不要在循环里 findFile。
            var missing = 0
            picks.groupBy { it.relPath.substringBeforeLast('/', "") }.forEach { (dir, items) ->
                val d = resolveDir(root, dir)
                if (d == null) { missing += items.size; return@forEach }
                val sizes = namesAndSizes(ctx, d)
                items.forEach { r ->
                    // ⚠️ 只比**存在 + 大小**。⛔ 不能比修改时间：
                    //    entry 里存的是**源文件（手机上那张）**的 mtime，
                    //    而盘上那份的 mtime 是拷贝发生的时间，两者本来就不同。
                    if (sizes[r.storedName] != r.sizeBytes) missing++
                }
            }
            if (missing > AllowedMismatch) {
                Trace.w("陌生盘抽样不通过：查 " + picks.size + " 条，缺 " + missing + " 条 ⇒ 当新盘处理")
                return Result.Rejected(picks.size, missing)
            }

            if (dryRun) {
                // ★ 连**批量写入**也真跑一遍，只是写进一次性的库 ——
                //   ⛔ 光验"读和抽样"等于留着最后一段没验过就交付。
                ctx.deleteDatabase(DryRunDb)
                val tmp = CatalogDb(ctx, DryRunDb)
                val sid = tmp.startSession(Build.MODEL, marker.setId, "dry", "dry")
                val t0 = System.currentTimeMillis()
                tmp.importEntries(sid, marker.setId, rows)
                tmp.finishImportSession(sid, rows.size)
                val wrote = tmp.entryCount(marker.setId)
                // 再写一遍：唯一索引 + CONFLICT_IGNORE 应当让它一条都不增加
                tmp.importEntries(sid, marker.setId, rows)
                val again = tmp.entryCount(marker.setId)
                tmp.close()
                ctx.deleteDatabase(DryRunDb)
                Trace.w(
                    "【空跑】快照 " + rows.size + " 条；抽查 " + picks.size + " 条全对；" +
                        "写入一次性库 " + wrote + " 条（用时 " + (System.currentTimeMillis() - t0) +
                        " ms）；重复写一遍后仍是 " + again + " 条"
                )
                return Result.Imported(rows.size)
            }

            // ── 导入 ───────────────────────────────────────────────
            // ★ 建一条**导入会话**，让日志页如实写出"这些是从盘上认回来的"，
            //   ⛔ 不要把它们挂在某次真实备份下面（那是说假话）。
            val sid = db.startSession(
                Build.MODEL, marker.setId,
                UsbAccess.volumeIdOf(treeUri), UsbAccess.displayName(ctx, treeUri),
            )
            db.importEntries(sid, marker.setId, rows)
            db.finishImportSession(sid, rows.size)
            Trace.w("从陌生盘导入 " + rows.size + " 条记录（抽查 " + picks.size + " 条全部对得上）")
            return Result.Imported(rows.size)
        } catch (e: Exception) {
            Trace.e("陌生盘导入失败", e)
            return Result.Failed(Trace.describe(e))
        } finally {
            snapshot.delete()
        }
    }

    /** 把盘上的快照拷到本机 cache 再打开。⚠️ SQLite 要真实路径，SAF 只给 content:// */
    private fun pullSnapshot(ctx: Context, treeUri: Uri): File? = runCatching {
        val f = BackupSetStore.snapshotFile(ctx, treeUri) ?: return null
        val dst = File(ctx.cacheDir, "foreign-catalog.db")
        ctx.contentResolver.openInputStream(f.uri)!!.use { ins ->
            dst.outputStream().use { ins.copyTo(it) }
        }
        dst
    }.getOrNull()

    /** 从快照里读出这个备份集的全部条目。⚠️ 只读打开，⛔ 不要让它跑迁移。 */
    private fun readRows(file: File, setId: String): List<ImportRow> {
        val out = ArrayList<ImportRow>(4096)
        val sdb = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
        sdb.use { d ->
            // ⚠️ 快照可能来自**更老的 schema**（没有 is_video / skipped 列）⇒ 只取一定存在的列，
            //    缺的用默认值。⛔ 别 SELECT * 然后按下标取。
            d.rawQuery(
                "SELECT rel_path, stored_name, size_bytes, modified_sec FROM entry WHERE set_id=?",
                arrayOf(setId),
            ).use { c ->
                while (c.moveToNext()) {
                    out += ImportRow(c.getString(0), c.getString(1), c.getLong(2), c.getLong(3))
                }
            }
        }
        return out
    }

    /**
     * ★★ 一个目录里的「文件名 → 大小」，**一次游标查询拿全**。
     *
     * ⚠️⚠️ **绝不能用 `DocumentFile.listFiles()` 再读 `f.name` / `f.length()`** ——
     * 那些对象是**惰性**的：**每读一个属性就是一次 ContentResolver 查询**。
     * `DCIM/Camera` 有 4391 个文件，又读名字又读大小 ⇒ **单这一个目录 ~8800 次 IPC**，
     * 实测烧掉两分多钟 CPU 还没跑完（2026-08-26）。
     * ⇒ 直接查 `DocumentsContract` 的子文档表，**带投影，一次拿全**。
     *
     * ★ 这是「SAF 的 O(n) 陷阱」的第二种形态：
     * 第一种是**在循环里 findFile**（Nous 当天刚修掉），
     * 第二种是**批量拿到对象之后逐个读属性** —— 后者更隐蔽，因为看起来只调了一次 listFiles。
     */
    private fun namesAndSizes(ctx: Context, dir: DocumentFile): Map<String, Long> {
        val out = HashMap<String, Long>()
        val childrenUri = android.provider.DocumentsContract.buildChildDocumentsUriUsingTree(
            dir.uri, android.provider.DocumentsContract.getDocumentId(dir.uri),
        )
        runCatching {
            ctx.contentResolver.query(
                childrenUri,
                arrayOf(
                    android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    android.provider.DocumentsContract.Document.COLUMN_SIZE,
                ),
                null, null, null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val n = c.getString(0) ?: continue
                    out[n] = c.getLong(1)
                }
            }
        }
        return out
    }

    /**
     * 顺着相对目录找到那个目录。
     * ⚠️ **每个目录只解析一次**（调用方按目录分组）—— ⛔ 别对每个样本都走一遍，
     * `findFile` 是 O(n)，逐样本走等于把抽样也变成平方级。
     */
    private fun resolveDir(root: DocumentFile, relDir: String): DocumentFile? {
        var cur: DocumentFile = root
        relDir.split('/').filter { it.isNotEmpty() }.forEach { seg ->
            cur = cur.findFile(seg)?.takeIf { it.isDirectory } ?: return null
        }
        return cur
    }
}

/** 快照里的一条。⚠️ 只带判重要用的那几个字段，⛔ 不整行搬（列可能对不上）。 */
data class ImportRow(
    val relPath: String,
    val storedName: String,
    val sizeBytes: Long,
    val modifiedSec: Long,
)
