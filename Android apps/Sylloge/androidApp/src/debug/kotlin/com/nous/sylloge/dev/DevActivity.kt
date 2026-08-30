package com.nous.sylloge.dev

import kotlinx.coroutines.launch
import android.os.Bundle
import com.nous.sylloge.android.UsbAccess
import com.nous.sylloge.android.BackupWorker
import com.nous.sylloge.android.BackupSetStore
import androidx.work.WorkManager
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.ExistingWorkPolicy
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nous.sylloge.ui.*

/**
 * **状态台** —— 把上卡的每一个状态手动摆出来看。
 *
 * ⛔ 这是**取证脚手架，不是 app 的一部分**：它只存在于 `src/debug/`，
 * release 构建里连编译都不参与。
 *
 * 为什么需要它：真实流程要插 U 盘、要跑完整备份，很多状态（失败、被杀待续传、
 * 拷贝中的换色）**在桌上根本摆不出来** ⇒ 判断不了设计对不对。
 */
class DevActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // ★ 可以用 adb 直接触发，⛔ 不用盲点坐标（按钮行会横向滚动，点击极不稳定）：
        //   adb shell am start -n com.nous.sylloge/com.nous.sylloge.dev.DevActivity --ez throttled_test true
        if (intent?.getBooleanExtra("throttled_test", false) == true)
            startThrottledTest(
                this,
                intent?.getStringExtra("folder") ?: "Pictures/sylloge-test",
                intent?.getLongExtra("throttle", 2000L) ?: 2000L,
            )
        // 也能用 adb 确定性地取消，⛔ 不靠点屏幕：
        //   adb shell am start -n .../.dev.DevActivity --ez cancel_backup true
        // 陌生盘导入的**空跑**验证：adb shell am start -n .../.dev.DevActivity --ez foreign_dry true
        if (intent?.getBooleanExtra("foreign_dry", false) == true) foreignDryRun(this)
        if (intent?.getBooleanExtra("cleanup_test", false) == true) cleanupTestLeftovers(this)
        // 失败文案实机对拍：adb shell am start -n .../.dev.DevActivity --ez err_copy true
        if (intent?.getBooleanExtra("err_copy", false) == true) errorCopyProbe(this)
        if (intent?.getBooleanExtra("cancel_backup", false) == true) {
            WorkManager.getInstance(this).cancelUniqueWork(BackupWorker.WORK_NAME)
        }
        super.onCreate(savedInstanceState)
        setContent {
            val ctx = LocalContext.current
            MaterialTheme(
                colorScheme = if (isSystemInDarkTheme()) dynamicDarkColorScheme(ctx)
                else dynamicLightColorScheme(ctx)
            ) { // ⛔ 这里**不能**裹 safeDrawingPadding：AppShell 自己会满铺背景 + 用显式空位顶开内容。
                // 裹了的话它的黑底和炫光就到不了刘海，看起来像"刘海没修"。
                Surface(Modifier.fillMaxSize(), color = androidx.compose.ui.graphics.Color.Black) { Board() } }
        }
    }
}

private val FAKE_ACCENTS = listOf(
    Color(0xFFB5651D), Color(0xFF2E7D9A), Color(0xFF7B4B94),
    Color(0xFF3F7D3F), Color(0xFFC9A227), Color(0xFF9C3B3B),
)

/** 状态台的假 detail：照 `DeckViewModel` 真会发的那几句写，⛔ 别编 app 里没有的东西。 */
private fun fakeDetail(i: Int): String = when (i) {
    1 -> "NOUS sync"
    2 -> "NOUS sync"
    3 -> "备份集 f9a6c565"
    4 -> "已记录 104 条"
    5 -> "4205 张要拷"
    6 -> "共 13.6 GB"
    else -> ""
}

