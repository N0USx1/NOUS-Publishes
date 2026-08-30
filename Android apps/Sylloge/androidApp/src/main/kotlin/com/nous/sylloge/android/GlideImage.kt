package com.nous.sylloge.android

import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import com.bumptech.glide.Glide
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 用 Glide 取图。
 *
 * ⚠️ 为什么引库（2026-08-25 查证）：官方那页原话是「**我们推荐 Glide**」——
 * 手写要自己对四件事：两趟解码拿尺寸、按需降采样、位图复用、内存/磁盘缓存。
 * 每一件写错都表现为「偶尔崩」或「越用越卡」，而这两种最难查。
 * （今天刚因为一次内存判断失误 OOM 崩过一次。）
 *
 * ⚠️ 引它之前查过：Glide `library/` 模块**根本没有 AndroidManifest.xml**，
 * 不会带联网权限进来。⛔ 但那不是防线 —— 防线是 build.gradle.kts 里那道构建期断言。
 *
 * ⛔ 这替掉了原来手写的 `LruCache<String, ImageBitmap>(200)`：
 * **按条数计对位图是错的**（一张 192² ARGB8888 ≈ 147KB，尺寸一改就失控），
 * 而且没有磁盘层 ⇒ 每次冷启动全部重新解码。Glide 这三件都做对了。
 */
@Composable
fun rememberImage(model: Any?, px: Int): ImageBitmap? {
    val ctx = LocalContext.current
    var bmp by remember(model, px) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(model, px) {
        if (model == null) { bmp = null; return@LaunchedEffect }
        bmp = withContext(Dispatchers.IO) {
            runCatching {
                Glide.with(ctx).asBitmap().load(model).override(px).submit().get().asImageBitmap()
            }.getOrNull()
        }
    }
    return bmp
}
