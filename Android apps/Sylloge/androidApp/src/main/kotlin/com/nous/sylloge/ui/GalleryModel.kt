package com.nous.sylloge.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * ⛔ 这个包不许 import `android.*`。图片怎么取由外面喂进来 ——
 * 这就是那个插槽：`model` 是不透明的（安卓侧是 Uri），UI 层不认识它，只负责传下去。
 * ⇒ 桌面端（M11 的 Windows 查看器）换一个实现就能复用整套界面。
 */
typealias ImageSlot = @Composable (model: Any?, modifier: Modifier, px: Int) -> Unit

/**
 * 一个文件夹行。⚠️ **拍平一层** —— 嵌套路径各自是一行，⛔ 没有"进了再进"。
 * （P5 之后 app 里已没有图库：这行喂给焦点列表 + 4×4 确认弹窗。）
 */
data class GalleryFolder(
    val path: String,
    /** ⚠️ **照片和视频分开数**（Nous 2026-08-25）——⛔ 别合成一个"多少项"。 */
    val photos: Int,
    val videos: Int,
    val bytes: Long,
    val enabled: Boolean,
    /** 行首缩略图（取第一张）。空列表 = 画底色壳。 */
    val covers: List<Any>,
) {
    val count: Int get() = photos + videos
}

/** 弹窗网格里的一格：缩略图 + 五态角标。 */
data class GalleryPhoto(
    val id: String,
    val model: Any,
    val badge: BadgeState,
    /** 文件名 —— 用来和"引擎正在拷的那张"对上，好把角标变成 🟡。 */
    val name: String = "",
)
