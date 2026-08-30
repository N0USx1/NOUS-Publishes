package com.nous.sylloge.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.FileProvider
import com.nous.sylloge.CatalogSchema
import com.nous.sylloge.humanBytes
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 诊断包（M7）。**这个 app 不联网、没有崩溃上报 ⇒ 这是唯一的售后手段。**
 *
 * ★ 产物是 **Markdown**（Nous 2026-08-25：「不要让他导出成 txt，改成用 md 的形式」）。
 *
 * ⛔⛔ **不打包 `catalog.db` 原文件** —— 里面是几千条文件路径，那是用户的隐私，
 * 而且他没法先看一眼里面有什么。⇒ 生成一份**人类可读的文本**：
 * 他能自己读完再决定发不发给谁。
 *
 * ⚠️ 里面**仍然含有文件路径**（失败项和文件夹名），这是诊断必需的 ——
 * 所以第一行就写清楚里面有什么，⛔ 不搞"看不懂但你发过来吧"。
 */
object Diagnostic {

    private fun ts(ms: Long) = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(Date(ms))

    fun build(ctx: Context): String {
        val db = CatalogDb(ctx)
        val sb = StringBuilder()
        fun line(s: String = "") = sb.append(s).append('\n')

        line("# Sylloge 诊断包")
        line()
        line("> 生成时间：" + ts(System.currentTimeMillis()))
        line()
        line("## 这份文件里有什么")
        line()
        line("- 机型 / 安卓版本 / app 版本 / 权限状态")
        line("- U 盘授权状态、备份集身份")
        line("- 历次备份的统计，以及**失败的文件路径和原因**")
        line("- 各文件夹的照片/视频数量与勾选状态")
        // ⚠️ 这份清单是用户"发不发"的依据 ⇒ **有什么就写什么**，
        //    ⛔ 少写一项就等于让他在不知情的前提下把东西发出去。
        line("- 如果 app 崩过：**崩溃的错误栈**")
        line("- app 最近做过的操作痕迹（打开、扫描、拷贝这些，含文件名）")
        line()
        line("> ⚠️ 含有文件路径（**不含照片本身**）。发之前可以自己先读一遍。")
        line()

        line("## 机器")
        line()
        line("| | |")
        line("|---|---|")
        line("| 机型 | " + Build.MANUFACTURER + " " + Build.MODEL + " |")
        line("| 安卓 | " + Build.VERSION.RELEASE + "（API " + Build.VERSION.SDK_INT + "） |")
        val ver = runCatching {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName
        }.getOrNull() ?: "?"
        line("| app | `" + ctx.packageName + "` " + ver + " |")
        line("| catalog schema | v" + CatalogSchema.VERSION + " |")
        line()

        line("## 权限")
        line()
        (MediaStoreSource.REQUIRED_PERMISSIONS.toList() + listOf(
            android.Manifest.permission.POST_NOTIFICATIONS,
        )).forEach { p ->
            val ok = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
            line("- " + (if (ok) "✅" else "❌") + " `" + p.substringAfterLast('.') + "`")
        }
        line()

        line("## U 盘")
        line()
        val grants = UsbAccess.persisted(ctx)
        if (grants.isEmpty()) line("- 没有任何长期授权（用户还没选过 U 盘）")
        grants.forEach { g ->
            line("- **" + UsbAccess.displayName(ctx, g.uri) + "** —— 读=" + g.canRead + " 写=" + g.canWrite)
            line("  - 授权时间：" + ts(g.takenAtEpochMs))
            line("  - 现在能用吗：" + Failures.text(ctx, UsbAccess.checkAccess(ctx, g.uri)))
        }
        val setId = BackupSetId.current(ctx, db)
        line("- 当前备份集：" + (if (setId.isEmpty()) "（认不出来 / 盘没插）" else "`" + setId + "`"))
        line("- 本机认识的备份集：" + db.knownSetIds().joinToString { "`" + it + "`" }.ifEmpty { "（无）" })
        line()

        line("## 历次备份")
        line()
        val sessions = db.sessions(50)
        if (sessions.isEmpty()) {
            line("还没有备份过。")
            line()
        } else {
            line("| 时间 | 拷 | 跳过 | 失败 | 大小 | 目标 | 耗时 |")
            line("|---|---|---|---|---|---|---|")
            sessions.forEach { s ->
                // ⚠️ **主数字永远用引擎的计数**；拆分只当补充 ——
                //    并排摆"拷 65（照片 66）"会自相矛盾（v5 之前的老会话推不准）
                val copied = s.copied.toString() +
                    (if (s.copiedVideos > 0) "（含 " + s.copiedVideos + " 视频）" else "")
                val span = if (s.finishedAtMs == null) "**没跑完**"
                    else (((s.finishedAtMs - s.startedAtMs) / 1000).coerceAtLeast(0)).toString() + " 秒"
                line(
                    "| " + ts(s.startedAtMs) + " | " + copied + " | " + s.skipped + " | " +
                        s.failed + " | " + s.bytes.humanBytes() + " | " + s.target + " | " + span + " |"
                )
            }
            line()
            // 失败明细单独一节 —— 这才是看诊断包的人真正要找的东西
            val fails = sessions.flatMap { s -> db.failuresOf(s.id, 200).map { s to it } }
            if (fails.isNotEmpty()) {
                line("### 失败明细")
                line()
                fails.forEach { (s, f) ->
                    line("- `" + f.relPath + "`")
                    line("  - " + ts(s.startedAtMs) + " —— " + f.reason)
                }
                line()
            }
        }

        // ★★ 崩溃记录 —— **这才是"代码为什么错"的答案**（其余几节回答的是"环境是什么"）
        line("## 崩溃记录")
        line()
        val crashes = SyllogeApp.crashDir(ctx).listFiles()
            ?.sortedByDescending { it.lastModified() } ?: emptyList()
        if (crashes.isEmpty()) {
            line("没有记录到崩溃。")
        } else {
            crashes.forEach { f ->
                line("### " + f.name)
                line()
                line("```")
                line(runCatching { f.readText().trimEnd() }.getOrElse { "（读不出来：" + it + "）" })
                line("```")
                line()
            }
        }
        line()

        line("## 崩溃前后的运行痕迹")
        line()
        line("> 这是 app 自己留的最近 " + Trace.recent().size + " 条（用户手机的 logcat 我们拿不到）。")
        line()
        line("```")
        Trace.recent().forEach { line(it) }
        line("```")
        line()

        line("## 文件夹")
        line()
        line("| 备份 | 路径 | 照片 | 视频 | 大小 |")
        line("|---|---|---|---|---|")
        val prefs = db.folderPrefs()
        val src = photoSourceOf(ctx)
        val stats = runCatching { src.folderStats() }.getOrNull()
        if (stats == null) line("| | 读不到（多半是没给读照片的权限） | | | |")
        stats?.forEach { st ->
            val on = prefs[st.path] ?: com.nous.sylloge.FolderDefaults.defaultEnabled(st.path)
            line(
                "| " + (if (on) "✅" else "—") + " | `" + st.path + "` | " +
                    st.photos + " | " + st.videos + " | " + st.bytes.humanBytes() + " |"
            )
        }
        return sb.toString()
    }

