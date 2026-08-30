package com.nous.sylloge.dev

import android.content.Context
import android.system.ErrnoException
import android.system.OsConstants
import android.util.Log
import com.nous.sylloge.android.Access
import com.nous.sylloge.android.Failures
import java.io.FileNotFoundException
import java.io.IOException

/**
 * **失败文案的实机对拍**（M9）。
 *
 * 为什么要有它：翻译层是纯逻辑，但它要**真的解析出资源**才算成立 ——
 * 缺一条 string、映射错一格、占位符对不上，全都要到「用户真的失败了」那一刻才显形，
 * 而失败本身在桌上摆不出来（U 盘满、盘只读、拷到一半拔盘…）。
 * ⇒ 用合成异常把每一格走一遍，看**真实设备上真实语言**下吐出来的那句话。
 *
 * ⚠️ 这只验「异常 → 哪句文案」，⛔ **不验「真实故障会抛哪个异常」** ——
 * 后者要真把盘塞满 / 真拔盘才知道，那一格照实标未验。
 *
 *   adb shell am start -n com.nous.sylloge/com.nous.sylloge.dev.DevActivity --ez err_copy true
 */
fun errorCopyProbe(ctx: Context) {
    fun errno(fn: String, e: Int) = ErrnoException(fn, e)
    // SAF 常把 ErrnoException **压成普通 IOException**，只把文本带过来 —— 第二遍匹配走这条
    fun wrapped(fn: String, e: Int) = IOException("Failed to write", errno(fn, e))
    fun flattened(text: String) = IOException(text)

    val cases: List<Pair<String, Any>> = listOf(
        "盘状态·可用" to Access.Ok("NOUS sync"),
        "盘状态·只读" to Access.ReadOnly("NOUS sync"),
        "盘状态·没插" to Access.NotMounted("NOUS sync"),
        "盘满(直接)" to errno("write", OsConstants.ENOSPC),
        "盘满(包一层)" to wrapped("write", OsConstants.ENOSPC),
        "盘满(只剩文本)" to flattened("write failed: ENOSPC (No space left on device)"),
        "只读盘" to errno("open", OsConstants.EROFS),
        "没写权限" to errno("open", OsConstants.EACCES),
        "盘断开" to errno("write", OsConstants.ENODEV),
        "读写出错" to errno("read", OsConstants.EIO),
        "源文件没了" to FileNotFoundException("/storage/emulated/0/DCIM/IMG_1.jpg"),
        "授权被收回" to SecurityException("Permission Denial"),
        "判不出来(应原样给)" to IllegalStateException("同名文件太多，放弃: IMG_1.jpg"),
    )

    Log.i("SyllogeErrCopy", "── 失败文案对拍（当前语言 " +
        ctx.resources.configuration.locales[0].toLanguageTag() + "）──")
    cases.forEach { (name, x) ->
        val out = when (x) {
            is Access -> Failures.text(ctx, x)
            is Throwable -> Failures.text(ctx, x)
            else -> "?"
        }
        Log.i("SyllogeErrCopy", name + " ⇒ " + out)
    }
    // SAF 建不出东西 —— 这条自己抛，所以单独接一下
    Log.i("SyllogeErrCopy", "建不出来 ⇒ " + (runCatching { Failures.cannotCreate("_backup") }
        .exceptionOrNull()?.let { Failures.text(ctx, it) } ?: "?"))
    // 4 GB 那条要带上文件大小才触发
    Log.i("SyllogeErrCopy", "超 4GB ⇒ " +
        Failures.text(ctx, IOException("write failed"), 5L * 1024 * 1024 * 1024))
    Log.i("SyllogeErrCopy", "── 对拍完 ──")
}
