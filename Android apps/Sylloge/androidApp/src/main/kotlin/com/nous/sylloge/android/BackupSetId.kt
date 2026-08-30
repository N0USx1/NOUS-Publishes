package com.nous.sylloge.android

import android.content.Context
import com.nous.sylloge.SetIdentity
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * L2 修复：备份集身份判定原来在 DeckViewModel / GalleryViewModel / CatalogPane
 * **各抄了一份** —— cortex Z 向内「抄一份 = 造一个会腐坏的副本」，三处必走散。
 * ⇒ 收拢成一处，三个调用点全部改成调这里。
 */
object BackupSetId {
    /** 当前 U 盘上的备份集 id；没插盘 / 没授权 / 全新盘 = 空串。 */
    fun current(ctx: Context, db: CatalogDb): String {
        val t = UsbAccess.persisted(ctx).firstOrNull()?.uri ?: return ""
        return when (val id = BackupSetStore.identify(ctx, t, db.knownSetIds())) {
            is SetIdentity.Known -> id.marker.setId
            is SetIdentity.Foreign -> id.marker.setId
            else -> ""
        }
    }
}

/**
 * 本次备份允许的文件夹集合 —— **口径的唯一出处**（P2 修复，2026-08-25）。
 *
 * 原来 DeckViewModel 和 BackupWorker 各算一套，Worker 那套还是错的：
 * `folderPrefs().filterValues{it}.keys.ifEmpty{null}` —— 用户没动过文件夹页时
 * prefs 是空表 → null → **全量 7370 张都拷**，而卡上按 DCIM 默认写着 4205。
 * DeckViewModel 那套的 `ifEmpty{null}` 也反转：**全不勾 → 空集 → null → 变成全选**。
 *
 * ⛔ 永远返回真集合，不用 null 表示"不过滤"——空集的正确语义就是「一张不备份」。
 */
object FolderFilter {
    fun allowed(db: CatalogDb, source: PhotoSource): Set<String> {
        val prefs = db.folderPrefs()
        return source.folderStats()
            .map { it.path }
            .filter { prefs[it] ?: com.nous.sylloge.FolderDefaults.defaultEnabled(it) }
            .toSet()
    }
}

/**
 * L1 修复：文件夹勾选变化的**唯一事件源**。
 *
 * 原来两张卡各自养数据互不知道：上卡第 2 页勾掉一个文件夹，
 * 上卡的「4205 张新的」和下卡的角标**都不会变** —— 用户勾了没反应 = 以为坏了。
 * ⇒ 谁改 folder_pref 谁 bump()；DeckVM 和 GalleryVM 都听它重载。
 */
object FolderPrefsBus {
    val version = MutableStateFlow(0)
    fun bump() { version.value += 1 }
}
