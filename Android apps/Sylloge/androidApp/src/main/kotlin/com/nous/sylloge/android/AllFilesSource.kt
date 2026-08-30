package com.nous.sylloge.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import android.webkit.MimeTypeMap
import com.nous.sylloge.FolderDefaults
import com.nous.sylloge.FolderStat
import com.nous.sylloge.PhotoItem
import java.io.File

/**
 * 直接走文件系统的照片来源（需要「所有文件访问」MANAGE_EXTERNAL_STORAGE）。
 *
 * ★ 这是**一开始就设计好的发布形态**（见 [PhotoSource] 的注释：MediaStoreSource 标着
 * 「开发期用」），2026-08-25 Nous 拍板切过来，此前从没写过。
 *
 * 为什么值得换（三条都是实测出来的，⛔ 不是"应该更好"）：
 * 1. **`.nomedia` 目录里的照片 MediaStore 看不到，File API 看得到**
 *    （同一张图、只差一个 `.nomedia` 的对照实验，2026-08-25）；
 * 2. 不受 MediaStore **索引延迟**影响 —— 刚拷进来还没被扫的文件也在；
 * 3. 直接绕开 Android 14「仅选中的照片」那整片雷区：不再需要 READ_MEDIA_*。
 *
 * ⚠️⚠️ **`relativePath` 必须和 [MediaStoreSource] 逐字节一致**（`DCIM/Camera/IMG.jpg`）——
 * 它是判重 fastKey 的第一个字段。差一个字符 = 全库对不上 = **几十 GB 重传一遍**。
 * 两边都以外置存储根为基准、⛔ 不带前导斜杠、⛔ 不带尾随斜杠。
 */
class AllFilesSource(private val ctx: Context) : PhotoSource {

    private val root: File = Environment.getExternalStorageDirectory()

    /**
     * ⭐⭐ **整棵树只走一趟，结果全进程共用。**
     *
     * File API 和 MediaStore 的根本差别：那边是**索引查询**（每次几毫秒），
     * 这边是**真的遍历文件系统**。2026-08-25 实测：一趟约 **800ms**，
     * 而下卡每个文件夹要取 3 张封面 ⇒ 20 个文件夹就是 20 趟 ≈ **16 秒连续扫盘**。
     * ⛔ 照搬 MediaStore 那种"随手多查一次"的写法，在这条路上是灾难。
     *
     * ⇒ 扫一次缓存起来。⚠️ 缓存放在 companion（**进程级**）——
     * `photoSourceOf()` 每次都 new 一个实例，实例字段缓存等于没缓存。
     * ⚠️ 回到前台时由外面调 [invalidate] 主动作废，⛔ 不靠 TTL 猜用户什么时候拍了新照片。
     */
    private fun scan(): List<PhotoItem> {
        synchronized(LOCK) {
            val now = System.currentTimeMillis()
            val c = cache
            if (c != null && now - cacheAt < TtlMs) return c
        }
        val all = ArrayList<PhotoItem>(4096)
        val t0 = System.currentTimeMillis()
        val hiddenKeys = HashSet<String>()
        walk { f, rel, hidden ->
            if (hidden) hiddenKeys += folderKeyOf(rel.substringBeforeLast('/', ""))
            all += PhotoItem(
                // id = 绝对路径。File 来源没有数据库 id，路径就是它的身份。
                id = f.absolutePath,
                relativePath = rel,
                displayName = f.name,
                sizeBytes = f.length(),
                // 秒，⛔ 不是毫秒 —— MediaStore 的 DATE_MODIFIED 是秒，
                // 单位不一致会让判重 fastKey 全部对不上。
                modifiedEpochSec = f.lastModified() / 1000,
                isVideo = isVideo(f.name),
            )
            true
        }
        // ⚠️ 和 MediaStore 那边一样按修改时间倒序 —— 顺序不同会让"样本 N 张"取到不同的东西
        all.sortByDescending { it.modifiedEpochSec }
        Trace.i("AllFilesSource: 全扫 " + all.size + " 个媒体文件，用时 " + (System.currentTimeMillis() - t0) + " ms")
        synchronized(LOCK) { cache = all; cacheHidden = hiddenKeys; cacheAt = System.currentTimeMillis() }
        return all
    }

