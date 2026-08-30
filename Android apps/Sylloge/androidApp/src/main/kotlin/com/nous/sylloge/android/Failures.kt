package com.nous.sylloge.android

import android.content.Context
import android.system.ErrnoException
import android.system.OsConstants
import com.nous.sylloge.humanBytes
import java.io.FileNotFoundException

/**
 * ★★ **技术故障 → 用户能行动的一句话**，全 app 唯一的翻译点（M9，Nous 点名要的）。
 *
 * 在这之前，失败文案有**三个各自为政的出口**，其中两个直接把 Java 异常糊到卡面上：
 *   1. [BackupWorker] 的 `catch` —— `e.message ?: e.toString()`
 *   2. [BackupEngine] 的 `explainFailure` —— 只有 4 GB 那条是人话，其余是栈帧
 *   3. `Access.humanText` —— ⚠️ **写死的中文**，法语用户照样看到「只读: X（U 盘写保护？）」
 *      （它经 `error(a.humanText)` 变成异常消息，一路流到失败卡）
 * ⇒ 三处合并到这里。⛔ **别在别处再拼一次失败文案** —— 那就是"抄一份 = 造一个会腐坏的副本"。
 *
 * ## 两条设计约束
 *
 * ⚠️ **原始技术串永远附在后面**（`%1$s`）。人话是给用户看的，原始串是给诊断包看的——
 * 换成人话之后就查不出真因，等于用可读性换掉了可诊断性。⛔ 不做这笔交易。
 *
 * ⚠️ **判不出来就照实给原始串**，⛔ 不要兜底成一句好听的废话。
 * 一句猜错的人话比一句看不懂的英文更坏：它会把用户带去修一个没坏的东西。
 */
object Failures {

    private const val FourGiB = 4L * 1024 * 1024 * 1024

    /** 盘的状态 → 人话。★ 取代原来写死中文的 `Access.humanText`。 */
    fun text(ctx: Context, a: Access): String = when (a) {
        is Access.Ok -> ctx.getString(R.string.acc_ok, a.name)
        is Access.ReadOnly -> ctx.getString(R.string.acc_read_only, a.name)
        is Access.NotMounted -> ctx.getString(R.string.acc_not_mounted, a.label)
    }

    /**
     * 异常 → 人话。[sizeBytes] 给就参与 4 GB 判断（逐文件失败时才有）。
     *
     * ★ 4 GB 那条是 Nous 2026-08-25 点名的：视频动辄超过 4 GB，而 **FAT32 单文件上限就是 4 GB**。
     * ⚠️ 我们**测不出盘的文件系统**（SAF / StorageVolume 都不给 fs 类型）⇒
     *   ⛔ 不预先拦截（那会在 exFAT 盘上误报），只在**失败之后**给出这条最可能的原因。
     * ⛔ 绝不静默跳过大文件 —— 那正是"我以为备份了"的来源。
     */
    /**
     * **原因键**（机器可读，⛔ 不是文案）。判不出来返回空串。
     * ★ 存进库、写上盘的都是它 —— 文案由 [render] 在显示那一刻拼。
     */
    fun reasonKey(e: Throwable, sizeBytes: Long = -1L): String {
        if (sizeBytes >= FourGiB) return KeyTooBig
        (e as? SylError)?.let { return it.key }
        val res = reasonOf(e) ?: return ""
        return KEYS.entries.firstOrNull { it.value == res }?.key ?: ""
    }

    /**
     * 原因键 + 技术串 → **当前语言**的一句话。
     *
     * ⚠️ 三条退路，缺一不可：
     *  · 认识这个键 ⇒ 拼人话（技术串附后）；
     *  · 键是空的 ⇒ 照实给技术串（⛔ 不兜底成好听的废话）；
     *  · **键不认识** ⇒ 原样吐出来 —— 那是**旧版本存下来的整句人话**，
     *    这样老记录不用迁移也照样读得懂。
     */
    fun render(ctx: Context, reason: String, technical: String, sizeBytes: Long = -1L): String = when {
        reason == KeyTooBig ->
            ctx.getString(R.string.err_too_big, sizeBytes.coerceAtLeast(0).humanBytes(), technical)
        reason.isEmpty() -> technical
        KEYS.containsKey(reason) -> ctx.getString(KEYS.getValue(reason), technical)
        else -> reason
    }

