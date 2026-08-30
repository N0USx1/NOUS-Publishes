package com.nous.sylloge.android

import android.util.Log
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * 运行痕迹：**一边打 logcat，一边留在内存里**。
 *
 * ★ 为什么需要（Nous 2026-08-25 的提问：「这个导出诊断对我们 debug 能有多少用？
 * 这个是使用日志不是代码错误日志」）：
 * 我们在代码里打了一堆 `Log.i`，但那些只存在于**用户手机的 logcat** 里 ——
 * 用户拿不到、也发不过来。⇒ 自己留一份**最近 N 条**，随诊断包一起交出来，
 * 这样"出问题**之前**发生了什么"才答得上来。
 *
 * ⚠️ 只留在内存 ⇒ 进程一死就没了。所以**崩溃处理器必须在进程死之前把它落盘**
 * （见 [SyllogeApp]）—— 崩溃恰恰是最需要这段痕迹的时候。
 * ⚠️ 环形缓冲 ⇒ ⛔ 不会无限长大。
 */
object Trace {

    /** 留多少条。⚠️ 够看清"崩之前那几步"就行，⛔ 不当成完整日志。 */
    private const val Capacity = 400

    private val ring = ArrayDeque<String>(Capacity)
    private val fmt = SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT)

    @Synchronized
    private fun push(level: String, msg: String) {
        if (ring.size >= Capacity) ring.pollFirst()
        ring.addLast(fmt.format(Date(System.currentTimeMillis())) + " " + level + " " + msg)
    }

    /** 最近这些条，旧的在前。 */
    @Synchronized
    fun recent(): List<String> = ring.toList()

    // ⚠️⚠️ 这三行**必须直接调 `Log`**。批量把全项目 `Log.i(TAG,…)` 换成 `Trace.i(…)` 时，
    //   这个文件自己也被换了 ⇒ `Trace.i` 调 `Trace.i` = **无限递归，第一条日志就 StackOverflow**。
    //   ⛔ 别再对这个文件做那种全局替换。
    fun i(msg: String) { Log.i(TAG, msg); push("I", msg) }
    fun w(msg: String, e: Throwable? = null) { Log.w(TAG, msg, e); push("W", msg + suffix(e)) }
    fun e(msg: String, e: Throwable? = null) { Log.e(TAG, msg, e); push("E", msg + suffix(e)) }

    private fun suffix(e: Throwable?) = if (e == null) "" else "  <" + describe(e) + ">"

    /**
     * 把异常写成**能定位的一行**：类名 + 消息 + 最上面几帧我们自己的代码。
     * ⚠️ 只存 `e.message` 是不够的 —— 遇到 `message == null` 就等于什么都没记
     * （Nous 2026-08-25 指出的正是这一类"使用日志不是错误日志"）。
     */
    fun describe(e: Throwable): String {
        val head = e::class.java.simpleName + (e.message?.let { ": " + it } ?: "")
        val frames = e.stackTrace
            .filter { it.className.startsWith("com.nous.sylloge") }
            .take(3)
            .joinToString(" ← ") { it.methodName + "(" + it.fileName + ":" + it.lineNumber + ")" }
        return if (frames.isEmpty()) head else head + " @ " + frames
    }
}