    /**
     * 扫描结果**按开关过滤之后**的那一份。
     *
     * ★ 默认把 `.nomedia` 子树滤掉（[AppPrefs.hideNomedia] = true）——
     * Nous 2026-08-25：「什么闲杂的文件夹都有，很多是 WhatsApp 内置的文件夹也抓出来了，
     * 这些是没有必要的数据」。**能抓到 ≠ 该默认抓。**
     *
     * ⚠️ 过滤放在**取用**这一步、⛔ 不放在扫描里：这样翻开关**不用重新扫盘**
     * （一趟 1.1 秒），也不用给缓存加一个"当时是什么开关"的维度。
     */
    private fun visible(): List<PhotoItem> {
        val all = scan()
        if (!AppPrefs.hideNomedia(ctx)) return all
        val hidden = synchronized(LOCK) { cacheHidden }
        if (hidden.isEmpty()) return all
        return all.filter { folderKeyOf(it.relativePath.substringBeforeLast('/', "")) !in hidden }
    }

    override fun enumerate(limit: Int, allowedFolders: Set<String>?): List<PhotoItem> {
        var out = visible().asSequence()
        if (allowedFolders != null) {
            out = out.filter { folderKeyOf(it.relativePath.substringBeforeLast('/', "")) in allowedFolders }
        }
        val list = if (limit > 0) out.take(limit).toList() else out.toList()
        Trace.i("AllFilesSource.enumerate(limit=" + limit + ") -> " + list.size + " 张")
        return list
    }

    override fun folderStats(): List<FolderStat> {
        val photos = HashMap<String, Int>()
        val videos = HashMap<String, Int>()
        val bytes = HashMap<String, Long>()
        visible().forEach { it2 ->
            val k = folderKeyOf(it2.relativePath.substringBeforeLast('/', ""))
            if (it2.isVideo) videos[k] = (videos[k] ?: 0) + 1 else photos[k] = (photos[k] ?: 0) + 1
            bytes[k] = (bytes[k] ?: 0L) + it2.sizeBytes
        }
        val keys = photos.keys + videos.keys
        Trace.i("AllFilesSource.folderStats: " + keys.size + " 个文件夹")
        return keys.map { k -> FolderStat(k, photos[k] ?: 0, videos[k] ?: 0, bytes[k] ?: 0L) }
            .sortedByDescending { it.count }
    }

    override fun thumbnailUri(item: PhotoItem): Uri = contentUri(item)

    /** ⚠️ `file://` 的 Uri。`contentResolver.openInputStream` 认它，引擎那边不用改。 */
    override fun contentUri(item: PhotoItem): Uri = Uri.fromFile(File(item.id))

