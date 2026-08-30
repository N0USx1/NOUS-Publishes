package com.nous.sylloge

/** 一张待备份的照片。刻意不含任何平台类型，桌面端能直接复用。 */
data class PhotoItem(
    val id: String,
    val relativePath: String,   // 例: DCIM/Camera/IMG_0001.jpg
    val displayName: String,
    val sizeBytes: Long,
    val modifiedEpochSec: Long,
    /** true = 视频。⚠️ 界面上**照片和视频要分开报数**（Nous 2026-08-25）。 */
    val isVideo: Boolean = false,
)

/**
 * 「N 张照片 · M 个视频」。
 * ⚠️ 数量为 0 的那一半**不显示** —— ⛔ 别写"0 个视频"，那是噪音。
 * ⚠️ 两个都是 0 时给"空"，由调用方决定说什么。
 */
fun mediaCount(photos: Int, videos: Int): String = when {
    photos > 0 && videos > 0 -> photos.toString() + " 张照片 · " + videos + " 个视频"
    videos > 0 -> videos.toString() + " 个视频"
    photos > 0 -> photos.toString() + " 张照片"
    else -> ""
}

/** 一次备份中，单个文件的结局。 */
sealed interface BackupOutcome {
    val item: PhotoItem
    data class Copied(override val item: PhotoItem, val bytesWritten: Long) : BackupOutcome
    data class SkippedDuplicate(override val item: PhotoItem, val reason: String) : BackupOutcome
    data class Renamed(override val item: PhotoItem, val newName: String) : BackupOutcome
    /**
     * ★★ 失败**存的是数据，不是文案**（Nous 2026-08-26 定的架构）：
     *  · [reason] = 机器可读的原因键（`disk_full` / `read_only` / …），判不出来就是空串；
     *  · [technical] = 原始技术串（异常类名 + 我们代码里的前几帧），天然是英文。
     * ⇒ **人话在显示那一刻才拼**（`Failures.render`），所以换手机语言、
     *   或者别人拿这块盘去读，看到的都是他自己的语言。
     * ⛔ 别把拼好的句子存下来 —— 那等于把"写它时那台手机的语言"腌进数据里。
     */
    data class Failed(
        override val item: PhotoItem,
        val reason: String,
        val technical: String,
    ) : BackupOutcome
}

/** 一级快筛的判重键：不读文件内容，先用它挡掉绝大多数。 */
data class FastKey(val relativePath: String, val sizeBytes: Long, val modifiedEpochSec: Long)

fun PhotoItem.fastKey() = FastKey(relativePath, sizeBytes, modifiedEpochSec)

/** 备份根目录下的固定布局，Windows 端按同样的常量去读。 */
object Layout {
    /**
     * U 盘根目录下的备份文件夹前缀。
     * 刻意**平铺**（`sync-lloge [设备名]`）而不是 `sync-lloge/设备名/` ——
     * 里面已经全是 DCIM / Pictures 这类子目录了，不该再叠一层。
     */
    const val ROOT_PREFIX = "sync-lloge"
    const val META_DIR = "_backup"
    const val LOG_DIR = "log"

    /**
     * 当天流水的文件名。
     *
     * ⚠️⚠️ **必须是 `.txt`，⛔ 不能是 `.log`。** 2026-08-25 真盘实测：
     * 用 `2026-08-25.log` + MIME `text/plain` 建文件，SAF 的 DocumentsProvider
     * 会**按 MIME 补后缀**，落盘变成 `2026-08-25.log.txt` ⇒ 下次
     * `findFile("2026-08-25.log")` 永远找不到它 ⇒ **追加彻底失效，每次备份新建一份**。
     * 和 [PART_PREFIX] 是同一条教训：**扩展名和 MIME 对上，SAF 就没有理由改名**。
     * 附带好处：`.txt` 在 Windows 上双击就能打开，`.log` 没有默认程序。
     */
    fun dayLogName(dayKey: String): String = dayKey + ".txt"

    /** 我自己踩坑期间生成过的旧名字，只用于**把内容接过来再删掉**。⛔ 不要再产生它们。 */
    fun legacyDayLogNames(dayKey: String): List<String> =
        listOf(dayKey + ".log", dayKey + ".log.txt")
    const val MANIFEST = "manifest.csv"
    const val CATALOG = "catalog.db"
    /**
     * 半成品文件的标记。
     *
     * ⚠️ **必须是前缀，不能是后缀。** 用 `xxx.jpg.part` 会被 SAF 的 DocumentsProvider
     * 按 MIME 补成 `xxx.jpg.part.jpg`（实测 2026-08-24），于是清理逻辑扫不到，
     * 残片永久堆在 U 盘上。**前缀方案保持扩展名原样，SAF 没理由改名。**
     */
    const val PART_PREFIX = "~sylloge-part~"

    /** 旧的后缀方案，只用于清理历史残留，⛔ 新代码不要再用它命名。 */
    const val PART_SUFFIX = ".part"

    /** 例：`sync-lloge [Pixel 10 Pro XL]`。设备名是用户可改的，必须先清洗。 */
    fun rootDirName(deviceLabel: String): String =
        "$ROOT_PREFIX [${sanitizeForFat(deviceLabel)}]"
}

/** FAT / exFAT 不接受的字符。用字符数组而不是字符串字面量，免得被转义规则坑。 */
private val FAT_ILLEGAL = charArrayOf('\\', '/', ':', '*', '?', '"', '<', '>', '|')

/**
 * 清洗成 FAT / exFAT 能接受的名字。
 * 末尾的点和空格会被 Windows 悄悄吃掉，一并去掉。
 * 非法字符**替换**成 `_` 而不是删除 —— 删除会让两个不同的名字撞成同一个。
 */
fun sanitizeForFat(name: String): String {
    val cleaned = name.map { c ->
        if (c.code < 0x20 || c in FAT_ILLEGAL) '_' else c
    }.joinToString("")
    return cleaned.trimEnd(' ', '.').ifBlank { "unknown" }
}
