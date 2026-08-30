package com.nous.sylloge.android

import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.nous.sylloge.ui.PrepFix
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nous.sylloge.ui.AppShell
import com.nous.sylloge.ui.DeckState

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = schemeOrDefault()) {
                Surface(Modifier.fillMaxSize()) { Root() }
            }
        }
    }
}

@Composable
private fun Root(vm: DeckViewModel = viewModel(), folders: FolderDeckViewModel = viewModel()) {
    val ctx = LocalContext.current
    // 只自动弹一次系统权限框；再点就直接送去系统设置页
    var askedPhotoOnce by remember { mutableStateOf(false) }
    var hideNomedia by remember { mutableStateOf(AppPrefs.hideNomedia(ctx)) }

    // 读照片权限：⚠️ 没有它连图库都不存在，是最容易漏的空态。
    // ⚠️ 现在要**两个**权限（图片 + 视频）⇒ RequestMultiplePermissions
    val perm = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { vm.prepare() }

    // U 盘授权（SAF）
    val pick = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { r ->
        r.data?.data?.let { UsbAccess.persist(ctx, it) }
        vm.prepare()
    }

    // 把「去要照片权限」收成一处：⛔ 别在两个分支里各写一遍（会分叉）
    fun requestPhotoAccess(c: android.content.Context, asked: Boolean, markAsked: () -> Unit) {
        // ★ 首选「所有文件访问」——Nous 2026-08-25 拍板的发布形态，一个权限顶三个，
        //   而且只有它看得到 `.nomedia` 里的照片。
        //   ⚠️ 它**不是运行时弹窗**，是跳系统设置页 ⇒ 没有结果回调，
        //      靠回前台重查（ON_RESUME）把状态刷回来。
        if (!AllFilesSource.hasAccess()) { c.startActivity(AllFilesSource.requestIntent(c)); return }
        // 到这儿说明全文件访问已经有了，那缺的只可能是 READ_MEDIA 这条降级路
        if (asked) openAppSettings(c) else { markAsked(); perm.launch(MediaStoreSource.REQUIRED_PERMISSIONS) }
    }

    LaunchedEffect(Unit) {
        // ⚠️ 已经有「所有文件访问」就**别再弹 READ_MEDIA 的框** —— 它是降级路径用的，
        //    全文件访问已经覆盖它，多弹一次纯属骚扰。
        if (!AllFilesSource.hasAccess()) perm.launch(MediaStoreSource.REQUIRED_PERMISSIONS)
    }

    // ⭐⭐ **回到 app 就重新检查一遍**（Nous 2026-08-25：「要了之后不自动刷新」）。
    //
    // 这些东西**全都在 app 外面变**，变了我们收不到任何回调：
    // 系统权限弹窗、系统设置页里改权限、插上 / 拔掉 U 盘。
    // ⛔ 不重新检查的话，用户明明刚给了权限，卡面还停在"只给了部分照片"，
    //    点按钮又只会再弹一次 —— 看起来就是"给了也没用"。
    //
    // ⚠️ **拷贝进行中绝不打断**：那会把进度卡重置成准备流程。
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_RESUME) vm.refreshIfIdle()
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }

    AppShell(
        deck = vm.deck,
        onConfirm = {
            when (val d = vm.deck) {
                is DeckState.Ready -> vm.confirm()
                is DeckState.NeedsResume -> vm.confirm()
                // 准备阶段卡住了 ⇒ 点一下去解决：第 0 步失败 = 没授权 → 拉 SAF；
                // 其余步失败（盘没插/只读/标识读不懂）→ 重试一遍
                // ★ 按状态自己说的 `fix` 分派，⛔ 不靠"第几行失败了"去猜
                is DeckState.Preparing -> when (d.fix) {
                    PrepFix.PickUsb -> pick.launch(UsbAccess.buildPickIntent(ctx))
                    // ⚠️ 再请求一次即可：Android 14+ 会弹「允许有限访问 / 全部允许」，
                    //    用户选「全部允许」就修好了。若他之前点过「不再询问」，
                    //    系统直接回拒 ⇒ 兜底把他送到系统设置页（⛔ 不能让他卡死在这）。
                    PrepFix.PhotoPermission -> {
                        requestPhotoAccess(ctx, askedPhotoOnce) { askedPhotoOnce = true }
                    }
                    PrepFix.Retry -> vm.prepare()
                }
                // ⭐ 红卡本身就是按钮：点一下重新申请照片权限
                is DeckState.NoPhotoPermission -> {
                    requestPhotoAccess(ctx, askedPhotoOnce) { askedPhotoOnce = true }
                }
                else -> vm.prepare()
            }
        },
        onCancel = { vm.cancel() },
        // 上卡第 2 页：日志（时间粒度 + 展开详情）
        logPage = { LogPane() },
        // 下卡两页：文件夹焦点列表（含确认弹窗）/ 说明此 app
        folderPage = { FolderDeckPane(folders) },
        aboutPage = {
            // 最后备份的盘：查库要下 IO，⚠️ 别在组合里每帧查 —— produceState 查一次
            val savedLoc by androidx.compose.runtime.produceState<String?>(null) {
                value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    CatalogDb(ctx).use { db ->
                        db.lastTargetLabel()?.let {
                            it + " / " + com.nous.sylloge.Layout.rootDirName(android.os.Build.MODEL)
                        }
                    }
                }
            }
            com.nous.sylloge.ui.AboutPage(
                appVersion(),
                savedLocation = savedLoc,
                // ★ 一个动作两步（Nous 2026-08-30 定）：先开反馈页、再弹分享面板 ——
                //   分享面板叠在最上，用户处理完它，反馈页已经在浏览器里等着。
                //   ⚠️ 都只是 ACTION_VIEW 交系统 —— app 本身仍零网络权限。
                onFeedback = {
                    openUrl(ctx, "https://github.com/N0USx1/NOUS-Publishes/issues")
                    Diagnostic.share(ctx)
                },
                onKofi = { openUrl(ctx, "https://ko-fi.com/nnnous") },
                hideNomedia = hideNomedia,
                onHideNomediaChange = {
                    hideNomedia = it
                    // ⚠️ setIncludeHidden 内部已经 bump 了 FolderPrefsBus，
                    //    上下两卡都听它重算 ⇒ ⛔ **这里不要再调 refreshIfIdle**：
                    //    那条路会 invalidate 扫描缓存，每翻一次开关整棵树重扫 3.6 秒
                    //    （2026-08-25 实测踩到）。
                    AppPrefs.setHideNomedia(ctx, it)
                },
            )
        },
    )
}

