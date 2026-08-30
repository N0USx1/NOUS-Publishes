package com.nous.sylloge

/**
 * U 盘上那两份**人类可读**的产物，纯逻辑部分（M7）。
 *
 * ★★ **盘上的文字一律英文**（Nous 2026-08-26 定）。理由不是"英文更好"，是**分工**：
 * 盘是**数据**，会被插到任何一台电脑、任何一种语言的系统上；
 * **会说话的那一端是 app** —— 它按手机语言渲染。
 * ⇒ 盘上写死中文 = 把"写它时那台手机的语言"腌进数据里，
 *   同一块盘换台手机再备份就成了混合语言。
 * ⛔ 这里不许出现任何需要翻译的句子；要给用户看的人话，去 `res/values-xx/strings.xml`。
 *
 * ★ 为什么抽出来：写盘那一步要 SAF + 真 U 盘，**没插盘就验不了**；
 * 而最容易写错的恰恰是这里——CSV 转义、BOM、分隔符、排版。
 * ⇒ 把"生成什么内容"和"写到哪去"切开，前者纯函数、能单元测试，
 * 后者只剩几行管道（`BackupSetStore`）。
 *
 * ⚠️ 这个文件由脚本生成过，**工具层会吃掉反斜杠** ⇒ 全程用 `Char(n)` 构造，
 * ⛔ 不写 转义字符。
 */

/** manifest.csv 的一行。 */
data class ManifestRow(
    val relPath: String,
    val storedName: String,
    val isVideo: Boolean,
    val bytes: Long,
    val copiedAt: String,
)

/**
 * `_backup/manifest.csv` —— 这块盘上**现在有什么**（快照，每次整份重写）。
 *
 * ⚠️ 三个"Excel 直接打开"的硬细节，缺一个就难看：
 * 1. **UTF-8 BOM**：没有它 Excel 按系统代码页读，中文和意大利文重音字符全乱码；
 * 2. **`sep=,` 首行**：Excel 用的是**系统区域设置里的列表分隔符**，
 *    意大利 / 法国 / 西班牙区域默认是**分号** ⇒ 逗号 CSV 会全挤进一列。
 *    这一行是 Excel 与 LibreOffice 都认的指令，写上就与区域无关。★ Nous 人在意大利；
 * 3. **CRLF + 引号转义**（RFC 4180）：文件名里真的会出现逗号和引号。
 */
object ManifestCsv {

    val BOM: ByteArray = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

    private const val Q = '"'
    private val CRLF = "" + Char(13) + Char(10)

    /** 一格：含逗号 / 引号 / 换行就整格加引号，内部引号翻倍。 */
    fun cell(v: String): String =
        if (v.any { it == ',' || it == Q || it.code == 10 || it.code == 13 })
            Q + v.replace(Q.toString(), "" + Q + Q) + Q
        else v

    /** 整份 CSV 的字节（含 BOM），直接写进文件即可。 */
    fun render(rows: List<ManifestRow>): ByteArray {
        val sb = StringBuilder()
        sb.append("sep=,").append(CRLF)
        sb.append("relative path,name on drive,type,size (bytes),backed up at").append(CRLF)
        rows.forEach { r ->
            sb.append(cell(r.relPath)).append(',')
                .append(cell(r.storedName)).append(',')
                .append(if (r.isVideo) "video" else "photo").append(',')
                .append(r.bytes).append(',')
                .append(cell(r.copiedAt)).append(CRLF)
        }
        return BOM + sb.toString().toByteArray(Charsets.UTF_8)
    }
}

/** 流水里的一件事。⛔ 跳过的不进这里（见 [SessionLog.render] 的说明）。 */
data class LogLine(val kind: String, val path: String, val note: String)

/** 一次会话的统计，写在流水的收尾行。 */
data class SessionTally(
    val copied: Int,
    val renamed: Int,
    val skipped: Int,
    val failed: Int,
    val bytes: Long,
)

/**
 * `_backup/log/YYYY-MM-DD.log` —— **这次发生了什么**（流水，追加到当天那份）。
 *
 * ⚠️ **跳过的只写汇总数字，⛔ 不逐条列**：没插新照片时一次会跳过几千条，
 * 逐条列会把真正发生的三五件事彻底淹掉。要完整清单去看 `manifest.csv`。
 * —— 两份东西的分工：**流水答"发生了什么"，清单答"现在有什么"**，⛔ 别混成一个。
 */
object SessionLog {

    private val NL = Char(10)

    fun render(
        startClock: String,
        endClock: String,
        target: String,
        lines: List<LogLine>,
        tally: SessionTally,
        seconds: Long,
        humanBytes: String,
    ): String {
        val sb = StringBuilder()
        sb.append("════════════════════════════════════════════════").append(NL)
        sb.append(startClock).append("  backup started  ").append(target).append(NL)
        lines.forEach { l ->
            sb.append("  ").append(l.kind).append("  ").append(l.path)
            if (l.note.isNotEmpty()) sb.append("  ").append(l.note)
            sb.append(NL)
        }
        sb.append(endClock).append("  finished  ")
            .append("copied ").append(tally.copied)
            .append(" · renamed ").append(tally.renamed)
            .append(" · skipped ").append(tally.skipped).append(" (already on the drive, not listed)")
            .append(" · failed ").append(tally.failed)
            .append(" · ").append(humanBytes)
            .append(" · took ").append(seconds).append(" s")
            .append(NL).append(NL)
        return sb.toString()
    }
}