    fun text(ctx: Context, e: Throwable, sizeBytes: Long = -1L): String {
        // ⚠️ **不能只存 `e.message`** —— message 常常是 null，那样失败记录等于什么都没记
        //    （Nous 2026-08-25：「这个是使用日志不是代码错误日志」）。
        // ⚠️ 必须走 [of]：SylError 的技术串是它的 `what`（文件名之类），
        //    ⛔ 不是整串异常描述 —— 塞错了 `%1$s` 就会把栈帧印在人话中间。
        val (key, tech) = of(e, sizeBytes)
        return render(ctx, key, tech, sizeBytes)
    }

    /** 原因键 ↔ 文案资源。★ **唯一的对照表**，⛔ 别在别处再写一份 when。 */
    const val KeyTooBig = "too_big"
    private val KEYS: Map<String, Int> = mapOf(
        "disk_full" to R.string.err_disk_full,
        "read_only" to R.string.err_read_only,
        "no_write_perm" to R.string.err_no_write_perm,
        "drive_gone" to R.string.err_drive_gone,
        "io_error" to R.string.err_io,
        "source_gone" to R.string.err_source_gone,
        "perm_revoked" to R.string.err_perm_revoked,
        "cannot_create" to R.string.err_cannot_create,
        "tree_unopenable" to R.string.err_tree_unopenable,
        "marker_bad" to R.string.err_marker_bad,
        "too_many_dupes" to R.string.err_too_many_dupes,
    )

    /**
     * SAF **建不出东西**时用这个抛。
     * ⚠️ `createFile` / `createDirectory` 失败只返回 **null**，拿不到 errno ⇒
     * ⛔ 不能假装知道原因，只能给"该去检查什么"。
     */
    fun cannotCreate(what: String): Nothing = throw SylError("cannot_create", what)

    /** 一次拿到 (原因键, 技术串) —— 存库、写盘、显示三处都从这里取。 */
    fun of(e: Throwable, sizeBytes: Long = -1L): Pair<String, String> =
        if (sizeBytes >= FourGiB) KeyTooBig to Trace.describe(e)
        else reasonKey(e, sizeBytes) to ((e as? SylError)?.what ?: Trace.describe(e))

    /** 判不出来返回 null（⇒ 照实给原始串）。 */
    private fun reasonOf(e: Throwable): Int? {
        // ── 第一遍：**按类型精确判**，⛔ 不猜字符串 ───────────────────────────
        var t: Throwable? = e
        val seen = HashSet<Throwable>()
        while (t != null && seen.add(t)) {
            when (t) {
                is ErrnoException -> errnoRes(t.errno)?.let { return it }
                is SecurityException -> return R.string.err_perm_revoked
                is FileNotFoundException -> return R.string.err_source_gone
                else -> {}
            }
            t = t.cause
        }
        // ── 第二遍：SAF 常把 ErrnoException **压成普通 IOException**，只把文本带过来 ──
        // ⚠️ 连着后面那个空格加括号一起匹配（errno 的原生格式是 `ENOSPC (No space left...)`），
        //    ⛔ 光匹配裸名字会被文件名撞上 —— 宁可判不出来退回原始串，也不要判错。
        val msg = chainText(e)
        return when {
            "ENOSPC (" in msg -> R.string.err_disk_full
            "EROFS (" in msg -> R.string.err_read_only
            "EACCES (" in msg || "EPERM (" in msg -> R.string.err_no_write_perm
            "ENOENT (" in msg || "ENODEV (" in msg -> R.string.err_drive_gone
            "EIO (" in msg -> R.string.err_io
            else -> null
        }
    }

    private fun errnoRes(errno: Int): Int? = when (errno) {
        OsConstants.ENOSPC -> R.string.err_disk_full
        OsConstants.EROFS -> R.string.err_read_only
        OsConstants.EACCES, OsConstants.EPERM -> R.string.err_no_write_perm
        OsConstants.ENOENT, OsConstants.ENODEV -> R.string.err_drive_gone
        OsConstants.EIO -> R.string.err_io
        else -> null
    }

    /** 整条 cause 链的文本拼起来 —— 真因常常埋在最里层。 */
    private fun chainText(e: Throwable): String {
        val sb = StringBuilder()
        var t: Throwable? = e
        val seen = HashSet<Throwable>()
        while (t != null && seen.add(t)) {
            sb.append(t.toString()).append(' ')
            t = t.cause
        }
        return sb.toString()
    }
}

/**
 * **我们自己判定的失败**：带一个机器可读的 [key] 和一个补充说明 [what]（文件名之类）。
 * ⛔ 绝不抛拼好的人话 —— 那句话会被写进 U 盘的日志，
 * 而盘是给**任何一台电脑、任何一种语言**读的（Nous 2026-08-26）。
 */
class SylError(val key: String, val what: String) : IllegalStateException(key + ": " + what)
