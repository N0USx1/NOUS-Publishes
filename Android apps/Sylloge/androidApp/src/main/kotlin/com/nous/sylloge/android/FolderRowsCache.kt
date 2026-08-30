package com.nous.sylloge.android

import android.content.Context
import android.net.Uri
import com.nous.sylloge.ui.GalleryFolder
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * ★★ **下卡文件夹列表的跨进程缓存**（Nous 2026-08-26 报的卡顿）。
 *
 * 为什么必须有它：`AllFilesSource` 的扫描缓存在 companion 里，是**进程级**的 ——
 * 进程一死就没了。于是**每次冷启动**下卡都要等一趟全盘遍历（实测 1–4 秒）才有内容，
 * 用户每天打开 app 的第一眼永远是空白 + 卡顿。
 *
 * ⇒ 把**渲染好的行**（文件夹名/张数/体积/封面路径）落盘。冷启动先毫秒级显示上次的，
 * 真扫描照旧在后台跑、跑完替换并重新落盘。
 *
 * ## 三条边界，别越
 * - ⛔ **这是显示缓存，不是数据源**：备份引擎的取数（collect / enumerate）
 *   永远走真扫描 —— 陈旧列表在屏幕上顶多难看一秒，进了备份就是**漏拷**。
 * - ⚠️ `enabled`（勾选）**不落盘**：它的正本在 [CatalogDb.folderPrefs]，
 *   读缓存时用当次的 prefs 重算 —— 抄一份 = 造一个会腐坏的副本。
 * - ⚠️ 文件放 `cacheDir`：系统清掉它无非回到"第一次打开慢"，语义正好。
 */
object FolderRowsCache {

    /** 结构变了就 bump —— 旧文件读不懂时**当没有**，⛔ 不迁移显示缓存。 */
    private const val VERSION = 1

    private fun file(ctx: Context) = File(ctx.cacheDir, "folder_rows.json")

    /** 真扫描出结果后调。⚠️ IO 线程。 */
    fun save(ctx: Context, rows: List<GalleryFolder>) {
        runCatching {
            val arr = JSONArray()
            rows.forEach { r ->
                arr.put(JSONObject().apply {
                    put("path", r.path)
                    put("photos", r.photos)
                    put("videos", r.videos)
                    put("bytes", r.bytes)
                    // 封面存 Uri 字符串（file:// 或 content:// 都一样存）。
                    // 读回来若文件已删，Glide 画底色壳，真数据马上会替换 —— 可接受。
                    put("covers", JSONArray().apply { r.covers.forEach { put(it.toString()) } })
                })
            }
            val root = JSONObject().apply {
                put("v", VERSION)
                put("rows", arr)
            }
            file(ctx).writeText(root.toString())
        }.onFailure { Trace.w("下卡缓存写入失败（无害，下次冷启动慢一点）", it) }
    }

    /**
     * 冷启动读上次的行。读不到/读不懂返回 null。
     * ⚠️ `enabled` 一律先填 false —— 调用方**必须**用当次 prefs 重算再上屏。
     */
    fun load(ctx: Context): List<GalleryFolder>? = runCatching {
        val f = file(ctx)
        if (!f.exists()) return null
        val root = JSONObject(f.readText())
        if (root.optInt("v") != VERSION) return null
        val arr = root.getJSONArray("rows")
        val out = ArrayList<GalleryFolder>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val covers = ArrayList<Any>(3)
            val ca = o.getJSONArray("covers")
            for (j in 0 until ca.length()) covers += Uri.parse(ca.getString(j))
            out += GalleryFolder(
                path = o.getString("path"),
                photos = o.getInt("photos"),
                videos = o.getInt("videos"),
                bytes = o.getLong("bytes"),
                enabled = false,
                covers = covers,
            )
        }
        out
    }.getOrElse { Trace.w("下卡缓存读取失败（当没有）", it); null }
}