@Composable
private fun schemeOrDefault(): ColorScheme {
    val ctx = LocalContext.current
    val dark = isSystemInDarkTheme()
    // ★ **跟着手机走**（Nous 2026-08-25）：Material You 从壁纸取色。
    // ⚠️⚠️ 官方硬性要求 **API 31+**，而我们 minSdk = 30 ——
    //    原来无条件调它，**lint 直接报 Error（NewApi）**：Android 11 上那几个
    //    `android.R.color.system_accent*` 资源根本不存在。
    //    ⇒ 照官方写法加版本闸 + 兜底调色板。
    // ⚠️ 兜底暂用 M3 基线色；等 Nous 给种子色再换成品牌调色板（P4）。
    return when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && dark ->
            androidx.compose.material3.dynamicDarkColorScheme(ctx)
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            androidx.compose.material3.dynamicLightColorScheme(ctx)
        dark -> androidx.compose.material3.darkColorScheme()
        else -> androidx.compose.material3.lightColorScheme()
    }
}

/** 版本号从包管理器读，⛔ 不硬编码（硬编码 = 抄一份会腐坏的副本）。 */
@Composable
private fun appVersion(): String {
    val ctx = LocalContext.current
    return remember {
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }
            .getOrNull() ?: "?"
    }
}

/**
 * 把用户送到本 app 的系统设置页。
 * ⚠️ 用在"系统已经不肯再弹权限框"的时候（他点过「不再询问」）——
 * ⛔ 没有这条兜底，用户会永远卡在"只授权了部分照片"这一屏，点按钮毫无反应。
 */
private fun openAppSettings(ctx: android.content.Context) {
    ctx.startActivity(
        android.content.Intent(
            android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            android.net.Uri.fromParts("package", ctx.packageName, null),
        ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}

/** 交给系统浏览器打开。⚠️ app 自己不联网 —— 网络动作全部发生在浏览器里。 */
private fun openUrl(ctx: android.content.Context, url: String) {
    runCatching {
        ctx.startActivity(
            android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }.onFailure { Trace.w("打不开浏览器", it) }
}
