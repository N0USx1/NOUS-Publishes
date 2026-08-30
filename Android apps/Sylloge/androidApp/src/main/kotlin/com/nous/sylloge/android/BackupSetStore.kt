package com.nous.sylloge.android

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import com.nous.sylloge.BackupSetMarker
import com.nous.sylloge.Layout
import com.nous.sylloge.ManifestCsv
import com.nous.sylloge.ManifestRow
import com.nous.sylloge.SetIdentity
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * 盘上那两个让备份**自描述**的文件：
 *
 * ```
 * <备份根>/_backup/sylloge.json   身份 + 人话说明   ← 双层验证的第二层
 * <备份根>/_backup/catalog.db     索引快照         ← 换手机 / 重装 / 拷到新盘时导入
 * ```
 *
 * ⚠️ **工作库始终在手机内部存储**，这里只做导出/导入。
 * SQLite 需要真实文件路径（还要建 -journal/-wal 兄弟文件），SAF 只给 content:// URI；
 * 就算绕过去，**写事务到一半拔盘 = 数据库损坏**。
 */
object BackupSetStore {

    /** 认一块盘：它是我们认识的备份集、别人的备份集、还是全新的盘。 */
    fun identify(ctx: Context, treeUri: Uri, knownSetIds: Set<String>): SetIdentity {
        val meta = metaDir(ctx, treeUri, create = false) ?: return SetIdentity.Fresh
        val f = meta.findFile(BackupSetMarker.FILE_NAME) ?: return SetIdentity.Fresh
        return try {
            val txt = ctx.contentResolver.openInputStream(f.uri)!!
                .use { it.readBytes().toString(Charsets.UTF_8) }
            val o = JSONObject(txt)
            val fmt = o.optInt("format", 0)
            if (fmt > BackupSetMarker.FORMAT) {
                return SetIdentity.Unreadable("标识文件版本 " + fmt + " 比本 app 认识的新")
            }
            val m = BackupSetMarker(
                setId = o.getString("setId"),
                format = fmt,
                device = o.optString("device"),
                createdAtMs = o.optLong("createdAtMs"),
                lastBackupAtMs = o.optLong("lastBackupAtMs"),
                entryCount = o.optInt("entryCount"),
            )
            if (m.setId in knownSetIds) SetIdentity.Known(m) else SetIdentity.Foreign(m)
        } catch (e: Exception) {
            Trace.w("标识文件读不懂", e)
            SetIdentity.Unreadable(e.message ?: "解析失败")
        }
    }

    /** 写/更新标识文件。⚠️ 每次备份收尾都要写一次，好让 entryCount 和时间是新的。 */
    fun writeMarker(ctx: Context, treeUri: Uri, m: BackupSetMarker): Boolean = runCatching {
        val meta = metaDir(ctx, treeUri, create = true) ?: Failures.cannotCreate(Layout.META_DIR)
        // 已存在就先删再建 —— SAF 的 createFile 遇到同名会自己加后缀，覆盖不了
        meta.findFile(BackupSetMarker.FILE_NAME)?.delete()
        val f = meta.createFile("application/json", BackupSetMarker.FILE_NAME)
            ?: Failures.cannotCreate(BackupSetMarker.FILE_NAME)
        val json = JSONObject().apply {
            put("_readme", BackupSetMarker.HUMAN_NOTE)   // ⛔ 人话说明放第一位，别删
            put("app", "Sylloge")
            put("format", m.format)
            put("setId", m.setId)
            put("device", m.device)
            put("createdAtMs", m.createdAtMs)
            put("lastBackupAtMs", m.lastBackupAtMs)
            put("entryCount", m.entryCount)
        }.toString(2)
        ctx.contentResolver.openOutputStream(f.uri)!!.use { it.write(json.toByteArray()) }
        Trace.i("写入标识文件: setId=" + m.setId + " entries=" + m.entryCount)
        true
    }.getOrElse { Trace.e("写标识文件失败", it); false }

    /** 把手机上的工作库导出一份快照到盘上。 */
    fun exportCatalog(ctx: Context, treeUri: Uri, dbFile: File): Boolean = runCatching {
        val meta = metaDir(ctx, treeUri, create = true) ?: Failures.cannotCreate(Layout.META_DIR)
        meta.findFile(Layout.CATALOG)?.delete()
        val f = meta.createFile("application/octet-stream", Layout.CATALOG)
            ?: Failures.cannotCreate(Layout.CATALOG)
        dbFile.inputStream().use { ins ->
            ctx.contentResolver.openOutputStream(f.uri)!!.use { ins.copyTo(it) }
        }
        Trace.i("导出 catalog 快照: " + dbFile.length() + " 字节")
        true
    }.getOrElse { Trace.e("导出 catalog 失败", it); false }

    /**
     * 盘上那份 catalog 快照的句柄（没有就返回 null）。
     * ★ 给 [ForeignImport] 用 —— ⚠️ 路径必须走同一个 [metaDir]，⛔ 别在那边另拼一次。
     */
    fun snapshotFile(ctx: Context, treeUri: Uri): DocumentFile? =
        metaDir(ctx, treeUri, create = false)?.findFile(Layout.CATALOG)

    fun newSetId(): String = UUID.randomUUID().toString()

    private fun metaDir(ctx: Context, treeUri: Uri, create: Boolean): DocumentFile? {
        val tree = DocumentFile.fromTreeUri(ctx, treeUri) ?: return null
        val rootName = Layout.rootDirName(android.os.Build.MODEL)

        var root = tree.findFile(rootName)
        if (root == null) {
            if (!create) return null
            root = tree.createDirectory(rootName) ?: return null
        }

        var meta = root.findFile(Layout.META_DIR)
        if (meta == null) {
            if (!create) return null
            meta = root.createDirectory(Layout.META_DIR)
        }
        return meta
    }