@Composable
private fun Board() {
    val ctxRef = androidx.compose.ui.platform.LocalContext.current
    var prep by remember { mutableIntStateOf(0) }
    var runDone by remember { mutableIntStateOf(37) }
    var which by remember { mutableStateOf("prep") }
    // ⚠️ AppShell 的档位用 rememberSaveable 存着（正式 app 里这是对的：沉界面要保留用户选择），
    // 但在状态台里会一直恢复上次拖到的档 ⇒ 给一个复位：换 key 强制重建。
    var shellKey by remember { mutableIntStateOf(0) }

    val deck: DeckState = when (which) {
        "prep" -> DeckState.Preparing(
            PrepStep.entries.mapIndexed { i, s ->
                PrepLine(
                    s,
                    when {
                        i < prep -> StepPhase.Done
                        i == prep -> StepPhase.Active
                        else -> StepPhase.Pending
                    },
                    // ⚠️ 假数据要**像真的**：原来这里写"第 N 步"，那句在真 app 里根本不存在，
                    //    照着它验收排版 = 拿一把没校准的尺子量（2026-08-25 Nous 指出）。
                    //    ⇒ 换成 DeckViewModel 真会发的那几句。
                    if (i == prep) fakeDetail(i) else "",
                )
            }
        )
        "prepfail" -> DeckState.Preparing(
            PrepStep.entries.mapIndexed { i, s ->
                PrepLine(
                    s,
                    when {
                        i < prep -> StepPhase.Done
                        i == prep -> StepPhase.Failed
                        else -> StepPhase.Pending
                    },
                    if (i == prep) "这一步炸了" else "",
                )
            }
        )
        "ready" -> DeckState.Ready(
            newPhotos = 412, newVideos = 37, newBytes = 1_842_000_000L,
            skipPhotos = 4386, skipVideos = 156, target = "NOUS sync",
        )
        // 任务刚起、引擎还在预滤 —— 真数字没出来（D31 之后必然出现的态）
        "runprep" -> DeckState.Running(
            done = 0, total = 0, currentName = "", fileFraction = 0f,
            accent = FAKE_ACCENTS[0],
        )
        "running" -> DeckState.Running(
            done = runDone, total = 100,
            currentName = "IMG_20240217_00" + runDone + "_very_long_name.jpg",
            fileFraction = 0.6f,
            accent = FAKE_ACCENTS[runDone % FAKE_ACCENTS.size],
        )
        "done" -> DeckState.Done(412, 4386, 2)
        "failed" -> DeckState.Failed("U 盘中途拔掉了，这一轮已中止")
        "resume" -> DeckState.NeedsResume(135, 7370)
        else -> DeckState.NoPhotoPermission(partial = true)
    }

    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        key(shellKey) {
        AppShell(
            deck = deck,
            onConfirm = { which = "running" },
            onCancel = { which = "done" },
            logPage = { Placeholder("日志") },
            folderPage = { Placeholder("文件夹焦点列表") },
            aboutPage = { Placeholder("说明此 app") },
            modifier = Modifier.weight(1f),
        )
        }

        HorizontalDivider()
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(
                "prep" to "准备中", "prepfail" to "某步失败", "ready" to "就绪(绿)",
                "runprep" to "刚起步0/0", "running" to "拷贝中", "done" to "完成", "failed" to "失败",
                "resume" to "待续传", "perm" to "无权限",
            ).forEach { (k, label) ->
                FilterChip(selected = which == k, onClick = { which = k }, label = { Text(label) })
            }
        }
        Row(Modifier.padding(bottom = 8.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { prep = (prep + 1) % PrepStep.entries.size }) { Text("下一步 (" + prep + ")") }
            OutlinedButton(onClick = { runDone = (runDone + 11) % 100 }) { Text("推进度 (" + runDone + ")") }
            OutlinedButton(onClick = { shellKey++ }) { Text("档位复位") }
            // ★ 验证**崩溃捕获**用的（只在 debug 包里）：点一下 → app 挂掉 →
            //   重开 → 说明页「导出诊断包」→ md 里应当出现这条栈。
            //   ⛔ 崩溃捕获这种东西**不能只靠读代码确认**，必须真崩一次看落盘。
            // ★ 只给验证用（debug 包）：跑一次**只拷 3 张**的完整会话 ——
            //   走的是和真备份**一模一样的收尾路径**（写标识/导 catalog/写日流水/写清单），
            //   但不会往 Nous 的盘上灌 22.9 GB。⛔ 不改他的文件夹勾选。
            OutlinedButton(onClick = {
                val ctx = ctxRef!!
                val tree = UsbAccess.persisted(ctx).firstOrNull { it.canWrite }?.uri
                if (tree == null) {
                    android.widget.Toast.makeText(ctx, "没有可写的 U 盘授权", android.widget.Toast.LENGTH_LONG).show()
                } else {
                    WorkManager.getInstance(ctx).enqueueUniqueWork(
                        BackupWorker.WORK_NAME,
                        ExistingWorkPolicy.REPLACE,
                        OneTimeWorkRequestBuilder<BackupWorker>()
                            .setInputData(BackupWorker.input(tree, 3, 0L)).build(),
                    )
                    android.widget.Toast.makeText(ctx, "样本备份已排队（3 张）", android.widget.Toast.LENGTH_SHORT).show()
                }
            }) { Text("样本备份 3 张") }
            // ★ 把盘上那两份人类可读产物读回到 cache，好让我用 run-as 核对内容。
            OutlinedButton(onClick = {
                val ctx = ctxRef!!
                val tree = UsbAccess.persisted(ctx).firstOrNull { it.canWrite }?.uri
                val txt = if (tree == null) "没有 U 盘授权" else BackupSetStore.dumpReports(ctx, tree)
                java.io.File(ctx.cacheDir, "drive-reports.txt").writeText(txt)
                android.widget.Toast.makeText(ctx, "已读回 " + txt.length + " 字", android.widget.Toast.LENGTH_SHORT).show()
            }) { Text("读回盘上报告") }
            // ★ M8 前提验证：拿到「所有文件访问」之后，File API 列不列得到
            //   `.nomedia` 目录里的照片？官方文档没明说 ⇒ 只能实测。
            OutlinedButton(onClick = {
                val ctx = ctxRef!!
                val sb = StringBuilder()
                val mgr = android.os.Environment.isExternalStorageManager()
                sb.append("isExternalStorageManager = ").append(mgr).append(Char(10))
                listOf("sylloge-hidden", "sylloge-control").forEach { name ->
                    val dir = java.io.File(android.os.Environment.getExternalStorageDirectory(), "Pictures/" + name)
                    sb.append(Char(10)).append("--- ").append(dir.path).append(" ---").append(Char(10))
                    sb.append("exists=").append(dir.exists())
                        .append(" canRead=").append(dir.canRead()).append(Char(10))
                    val kids = dir.listFiles()
                    sb.append("listFiles -> ").append(kids?.size?.toString() ?: "null").append(Char(10))
                    kids?.forEach { f ->
                        sb.append("   ").append(f.name).append("  ").append(f.length())
                            .append(" 字节  可读=").append(f.canRead()).append(Char(10))
                    }
                }
                java.io.File(ctx.cacheDir, "nomedia-probe.txt").writeText(sb.toString())
                android.widget.Toast.makeText(ctx, "探针写好了", android.widget.Toast.LENGTH_SHORT).show()
            }) { Text("探 .nomedia") }
            // ★★ 隔离测试：只跑 Pictures/sylloge-test（10 张纯色图），**限速 2 KB/s**
            //   ⇒ 每张约 3.4 秒、全程约 34 秒，够观察「离开 app 会不会继续跑」和
            //   「停止之后能不能续上」。⛔ 不碰 Nous 的照片，也不动他的文件夹勾选。
            OutlinedButton(onClick = { startThrottledTest(ctxRef!!, "Pictures/sylloge-test", 2000L) }) { Text("限速测试 10 张") }
            OutlinedButton(onClick = {
                throw IllegalStateException("故意崩一次：验证 SyllogeApp 的崩溃捕获")
            }) { Text("制造崩溃") }
        }
        Spacer(Modifier.fillMaxWidth().windowInsetsBottomHeight(WindowInsets.safeDrawing))
    }
}

