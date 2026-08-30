package com.nous.sylloge.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.storage.StorageManager
import android.util.Log
import androidx.documentfile.provider.DocumentFile

const val TAG = "Sylloge"

/**
 * U 盘访问的全部平台细节。上层只看到「选一个树 / 授权还在不在 / 能不能写 / 叫什么名」。
 *
 * ⚠️ 2026-08-25 收拢：控制台时代的探针（writeProbe / auditTree / listProbes /
 * describeTree）与没人调的 release **已删** —— 它们的知识早已落进
 * `docs/roadmap.md` M1–M4 和 cortex 的 android/pitfalls.md。
 */
object UsbAccess {

    /** 取长期读写授权用的 flag 组合，取和还都必须一致，否则 takePersistable 会抛。 */
    private const val RW = Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    /**
     * 造选目录的 Intent。优先把选择器直接开在可移动卷（U 盘）上，
     * 但系统只把它当「建议」——用户仍可能选别处，所以返回的 Uri 必须照单接受。
     */
    fun buildPickIntent(ctx: Context): Intent {
        val sm = ctx.getSystemService(StorageManager::class.java)
        val removable = sm.storageVolumes.firstOrNull { it.isRemovable }
        val intent = removable?.createOpenDocumentTreeIntent()
            ?: Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        intent.addFlags(RW or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        Trace.i("buildPickIntent: removable=${removable?.getDescription(ctx)}")
        return intent
    }

    /** 拿到结果后必须立刻 take，否则进程一死授权就没了。 */
    fun persist(ctx: Context, uri: Uri): Result<Unit> = runCatching {
        ctx.contentResolver.takePersistableUriPermission(uri, RW)
        Trace.i("persist: took persistable permission on $uri")
    }

    /** 系统里当前还留着的长期授权——重启 app 后读这个，就能证明②真的成了。 */
    fun persisted(ctx: Context): List<PersistedGrant> =
        ctx.contentResolver.persistedUriPermissions.map {
            PersistedGrant(
                uri = it.uri,
                canRead = it.isReadPermission,
                canWrite = it.isWritePermission,
                takenAtEpochMs = it.persistedTime,
            )
        }

    /**
     * 目标盘现在到底能不能用。
     *
     * ⚠️ **长期授权在拔盘之后依然存在** —— 系统记的是"这个 app 对那个卷有权限"，
     * 卷拔了记录还在。所以「有授权」**不等于**「盘在」，每次动手前必须实测。
     * 不区分的话，用户拔了盘再打开 app 会看到「还没有备份目录」，
     * ⛔ 以为自己的备份没了。
     */
    fun checkAccess(ctx: Context, treeUri: Uri): Access {
        val doc = DocumentFile.fromTreeUri(ctx, treeUri)
            ?: return Access.NotMounted(volumeLabel(ctx, treeUri))
        if (!doc.exists()) return Access.NotMounted(volumeLabel(ctx, treeUri))
        if (!doc.canWrite()) return Access.ReadOnly(doc.name ?: "?")
        return Access.Ok(doc.name ?: "?")
    }

    /**
     * 从 tree Uri 里取卷 ID（比如 `A0F5-37E5`）。
     * ⭐ 这是**多 U 盘的身份证** —— catalog 的判重全靠它隔离。
     */
    fun volumeIdOf(treeUri: Uri): String =
        treeUri.lastPathSegment?.substringBefore(':') ?: "unknown"

    /** 从 tree Uri 里刨出卷 ID，再去 StorageManager 找它的人话名字（比如「NOUS sync」）。 */
    private fun volumeLabel(ctx: Context, treeUri: Uri): String {
        val volId = treeUri.lastPathSegment?.substringBefore(':') ?: return "U 盘"
        val sm = ctx.getSystemService(StorageManager::class.java)
        val vol = sm.storageVolumes.firstOrNull { it.uuid.equals(volId, ignoreCase = true) }
        return vol?.getDescription(ctx) ?: ("U 盘 " + volId)
    }

    /**
     * 给界面用的人话名字：优先系统里的卷名（「NOUS sync」），退回目录名。
     * ⚠️ 2026-08-25 之前这里显示的是取证串（"A0F5-37E5 可写=true 子项=19"），
     * 那个 describeTree 已随控制台一起删掉 —— ⛔ 别再往界面上塞调试字符串。
     */
    fun displayName(ctx: Context, uri: Uri): String {
        val volId = uri.lastPathSegment?.substringBefore(':')
        if (!volId.isNullOrEmpty()) {
            val sm = ctx.getSystemService(StorageManager::class.java)
            sm.storageVolumes.firstOrNull { it.uuid.equals(volId, ignoreCase = true) }
                ?.getDescription(ctx)?.let { return it }
        }
        return DocumentFile.fromTreeUri(ctx, uri)?.name ?: "U 盘"
    }
}

/** 目标盘的可用状态。⛔ 不要用一个 Boolean 概括 —— "不可写"和"盘没插"要给出完全不同的提示。 */
sealed interface Access {
    data class Ok(val name: String) : Access
    data class ReadOnly(val name: String) : Access
    data class NotMounted(val label: String) : Access
}

data class PersistedGrant(
    val uri: Uri,
    val canRead: Boolean,
    val canWrite: Boolean,
    val takenAtEpochMs: Long,
)
