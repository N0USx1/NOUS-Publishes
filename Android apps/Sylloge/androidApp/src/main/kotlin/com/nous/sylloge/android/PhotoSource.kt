package com.nous.sylloge.android

import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import com.nous.sylloge.FolderDefaults
import com.nous.sylloge.FolderStat
import com.nous.sylloge.PhotoItem

/**
 * 照片来源。**上层只认这个接口**，实现可以换：
 *
 *  - [MediaStoreSource]  开发期用。READ_MEDIA_IMAGES 就够，能枚举全机图片
 *  - AllFilesSource      发布用。MANAGE_EXTERNAL_STORAGE，能补上 .nomedia 目录（M7）
 *  - PickerSource        兜底。Photo Picker，零权限但要用户手选
 *
 * 换实现时上层一行不用改 —— 这是 M7 权限切换能低风险落地的前提。
 */
interface PhotoSource {
    /**
     * @param limit 取前 N 张；<=0 表示不限量。
     * @param allowedFolders 只要这些文件夹里的。null = 不过滤。
     *   ⚠️ 过滤发生在**游标遍历阶段**，被排除的项根本不会进入后面的判重 ——
     *   7370 张时这是几秒和十几秒的差别。
     */
    fun enumerate(limit: Int, allowedFolders: Set<String>? = null): List<PhotoItem>

    /** 扫出手机上**全部**照片文件夹的统计（不受勾选影响 —— 没勾的也要摆给用户看）。 */
    fun folderStats(): List<FolderStat>

    /** 拿一张图的缩略图 Uri，UI 用来渲染。 */
    fun thumbnailUri(item: PhotoItem): Uri

    /** 原图本体的 Uri，拷贝时从这里读字节。 */
    fun contentUri(item: PhotoItem): Uri

    /** MIME，建目标文件时要用。拿不到就退回 application/octet-stream。 */
    fun mimeType(item: PhotoItem): String
}

/**
 * **取哪条路，只在这里决定一次。**
 *
 * 有「所有文件访问」就走 [AllFilesSource]（Nous 2026-08-25 拍板的发布形态），
 * 没有就退回 [MediaStoreSource] —— 后者看不见 `.nomedia` 里的东西，但至少 app 能用。
 *
 * ⛔ **别在调用点各 new 各的**：那样「到底在用哪条路」会分叉，
 * 诊断包报的和引擎真跑的可能不是同一个（口径不同源）。
 */
fun photoSourceOf(ctx: Context): PhotoSource =
    if (AllFilesSource.hasAccess()) AllFilesSource(ctx) else MediaStoreSource(ctx)

/** 相对目录 -> UI 上的文件夹键。顶层散文件归到一个显式的桶，别用空串。 */
private fun folderKey(dir: String): String =
    if (dir.isEmpty()) FolderDefaults.ROOT_BUCKET else dir

class MediaStoreSource(private val ctx: Context) : PhotoSource {