@Composable
private fun Placeholder(name: String) {
    Box(Modifier.fillMaxSize(), androidx.compose.ui.Alignment.Center) {
        Text("（" + name + "）", style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * 隔离测试：只跑 `Pictures/sylloge-test`，**限速 2 KB/s**。
 * ⛔ 绕开用户的文件夹勾选，⛔ 不碰他的照片。
 */
private fun startThrottledTest(ctx: android.content.Context, folder: String, throttle: Long) {
    val tree = UsbAccess.persisted(ctx).firstOrNull { it.canWrite }?.uri
    if (tree == null) {
        android.widget.Toast.makeText(ctx, "没有可写的 U 盘授权", android.widget.Toast.LENGTH_LONG).show()
        return
    }
    // ⚠️⚠️ **KEEP，绝不能是 REPLACE**：测试通道和生产走**同一个 unique work name**，
    //    用 REPLACE 的话，Nous 正在跑真实备份时我一按测试，**他的备份会被当场取消**
    //    （2026-08-26 查 ExistingWorkPolicy 时发现）。
    //    ⇒ 有东西在跑就让它跑完，测试自己不启动。
    WorkManager.getInstance(ctx).enqueueUniqueWork(
        BackupWorker.WORK_NAME,
        ExistingWorkPolicy.KEEP,
        OneTimeWorkRequestBuilder<BackupWorker>().setInputData(
            androidx.work.workDataOf(
                BackupWorker.KEY_TREE to tree.toString(),
                BackupWorker.KEY_LIMIT to 0,
                BackupWorker.KEY_THROTTLE to throttle,
                BackupWorker.KEY_FOLDERS to arrayOf(folder),
            )
        ).build(),
    )
    android.widget.Toast.makeText(ctx, "限速测试已排队（若已有任务在跑则不会启动）", android.widget.Toast.LENGTH_SHORT).show()
}

/**
 * 清掉隔离测试的残留：U 盘上的 Pictures/sylloge-* 目录 + catalog 里对应的条目。
 * 只清这几个前缀，绝不碰 Nous 的照片和他的备份记录。
 */
private fun cleanupTestLeftovers(ctx: android.content.Context) {
    // ⚠️ **库的清理不能挂在 U 盘后面** —— 盘拔了就一起清不成了（我第一版就是这么写的）。
    val tree = UsbAccess.persisted(ctx).firstOrNull { it.canWrite }?.uri
    var files = 0
    if (tree != null) runCatching {
        val root = androidx.documentfile.provider.DocumentFile.fromTreeUri(ctx, tree)
            ?.findFile(com.nous.sylloge.Layout.rootDirName(android.os.Build.MODEL))
        val pics = root?.findFile("Pictures")
        listOf("sylloge-test", "sylloge-big", "sylloge-huge", "sylloge-glow", "sylloge-rt").forEach { name ->
            pics?.findFile(name)?.let { d ->
                d.listFiles().forEach { if (it.delete()) files++ }
                d.delete()
            }
        }
    }
    val db = com.nous.sylloge.android.CatalogDb(ctx).writableDatabase
    val rows = db.delete("entry", "rel_path LIKE ?", arrayOf("Pictures/sylloge-%"))
    // 顺带清掉**一条记录都没有的未完成会话** —— 测试反复中止留下的空壳，
    // 它们只会让日志页变脏、并让「上次没做完」一直冒出来。
    // ⛔ 有 entry 的一律保留（那是真备份过东西的会话）。
    val ghosts = db.delete(
        "session",
        "finished_at IS NULL AND id NOT IN (SELECT DISTINCT session_id FROM entry)",
        null,
    )
    android.widget.Toast.makeText(
        ctx, "清掉盘上 " + files + " 个文件、库里 " + rows + " 条、空会话 " + ghosts + " 条", android.widget.Toast.LENGTH_LONG,
    ).show()
}

/**
 * 陌生盘导入的空跑：**只读**，⛔ 不写本机 catalog、⛔ 不动盘上任何文件。
 * 拿这块盘自己的标识文件当作"陌生"的输入，把拉快照/解析/抽样三步真跑一遍。
 */
private fun foreignDryRun(ctx: android.content.Context) {
    // ⚠️⚠️ **必须放到后台线程。** 2026-08-26 我第一版直接在 onCreate 里裸调，
    //    它要拉快照 + 解析 7559 行 + 32 次 SAF 目录查找（每次都是跨进程 IPC）
    //    ⇒ 几秒钟阻塞落在主线程上，**整个 app 冻住，Nous 进不去**。
    // ★ 教训：**调试代码和生产代码跑在同一个进程里** —— 生产路径我记得包 IO 调度，
    //    给自己写的通道就随手裸调，卡死的是同一个 UI。⛔ 调试通道同样要守线程规矩。
    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
        val tree = UsbAccess.persisted(ctx).firstOrNull { it.canWrite }?.uri
        val msg = if (tree == null) "没有可写的 U 盘授权" else {
            val db = com.nous.sylloge.android.CatalogDb(ctx)
            when (val id = com.nous.sylloge.android.BackupSetStore.identify(ctx, tree, emptySet())) {
                is com.nous.sylloge.SetIdentity.Foreign ->
                    "空跑: " + com.nous.sylloge.android.ForeignImport
                        .tryImport(ctx, tree, id.marker, db, dryRun = true)
                else -> "识别成了 " + id::class.simpleName + "，不是 Foreign"
            }
        }
        com.nous.sylloge.android.Trace.w("【陌生盘空跑】" + msg)
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
            android.widget.Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_LONG).show()
        }
    }
}
