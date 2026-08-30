package com.nous.sylloge.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.nous.sylloge.BackupOutcome
import kotlinx.coroutines.CancellationException

/**
 * 把 [BackupEngine] 包成一个 WorkManager 任务，这样备份能在切后台 / 锁屏时继续跑。
 *
 * ⛔ **刻意不手写 `Service`** —— WorkManager 自带的前台服务已经把生命周期全包了，
 * 而且白送三样东西：通知栏取消按钮、进度回传、进程被杀后重启任务。
 *
 * ⚠️ **Android 15 起 `dataSync` 前台服务有 6 小时/24 小时上限**，超时会被系统停掉。
 * 停掉走的是协程取消那条路，引擎会在文件块边界安全退出，`.part` 残片下次开工清掉。
 * 用 [android.app.Service.onTimeout] 那套是给手写 Service 用的，我们这边由 WorkManager 处理。
 */
class BackupWorker(
    private val ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val treeStr = inputData.getString(KEY_TREE) ?: return Result.failure(
            workDataOf(KEY_ERROR to ctx.getString(R.string.err_no_usb_grant))
        )
        val tree = Uri.parse(treeStr)
        // ⚠️⚠️ 默认原来是 **5** —— 那是控制台时代的取证旋钮（"样本 5 张"）。
        // 调用方不传就只备份 5 张，而上卡写着"4205 张新的" ⇒ 用户会以为备完了。
        // 2026-08-25 改成 0 = 不限量；样本模式必须**显式**传一个正数。
        // ★ 教训：**默认值是给不知情的调用方用的** —— 它必须是"正确行为"，
        //   ⛔ 不能是"我调试时方便的行为"。
        val limit = inputData.getInt(KEY_LIMIT, 0)
        // ★ 测试通道（限速/指定文件夹）在 **release 里焊死**（2026-08-30，发布前审计）：
        //   ⛔ 不能只靠"生产路径不会传" —— 「限速没摘」那次事故就是这类通道漏出去的。
        //   ⚠️ 不用 BuildConfig（buildConfig 没开），用 FLAG_DEBUGGABLE 实测本包。
        val isDebuggable =
            (ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val throttle = if (isDebuggable) inputData.getLong(KEY_THROTTLE, 0L) else 0L

        val db = CatalogDb(ctx)
        val source = photoSourceOf(ctx)
        val engine = BackupEngine(ctx, db, source, throttle)

        return try {
            try {
                setForeground(foregroundInfo(0, 0, ctx.getString(R.string.notif_preparing)))
            } catch (e: Exception) {
                // ⭐ **平台硬约束**：Android 12+ 禁止 app 从后台启动前台服务。
                //    进程被系统杀掉后 WorkManager 会重排任务（attempts+1），但那时 app 在后台，
                //    setForeground 必然被拒：
                //      startForegroundService() not allowed: ...SystemForegroundService
                //    这不是我们的 bug，是"长时间传输必须由可见的 app 发起"这条规则。
                //    ⛔ 别在这里硬扛 —— 数据是安全的（已完成的都登记了），
                //    正确做法是让用户下次打开 app 时看到"上次没跑完"，点一下续上。
                Trace.w("起不了前台服务（多半是被系统杀掉后的后台重试）", e)
                return Result.failure(
                    workDataOf(KEY_ERROR to ctx.getString(R.string.err_interrupted))
                )
            }

            val cleaned = engine.cleanupParts(tree)
            if (cleaned > 0) Trace.w("开工前清掉 " + cleaned + " 个 .part 残片")

            // ⚠️ Worker 里也要过滤 —— 否则用户勾了 DCIM，备份却把全部都传了。
            // ⛔ 口径必须和上卡同源（FolderFilter）：原来这里自己拼了一套
            // `folderPrefs().filterValues{it}.keys.ifEmpty{null}`，没动过设置 = 空表 = null
            // = **全量拷**，和卡上的「4205 张」对不上（2026-08-25 抓到，没上过真机）。
            // ★ 测试通道（只有 debug 面板会传）：**显式指定文件夹**，绕开用户的勾选。
            //   ⛔ 生产路径永远走 FolderFilter —— 口径必须和上卡同源。
            val override = if (isDebuggable) inputData.getStringArray(KEY_FOLDERS) else null
            val allowed = if (override != null && override.isNotEmpty()) override.toSet()
                else FolderFilter.allowed(db, source)
            if (override != null) Trace.w("⚠️ 测试通道：只跑指定文件夹 " + allowed)
            val items = source.enumerate(limit, allowed)
            // ⚠️ 这里的 items 还是**全量**（引擎开工时才预滤）⇒ ⛔ 别把全量数报进通知，
            //    否则通知先说 9330、几秒后又变 412。先挂"准备中"，第一个 Progress 会带真数。
            setForeground(foregroundInfo(0, 0, ctx.getString(R.string.notif_preparing)))

            var lastNotifiedDone = -1
            val outs = engine.run(tree, items) { p ->
                // app 内：带字节进度，引擎已按 200ms 限流
                setProgressAsync(
                    workDataOf(
                        KEY_DONE to p.done,
                        KEY_TOTAL to p.total,
                        KEY_CURRENT to p.current,
                        KEY_FILE_DONE to p.fileDone,
                        KEY_FILE_TOTAL to p.fileTotal,
                        KEY_CURRENT_URI to p.currentUri,
                    )
                )
                // 通知栏：只在**文件数变化**时刷。跟着字节刷会一秒好几次，
                // 既费电又让通知一直在跳。
                if (p.done != lastNotifiedDone) {
                    lastNotifiedDone = p.done
                    setForegroundAsync(foregroundInfo(p.done, p.total, p.current))
                }
            }

            Result.success(
                workDataOf(
                    KEY_COPIED to outs.count { it is BackupOutcome.Copied },
                    KEY_RENAMED to outs.count { it is BackupOutcome.Renamed },
                    KEY_SKIPPED to outs.count { it is BackupOutcome.SkippedDuplicate },
                    KEY_FAILED to outs.count { it is BackupOutcome.Failed },
                )
            )
        } catch (e: CancellationException) {
            // 可能是用户点了取消，也可能是系统 6 小时超时把服务停了。
            // 两种都安全：已完成的文件已登记，没写完的只剩 .part，下次开工清掉。
            Trace.i("备份被停止（用户取消或系统超时）")
            throw e
        } catch (e: Exception) {
            Trace.e("备份失败", e)
            Result.failure(workDataOf(KEY_ERROR to Failures.text(ctx, e)))
        }
    }

    /** 通知栏那一条。⚠️ API 34+ 必须显式给 foregroundServiceType，否则起不来。 */
    private fun foregroundInfo(done: Int, total: Int, current: String): ForegroundInfo {
        ensureChannel()

        // 点通知回到 app。singleTask + CLEAR_TOP，回到已有实例而不是开新的
        val open = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // 取消按钮 —— WorkManager 白送，不用自己接 BroadcastReceiver
        val cancel = WorkManager.getInstance(ctx).createCancelPendingIntent(id)

        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(ctx.getString(R.string.notif_title))
            .setContentText(if (total > 0) ctx.getString(R.string.notif_progress, done, total, current) else current)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, ctx.getString(R.string.action_cancel), cancel)
            .apply {
                if (total > 0) setProgress(total, done, false)
                else setProgress(0, 0, true)
            }
            .build()

        return ForegroundInfo(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }

    private fun ensureChannel() {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, ctx.getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW).apply {
                description = ctx.getString(R.string.notif_channel_desc)
                setShowBadge(false)
            }
        )
    }

    companion object {
        const val WORK_NAME = "sylloge-backup"
        private const val CHANNEL = "backup_progress"
        private const val NOTIF_ID = 1001

        const val KEY_TREE = "tree"
        const val KEY_LIMIT = "limit"
        const val KEY_THROTTLE = "throttle"
        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"
        const val KEY_CURRENT = "current"
        /** 当前这张的原图 URI，界面用来采主色。 */
        const val KEY_CURRENT_URI = "currentUri"
        const val KEY_FILE_DONE = "fileDone"
        const val KEY_FILE_TOTAL = "fileTotal"
        const val KEY_COPIED = "copied"
        const val KEY_RENAMED = "renamed"
        const val KEY_SKIPPED = "skipped"
        const val KEY_FAILED = "failed"
        const val KEY_ERROR = "error"

        /** 测试用：只跑这些文件夹。⛔ 生产不传，传了就绕开用户勾选。 */
        const val KEY_FOLDERS = "folders_override"

        fun input(tree: Uri, limit: Int, throttle: Long): Data =
            workDataOf(
                KEY_TREE to tree.toString(),
                KEY_LIMIT to limit,
                KEY_THROTTLE to throttle,
            )
    }
}