    // ★ **图片 + 视频**（Nous 2026-08-25：「视频需要支持」）⇒ 查 `Files` 集合并按
    //   media_type 过滤，⛔ 不是查 Images 再查 Video 拼起来（两个游标要自己合并排序，
    //   而且 id 分属两个命名空间，contentUri 会指错）。
    // ⚠️ 视频要**单独的 READ_MEDIA_VIDEO 权限** —— 只加 URI 是看不见的。
    private val collection: Uri = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)

    private val mediaOnly = MediaStore.Files.FileColumns.MEDIA_TYPE + " IN (?,?)"
    private val mediaArgs = arrayOf(
        MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
        MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
    )

    private val projection = arrayOf(
        MediaStore.Files.FileColumns._ID,
        MediaStore.Files.FileColumns.DISPLAY_NAME,
        MediaStore.Files.FileColumns.RELATIVE_PATH,
        MediaStore.Files.FileColumns.SIZE,
        MediaStore.Files.FileColumns.DATE_MODIFIED,
        MediaStore.Files.FileColumns.MEDIA_TYPE,
    )

    override fun enumerate(limit: Int, allowedFolders: Set<String>?): List<PhotoItem> {
        val args = Bundle().apply {
            putStringArray(
                ContentResolver.QUERY_ARG_SORT_COLUMNS,
                arrayOf(MediaStore.Files.FileColumns.DATE_MODIFIED),
            )
            // ⚠️ Files 集合里什么都有（文档、下载的 apk…）⇒ **必须**按 media_type 过滤
            putString(ContentResolver.QUERY_ARG_SQL_SELECTION, mediaOnly)
            putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, mediaArgs)
            putInt(
                ContentResolver.QUERY_ARG_SORT_DIRECTION,
                ContentResolver.QUERY_SORT_DIRECTION_DESCENDING,
            )
            // ⚠️ 只有**不按文件夹过滤**时才能用 SQL 层的 LIMIT。
            //    过滤在 Kotlin 层做，SQL 先截断会变成"最新 N 张里恰好有几张属于选中目录"，
            //    而正确语义是"**选中目录里的前 N 张**"。
            //    实测踩过：勾了 DCIM、样本选 5，结果只拿到 1 张。
            if (limit > 0 && allowedFolders == null) {
                putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
            }
        }

        // ⚠️⚠️ **`ArrayList(n)` 的参数是「预留容量」，不是「上限」。**
        // 调用方用 `Int.MAX_VALUE` 当"不限量"的哨兵传进来，这里就会去申请
        // 21 亿 × 4 字节 ≈ **8 GB** → OOM 当场崩（2026-08-25 实测，主 app 起不来）。
        // ⇒ 容量只是个提示，给个合理上限就行；⛔ 别把外面传进来的数字直接当容量。
        val out = ArrayList<PhotoItem>(limit.coerceIn(0, 4096).coerceAtLeast(64))
        ctx.contentResolver.query(collection, projection, args, null)?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val iName = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val iRel = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH)
            val iSize = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
            val iMod = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED)
            val iType = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
            while (c.moveToNext()) {
                val name = c.getString(iName) ?: continue
                // RELATIVE_PATH 形如 "DCIM/Camera/"，可能为 null（顶层散落的文件）
                val dir = (c.getString(iRel) ?: "").trim('/')
                if (allowedFolders != null && folderKey(dir) !in allowedFolders) continue
                out += PhotoItem(
                    id = c.getLong(iId).toString(),
                    relativePath = if (dir.isEmpty()) name else "$dir/$name",
                    displayName = name,
                    sizeBytes = c.getLong(iSize),
                    modifiedEpochSec = c.getLong(iMod),
                    isVideo = c.getInt(iType) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO,
                )
                // 过滤模式下 SQL 没截断，这里凑够数就停
                if (limit > 0 && allowedFolders != null && out.size >= limit) break
            }
        }
        Trace.i("MediaStoreSource.enumerate(limit=$limit) -> ${out.size} 张")
        return out
    }

    override fun folderStats(): List<FolderStat> {
        val photos = HashMap<String, Int>()
        val videos = HashMap<String, Int>()
        val bytes = HashMap<String, Long>()
        ctx.contentResolver.query(
            collection,
            arrayOf(
                MediaStore.Files.FileColumns.RELATIVE_PATH,
                MediaStore.Files.FileColumns.SIZE,
                MediaStore.Files.FileColumns.MEDIA_TYPE,
            ),
            mediaOnly, mediaArgs, null,
        )?.use { c ->
            val iRel = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH)
            val iSize = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
            val iType = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
            while (c.moveToNext()) {
                val k = folderKey((c.getString(iRel) ?: "").trim('/'))
                if (c.getInt(iType) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
                    videos[k] = (videos[k] ?: 0) + 1
                else photos[k] = (photos[k] ?: 0) + 1
                bytes[k] = (bytes[k] ?: 0L) + c.getLong(iSize)
            }
        }
        val keys = photos.keys + videos.keys
        Trace.i("folderStats: " + keys.size + " 个文件夹")
        return keys.map { k ->
            FolderStat(k, photos[k] ?: 0, videos[k] ?: 0, bytes[k] ?: 0L)
        }.sortedByDescending { it.count }
    }

    override fun thumbnailUri(item: PhotoItem): Uri = contentUri(item)

    // ⚠️ id 现在来自 Files 集合 ⇒ 必须用同一个集合拼 Uri，⛔ 别再拿 Images 的基址
    override fun contentUri(item: PhotoItem): Uri =
        android.content.ContentUris.withAppendedId(collection, item.id.toLong())

    override fun mimeType(item: PhotoItem): String =
        ctx.contentResolver.getType(contentUri(item)) ?: "application/octet-stream"

    companion object {
        /**
         * 运行时要申请的权限。API 33 起按类型拆开，之前是一个 READ_EXTERNAL_STORAGE。
         * ⚠️ **视频必须单独申请 `READ_MEDIA_VIDEO`** —— 只有 IMAGES 的话，
         * 查 Files 集合也一个视频都看不见（2026-08-25 加视频支持时的前提）。
         */
        /**
         * ⭐⭐ **能看到全部照片，还是只看到用户挑的那几张。**
         *
         * Android 14 起，用户可以选「允许有限访问」，只把**挑中的几张**给 app：
         * 系统会授予 `READ_MEDIA_VISUAL_USER_SELECTED`，同时**拒掉** IMAGES / VIDEO。
         *
         * ⛔⛔ 这对一个**备份 app 是致命的沉默失败**：MediaStore 查询不报错、不抛异常，
         * 只是**安静地少返回几千张**。2026-08-25 真机实测：只留部分授权时
         * `folderStats` 返回 **0 个文件夹**，而上卡照样写「备份完成」——
         * 用户会以为东西已经在盘上了。
         * ⇒ **必须显式探测并在界面上说出来**，⛔ 不许当成"没有照片"。
         */
        fun access(ctx: Context): MediaAccess {
            // 有「所有文件访问」就一定看得到全部 —— 它盖过 READ_MEDIA_* 那一套，
            // 也正是切过去的收益之一：**权限从三个变一个**。
            if (AllFilesSource.hasAccess()) return MediaAccess.Full
            fun ok(p: String) = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                return if (ok(android.Manifest.permission.READ_EXTERNAL_STORAGE))
                    MediaAccess.Full else MediaAccess.None
            }
            val full = ok(android.Manifest.permission.READ_MEDIA_IMAGES) &&
                ok(android.Manifest.permission.READ_MEDIA_VIDEO)
            if (full) return MediaAccess.Full
            // ⚠️ 这个常量 API 34 才有 ⇒ 用字符串，⛔ 别引符号（minSdk 30 编不过）
            if (Build.VERSION.SDK_INT >= 34 && ok("android.permission.READ_MEDIA_VISUAL_USER_SELECTED"))
                return MediaAccess.Partial
            // 只给了图片没给视频（或反过来）也算残缺 —— 视频会被静默漏掉
            if (ok(android.Manifest.permission.READ_MEDIA_IMAGES) ||
                ok(android.Manifest.permission.READ_MEDIA_VIDEO)) return MediaAccess.Partial
            return MediaAccess.None
        }

        val REQUIRED_PERMISSIONS: Array<String> =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
                arrayOf(
                    android.Manifest.permission.READ_MEDIA_IMAGES,
                    android.Manifest.permission.READ_MEDIA_VIDEO,
                )
            else
                arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE)
    }
}

/**
 * app 能看到多少照片。
 * ⛔ **不要用一个 Boolean 概括** —— "看得到全部"和"只看得到几张"要给出完全不同的提示，
 * 后者若当成前者，用户会带着"备份完成"的错觉丢掉几千张（和 [Access] 是同一条道理）。
 */
enum class MediaAccess { Full, Partial, None }