    override fun mimeType(item: PhotoItem): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext(item.displayName))
            ?: if (item.isVideo) "video/*" else "image/*"

    /**
     * 遍历外置存储，回调每一个照片/视频文件。
     * 回调返回 false = 够了，停止整趟遍历。
     *
     * ⚠️ **迭代而不是递归**：相册目录可以很深，而且遇到符号链接环时递归会栈溢出。
     */
    private inline fun walk(onFile: (File, String, Boolean) -> Boolean) {
        val rootPath = root.absolutePath
        // ★ 第二个分量 = **这个目录是否处在 `.nomedia` 子树里**。
        //   `.nomedia` 的语义是"连同子目录一起，别给相册看" ⇒ 标记要往下传递。
        val stack = ArrayDeque<Pair<File, Boolean>>()
        stack.addLast(root to false)
        val seen = HashSet<String>()
        while (stack.isNotEmpty()) {
            val (dir, parentHidden) = stack.removeLast()
            // ⚠️ 符号链接可能绕回上层 ⇒ 用规范路径去重，⛔ 否则会无限转
            val canon = runCatching { dir.canonicalPath }.getOrElse { dir.absolutePath }
            if (!seen.add(canon)) continue
            if (!canon.startsWith(rootPath)) continue   // 链接指到外面去了，不跟
            val kids = dir.listFiles() ?: continue
            // 本目录自带 .nomedia，或祖先带 ⇒ 整棵子树都算隐藏
            val hidden = parentHidden || kids.any { it.name == NOMEDIA }
            for (f in kids) {
                val name = f.name
                if (f.isDirectory) {
                    if (name in SKIP_DIRS) continue
                    val relDir = f.absolutePath.removePrefix(rootPath).trimStart('/')
                    if (relDir in SKIP_PATHS) continue
                    stack.addLast(f to hidden)
                    continue
                }
                if (!isMedia(name)) continue
                if (SKIP_FILE_PREFIXES.any { name.startsWith(it) }) continue
                val rel = f.absolutePath.removePrefix(rootPath).trimStart('/')
                if (!onFile(f, rel, hidden)) return
            }
        }
    }

    private fun folderKeyOf(dir: String) = if (dir.isEmpty()) FolderDefaults.ROOT_BUCKET else dir

    private fun ext(name: String) = name.substringAfterLast('.', "").lowercase()
    private fun isVideo(name: String) = ext(name) in VIDEO_EXT
    private fun isMedia(name: String) = ext(name).let { it in IMAGE_EXT || it in VIDEO_EXT }

    companion object {

        private val LOCK = Any()
        private var cache: List<PhotoItem>? = null

        /**
         * 上一趟扫描里，**处在 `.nomedia` 子树中**的文件夹键。
         * ⚠️ 和 `cache` 一起产出、一起作废 —— ⛔ 别分两次扫，那样两者会对不上。
         */
        private var cacheHidden: Set<String> = emptySet()
        private var cacheAt = 0L

        /** `.nomedia` 的文件名。目录里有它 = 作者声明"这不是给相册看的"。 */
        const val NOMEDIA = ".nomedia"

        /**
         * 缓存的**兜底**寿命。
         *
         * ⚠️ 真正的作废靠 [invalidate]（回到前台时调）——**用户要拍新照片必须离开本 app**，
         * 回来时就会重扫。所以 TTL 只在"一直停在前台什么都没变"时才起作用。
         * ⚠️ 原来给的 60 秒**太短**：全扫要 1–4 秒，在前台待一分钟就白扫一次
         * （2026-08-25 实测撞到）。⇒ 放宽到 10 分钟。
         */
        private const val TtlMs = 600_000L

        /** 让下一次取数重新扫盘。回到前台、备份结束时调。 */
        fun invalidate() { synchronized(LOCK) { cache = null; cacheHidden = emptySet() } }

        /** 现在有没有「所有文件访问」。 */
        fun hasAccess(): Boolean = Environment.isExternalStorageManager()

        /**
         * 去要这个权限。
         * ⚠️ 它**不是运行时权限弹窗**，是跳到一个系统设置页让用户自己开 ——
         * ⛔ 所以没有 onRequestPermissionsResult 可用，只能回到前台时重新检查
         * （这正是 `ON_RESUME` 重查存在的另一个理由）。
         */
        fun requestIntent(ctx: Context): Intent =
            Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.fromParts("package", ctx.packageName, null),
            )

        /**
         * ⛔ 不进备份的目录。
         * - `Android`：里面是各家 app 的私有数据，**而且 Android 11+ 连全文件权限也读不到
         *   `Android/data` 和 `Android/obb`** —— 白扫一趟还会刷一堆权限拒绝；
         * - `.thumbnails`：系统生成的缩略图缓存，几千个小文件，**备份它毫无意义**；
         * - `cache` / `.cache`：同上。
         */
        val SKIP_DIRS = setOf(".thumbnails", "cache", ".cache")

        /**
         * ⛔⛔ 按**相对路径**排除的子树。
         *
         * ⚠️⚠️ **只排 `Android/data` 和 `Android/obb`，绝不排整个 `Android`** ——
         * `Android/media/` 里是**真的用户照片**：WhatsApp 就把收到的图片放在
         * `Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images`（本机 1254 张）。
         * 2026-08-25 我一开始整个 `Android` 一刀切，结果文件夹数从 **24 掉到 20** ——
         * 全文件权限反而比 MediaStore 看得**少**，那显然是错的。
         * ★ 抓到它靠的是**和旧路径对数字**：换实现之后，两条路的产出要能互相当尺子。
         *
         * `Android/data` 和 `Android/obb` 则是 Android 11+ **连全文件权限也读不到**的，
         * 扫它们纯粹白费时间还刷一堆拒绝。
         */
        val SKIP_PATHS = setOf("Android/data", "Android/obb")

        /**
         * ⛔⛔ 不进备份的文件名前缀。
         * - `.trashed-`：**用户已经删除、还在回收站里的照片**。备份它 = 把用户删掉的东西
         *   又存回去，⛔ 绝对不行；
         * - `.pending-`：正在写入、还没写完的文件，拷过去就是半张图。
         */
        val SKIP_FILE_PREFIXES = listOf(".trashed-", ".pending-")

        val IMAGE_EXT = setOf(
            "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "dng", "avif", "tif", "tiff",
        )
        val VIDEO_EXT = setOf(
            "mp4", "mov", "3gp", "mkv", "webm", "avi", "m4v", "mpg", "mpeg", "ts", "3g2",
        )
    }
}
