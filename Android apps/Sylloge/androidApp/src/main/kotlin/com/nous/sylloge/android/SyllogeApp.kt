package com.nous.sylloge.android

import android.app.Application
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * ★★ **自己捕获崩溃**（M7 真正的缺口，Nous 2026-08-25 问出来的）。
 *
 * 这个 app **不联网、没有崩溃上报** —— 那就意味着：
 * **用户那边崩一次，我们永远不会知道**，除非自己在进程死掉之前把栈写下来。
 * ⇒ 崩溃时把「异常栈 + 崩溃前的运行痕迹」落盘，下次打开时随诊断包一起交出来。
 *
 * ⚠️ **必须把异常交回给系统原来的处理器**（chain）：
 * ⛔ 自己吞掉的话，系统不会显示"应用已停止"、进程可能挂在半死不活的状态，
 * 而且 Play 那边的 ANR/崩溃统计也会缺一块。**我们只是顺路记一笔，不接管。**
 */
class SyllogeApp : Application() {

    override fun onCreate() {
        super.onCreate()
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            // ⚠️ 写盘本身也可能抛 —— 绝不能让它盖住原来的崩溃
            runCatching { writeCrash(t, e) }
            prev?.uncaughtException(t, e)   // ★ 交回去，⛔ 不吞
        }
        Trace.i("app 启动")
    }

    private fun writeCrash(t: Thread, e: Throwable) {
        val dir = crashDir(this).apply { mkdirs() }
        // 只留最近几份，⛔ 别在用户手机上无限堆
        dir.listFiles()?.sortedByDescending { it.lastModified() }?.drop(KeepCrashes - 1)
            ?.forEach { it.delete() }

        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date(System.currentTimeMillis()))
        val sw = StringWriter()
        e.printStackTrace(PrintWriter(sw))

        val sb = StringBuilder()
        sb.appendLine("时间：" + stamp)
        sb.appendLine("线程：" + t.name)
        sb.appendLine()
        sb.appendLine("异常：")
        sb.appendLine(sw.toString().trimEnd())
        sb.appendLine()
        sb.appendLine("崩溃前的运行痕迹（旧→新）：")
        Trace.recent().forEach { sb.appendLine("  " + it) }
        File(dir, "crash-" + stamp + ".txt").writeText(sb.toString())
    }

    companion object {
        /** 保留几份崩溃记录。 */
        const val KeepCrashes = 3

        /**
         * 崩溃记录都在这里。
         * ★ **写的（这里）和读的（[Diagnostic]）必须同源** —— ⛔ 别在两边各拼一次路径，
         *   那是"抄一份 = 造一个会腐坏的副本"：改了一边另一边不报错，只是读到空。
         */
        fun crashDir(ctx: android.content.Context): File = File(ctx.filesDir, "crash")
    }
}
