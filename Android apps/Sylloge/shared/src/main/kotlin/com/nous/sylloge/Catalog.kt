package com.nous.sylloge

/**
 * catalog.db 的结构定义。
 *
 * 单一来源：安卓端用 SQLiteOpenHelper 建表，Windows 端用 JDBC 读同一份 DDL，
 * 两边永远不会因为「谁改了表结构忘了同步」而错开。
 */
object CatalogSchema {

    /**
     * ⚠️⚠️ **加了列就必须 bump** —— 迁移只在版本号变化时跑。
     * 2026-08-26 踩到：给 `failure` 加 `technical` 却没 bump ⇒ 列没加上，
     * 而代码已经在 `INSERT` / `SELECT` 它了 ⇒ **一旦有文件失败就报错**。
     * ★ 判据：动了 [DDL] 或 `migrate` 里的 `addColumn`，**同一次改动里就把这个数字加一**。
     *
     * v8：`failure.technical`（失败改存"原因键 + 技术串"，人话显示时才拼）
     */
    const val VERSION = 8

    /** 一次备份会话。 */
    const val T_SESSION = "session"
    /** 已经成功落到 U 盘上的文件。快筛去重就查这张表。 */
    const val T_ENTRY = "entry"
    /** 用户勾了哪些文件夹。⚠️ 全局的，不按卷 —— 它描述的是**源**（手机），不是目的地。 */
    const val T_FOLDER = "folder_pref"

    /**
     * 失败登记。⛔⛔ **绝不能并进 `entry`** —— entry 是判重的依据，
     * 把一个**没落盘**的文件写进去 = 以后永远跳过它，用户会永久丢掉那张。
     * ⇒ 单独一张表（2026-08-25 立，M7 的核心欠账）。
     */
    const val T_FAIL = "failure"

    val FAIL_DDL: String = """
        CREATE TABLE IF NOT EXISTS $T_FAIL (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            set_id     TEXT    NOT NULL,
            rel_path   TEXT    NOT NULL,
            reason     TEXT    NOT NULL,
            at         INTEGER NOT NULL
        )
    """.trimIndent()

    val DDL: List<String> = listOf(
        """
        CREATE TABLE IF NOT EXISTS $T_SESSION (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at    INTEGER NOT NULL,
            finished_at   INTEGER,
            device_label  TEXT    NOT NULL,
            set_id        TEXT    NOT NULL,
            volume_id     TEXT,
            volume_label  TEXT,
            copied        INTEGER NOT NULL DEFAULT 0,
            skipped       INTEGER NOT NULL DEFAULT 0,
            failed        INTEGER NOT NULL DEFAULT 0,
            bytes_written INTEGER NOT NULL DEFAULT 0
        )
        """.trimIndent(),
        """
        CREATE TABLE IF NOT EXISTS $T_ENTRY (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id     INTEGER NOT NULL,
            set_id         TEXT    NOT NULL,
            rel_path       TEXT    NOT NULL,
            stored_name    TEXT    NOT NULL,
            size_bytes     INTEGER NOT NULL,
            modified_sec   INTEGER NOT NULL,
            content_hash   TEXT,
            copied_at      INTEGER NOT NULL,
            -- 1 = 这条不是这次拷的，是"盘上已经有了"补登记的。
            -- ⚠️ 没有它的话，日志明细里跳过的和真拷的**长得一模一样**
            --    （会话写着"拷 0"，展开却列出一堆文件）。2026-08-25 Nous 指出。
            skipped        INTEGER NOT NULL DEFAULT 0,
            -- 1 = 视频。⚠️ 日志里要**分开报**"拷了多少张照片、多少个视频"（Nous 2026-08-25）。
            is_video       INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(session_id) REFERENCES $T_SESSION(id)
        )
        """.trimIndent(),
        // 快筛索引。⚠️ 第一列必须是 **set_id**（备份集身份），不是卷 ID：
        //  · 多个 U 盘 → 各是各的备份集，不会互相当成"已备份"
        //  · 用户在电脑上把整个文件夹拷到新盘 → 卷变了但 set_id 没变，
        //    还是同一份备份，不用把几十 GB 重新校验一遍
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_fastkey " +
            "ON $T_ENTRY(set_id, rel_path, size_bytes, modified_sec)",
        "CREATE INDEX IF NOT EXISTS idx_entry_set ON $T_ENTRY(set_id)",
        "CREATE INDEX IF NOT EXISTS idx_entry_session ON $T_ENTRY(session_id)",
        FAIL_DDL,
        "CREATE INDEX IF NOT EXISTS idx_fail_session ON $T_FAIL(session_id)",
        """
        CREATE TABLE IF NOT EXISTS $T_FOLDER (
            path     TEXT PRIMARY KEY,
            enabled  INTEGER NOT NULL,
            seen_at  INTEGER NOT NULL
        )
        """.trimIndent(),
    )

    /** manifest.csv 的表头，Windows 端和 Excel 都按这个读。 */
    const val MANIFEST_HEADER =
        "set_id,rel_path,stored_name,size_bytes,modified_sec,content_hash,copied_at,session_id"
}

/** 扫描一遍的结果：每张照片属于哪一类。 */
enum class ScanVerdict {
    /** 快筛没命中，需要备份 */
    NEW,
    /** 快筛命中（同路径+同大小+同修改时间），跳过 */
    DUPLICATE,
    /** 同路径但内容不同 —— 要另存名字，绝不覆盖 */
    CONFLICT,
}

data class ScanResult(
    val item: PhotoItem,
    val verdict: ScanVerdict,
)

/** 按文件夹汇总，UI 上「按文件夹看」直接用这个。 */
data class FolderSummary(
    val folder: String,
    val total: Int,
    val new: Int,
    val duplicate: Int,
    val conflict: Int,
    val newBytes: Long,
)

fun List<ScanResult>.summarizeByFolder(): List<FolderSummary> =
    groupBy { it.item.relativePath.substringBeforeLast('/', "(根目录)") }
        .map { (folder, rows) ->
            FolderSummary(
                folder = folder,
                total = rows.size,
                new = rows.count { it.verdict == ScanVerdict.NEW },
                duplicate = rows.count { it.verdict == ScanVerdict.DUPLICATE },
                conflict = rows.count { it.verdict == ScanVerdict.CONFLICT },
                newBytes = rows.filter { it.verdict == ScanVerdict.NEW }.sumOf { it.item.sizeBytes },
            )
        }
        .sortedByDescending { it.total }

fun Long.humanBytes(): String {
    val u = listOf("B", "KB", "MB", "GB", "TB")
    var v = this.toDouble(); var i = 0
    while (v >= 1024 && i < u.lastIndex) { v /= 1024; i++ }
    return if (i == 0) "$this ${u[0]}" else String.format("%.1f %s", v, u[i])
}