    /**
     * 写到 cache 里再用 `ACTION_SEND` 交出去。
     * ⚠️ **不需要任何网络权限** —— 我们只是把文件递给用户自己选的 app。
     */
    fun share(ctx: Context) {
        val dir = File(ctx.cacheDir, "diagnostic").apply { mkdirs() }
        // ⚠️ 每次只留最新一份，⛔ 别在用户的缓存里堆文件
        dir.listFiles()?.forEach { it.delete() }
        // ★ **Markdown**（Nous 2026-08-25 定）—— 标题/表格/引用块都在，
        //   在任何 md 阅读器里都排得开；纯文本编辑器打开也还是能读。
        val f = File(dir, "sylloge-诊断-" + SimpleDateFormat("MMdd-HHmm", Locale.ROOT)
            .format(Date(System.currentTimeMillis())) + ".md")
        f.writeText(build(ctx))
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
        val send = Intent(Intent.ACTION_SEND).apply {
            // ⚠️ 用 `text/markdown` 会让一部分接收方从分享面板里消失（它们只声明 text/plain）
            //    ⇒ MIME 保持 `text/plain`（md 本来就是纯文本），**文件名后缀给 .md**。
            type = "text/plain"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Sylloge 诊断包")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(
            Intent.createChooser(send, "把诊断包发给…").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
