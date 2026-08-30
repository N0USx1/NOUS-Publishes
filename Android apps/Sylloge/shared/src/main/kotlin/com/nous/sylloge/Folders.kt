package com.nous.sylloge

/**
 * 一个文件夹的统计。UI 上一行就是一个它。
 * ⚠️ **照片和视频分开数**（Nous 2026-08-25：「需要说明多少照片 多少个视频」）——
 * ⛔ 别合成一个"多少项"，那样用户看不出 22.9 GB 里有多少是视频。
 * ⚠️ 2026-08-25 重写：旧版是 `photoCount/totalBytes/enabled`，**从来没人用过**
 * （勾选状态在 GalleryFolder 上，不该塞进统计里）。
 */
data class FolderStat(
    /** 相对路径，形如 `DCIM/Camera`。顶层散文件归到 `(根目录)` */
    val path: String,
    val photos: Int,
    val videos: Int,
    val bytes: Long,
) {
    val count: Int get() = photos + videos
}

/**
 * 默认勾选规则。
 *
 * ⭐ **判据不是"哪个文件夹照片多"，而是"哪些照片没有第二个副本"**（Nous 2026-08-24）：
 *  · WhatsApp / Telegram / 微信 —— 源 app 自己就在备份，我们再存一份是重复劳动
 *  · 截图 / Download / 转发图 —— 大多可再生
 *  · **相机原片是唯一没人管的那一份**，手机丢了就真没了
 *
 * ⚠️ 这只是**初始状态**，不是限制。全部文件夹都会扫出来摆给用户看，用户随时可改。
 */
object FolderDefaults {

    // 默认勾上的前缀：DCIM 及其所有子目录（DCIM/Restored 那种也是用户的真照片）。
    // ⚠️ 这里刻意用行注释：Kotlin 的块注释**可以嵌套**，
    //    在块注释里写 "DCIM/" 加两个星号会开一个内层注释，把整个文件吃掉。
    private val DEFAULT_ON_PREFIXES = listOf("DCIM")

    fun defaultEnabled(path: String): Boolean =
        DEFAULT_ON_PREFIXES.any { path == it || path.startsWith("$it/") }

    /** 顶层散文件的归属名。⚠️ 别用空串，UI 上会显示成一行空白。 */
    const val ROOT_BUCKET = "(根目录)"
}

// ⚠️ 2026-08-25 删掉了 `SelectionSummary` / `summarize()`：
//    app 里**零引用**，而且它们依赖 FolderStat 上那个已经不存在的 `enabled` 字段
//    （勾选状态在 GalleryFolder 上）。⛔ 不留形状已经错了的死代码。