    // ══════════════════════════════════════════════════════════════════
    //  盘上的人类可读产物（M7）：日流水 + 清单
    //  ★ 目的：**这块盘离开 app 也能自证** —— 插到电脑上就看得懂发生过什么。
    // ══════════════════════════════════════════════════════════════════

    /**
     * 往 `_backup/log/YYYY-MM-DD.log` 追加一次会话的流水。
     *
     * ⚠️ **读-改-写整份，⛔ 不用 SAF 的追加模式**（`openOutputStream(uri, "wa")`）——
     * 追加模式**不是每个 DocumentsProvider 都实现**，U 盘那个尤其不保证；
     * 不支持时它不报错，只是把文件**截断重写**，一天的流水就没了。
     *
     * ⚠️ **一次会话写一次，⛔ 绝不逐文件写**：逐文件就是每拷一张重写整份 = O(n²)，
     * 而且把"拔盘损坏"的窗口从 1 次放大到几千次。
     */
    fun appendDayLog(ctx: Context, treeUri: Uri, dayKey: String, text: String): Boolean = runCatching {
        val meta = metaDir(ctx, treeUri, create = true) ?: Failures.cannotCreate(Layout.META_DIR)
        val logDir = meta.findFile(Layout.LOG_DIR) ?: meta.createDirectory(Layout.LOG_DIR)
            ?: Failures.cannotCreate(Layout.LOG_DIR)
        val name = Layout.dayLogName(dayKey)

        // ⚠️ 把当天已有的内容读出来，连同**我早期错名留下的那几份**一起接过来再删。
        //    ⛔ 不能只看新名字：那样会把今天已经写过的流水丢掉。
        fun readOf(f: DocumentFile?): String = if (f == null) "" else runCatching {
            ctx.contentResolver.openInputStream(f.uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
        }.getOrDefault("")

        val current = logDir.findFile(name)
        val legacy = Layout.legacyDayLogNames(dayKey).mapNotNull { logDir.findFile(it) }
        val prev = (legacy.map { readOf(it) } + readOf(current)).joinToString("")
        legacy.forEach { it.delete() }
        current?.delete()   // SAF 的 createFile 遇同名会加后缀，覆盖不了 ⇒ 先删

        val f = logDir.createFile("text/plain", name) ?: Failures.cannotCreate(name)
        ctx.contentResolver.openOutputStream(f.uri)!!.use {
            it.write((prev + text).toByteArray(Charsets.UTF_8))
        }
        Trace.i("写日流水: " + name + " +" + text.length + " 字")
        true
    }.getOrElse { Trace.e("写日流水失败", it); false }

    /**
     * 重写 `_backup/manifest.csv`。
     * ★ **内容由 [ManifestCsv] 生成**（纯函数，有单元测试）——
     *   ⛔ 这里绝不再拼一份 CSV：那就是"抄一份 = 造一个会腐坏的副本"，
     *   测试会验着 shared 那份，而 app 跑的是这份，两边分叉了也不报错。
     *   这里只负责**把字节写进那个文件**。
     */
    fun writeManifest(ctx: Context, treeUri: Uri, rows: List<ManifestRow>): Boolean = runCatching {
        val meta = metaDir(ctx, treeUri, create = true) ?: Failures.cannotCreate(Layout.META_DIR)
        meta.findFile(Layout.MANIFEST)?.delete()
        val f = meta.createFile("text/csv", Layout.MANIFEST) ?: Failures.cannotCreate(Layout.MANIFEST)
        ctx.contentResolver.openOutputStream(f.uri)!!.use { it.write(ManifestCsv.render(rows)) }
        Trace.i("写清单: " + rows.size + " 行")
        true
    }.getOrElse { Trace.e("写清单失败", it); false }

    /**
     * 把盘上那两份人类可读产物读回来（**只给开发验证用**）。
     * ⚠️ 走的是和写入**同一个 [metaDir]** ⇒ 路径口径同源，⛔ 不另拼一次。
     */
    fun dumpReports(ctx: Context, treeUri: Uri): String {
        val meta = metaDir(ctx, treeUri, create = false) ?: return "盘上没有 _backup 目录"
        val sb = StringBuilder()
        val logDir = meta.findFile(Layout.LOG_DIR)
        sb.append("=== log/ ===").append(Char(10))
        logDir?.listFiles()?.forEach { f ->
            sb.append("--- ").append(f.name).append(" (").append(f.length()).append(" 字节) ---").append(Char(10))
            sb.append(runCatching {
                ctx.contentResolver.openInputStream(f.uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
            }.getOrElse { "读不出来: " + it }).append(Char(10))
        } ?: sb.append("（没有 log 目录）").append(Char(10))
        val man = meta.findFile(Layout.MANIFEST)
        sb.append("=== ").append(Layout.MANIFEST).append(" ===").append(Char(10))
        if (man == null) sb.append("（没有）") else {
            val bytes = ctx.contentResolver.openInputStream(man.uri)!!.use { it.readBytes() }
            sb.append("字节数 ").append(bytes.size)
                .append(" / 前三字节 ")
                .append(bytes.take(3).joinToString(" ") { b -> (b.toInt() and 0xFF).toString(16) })
                .append(Char(10))
            sb.append(bytes.toString(Charsets.UTF_8).lineSequence().take(8).joinToString("" + Char(10)))
        }
        return sb.toString()
    }
}
