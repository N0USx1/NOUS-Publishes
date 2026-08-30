package com.nous.sylloge.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nous.sylloge.ui.FolderConfirmDialog
import com.nous.sylloge.ui.FolderFocusList
import com.nous.sylloge.ui.ImageSlot

/** 图片插槽：把 Glide 喂给纯 UI 层。⛔ 纯 UI 层不认识 Uri，也不认识 Glide。 */
val glideSlot: ImageSlot = { model, modifier, px ->
    val b = rememberImage(model, px)
    if (b != null) {
        androidx.compose.foundation.Image(
            b, null, modifier,
            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
        )
    } else Box(modifier)
}

/**
 * 下卡唯一一页（P5）：文件夹焦点列表 + 「备份此文件夹」确认弹窗。
 * ⛔ 没有图库：不进文件夹、不看大图、不多选（Nous：「产品的设定不能模拟图库」）。
 */
@Composable
fun FolderDeckPane(vm: FolderDeckViewModel = viewModel()) {
    LaunchedEffect(Unit) { vm.load() }

    // 系统返回：弹窗开着就先关弹窗，⛔ 不直接退 app
    BackHandler(enabled = vm.dialog != null) { vm.close() }

    FolderFocusList(
        rows = vm.rows,
        image = glideSlot,
        onToggle = { vm.toggle(it) },
        onOpen = { vm.open(it) },
        onAll = { vm.setAll(it) },
    )

    vm.dialog?.let { d ->
        FolderConfirmDialog(
            folder = d.folder,
            photos = d.photos,
            image = glideSlot,
            copyingName = vm.copyingName,
            onConfirm = { vm.toggle(d.folder); vm.close() },
            onDismiss = { vm.close() },
        )
    }
}
