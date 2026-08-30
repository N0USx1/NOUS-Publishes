package com.nous.sylloge.android

import android.content.Context

/**
 * 几个全局开关。
 * ⛔ 刻意**不放进 catalog.db** —— 那张库是「哪些文件已经在盘上」的账本，
 * 和"用户偏好"是两件事；混在一起的话，将来导入别人的 catalog 会把偏好也一起带过来。
 */
object AppPrefs {

    private const val FILE = "sylloge-prefs"
    private const val K_HIDE = "hide_nomedia_folders"

    private fun sp(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * 要不要**隐藏 `.nomedia` 目录**。**默认 true。**
     *
     * ★ 命名与默认值都是 Nous 2026-08-25 定的：
     * 「hide .nomedia folders = on。你现在是做成了 unhide the hidden = off，
     * 用户逻辑是有问题的**双层否定**」。
     * ⇒ ⛔ **开关的名字要直说它在做什么**（"隐藏 X"），
     * ⛔ 不要写成"显示被隐藏的 X"再默认关 —— 那要用户在脑子里绕两道否定。
     *
     * 语义：带 `.nomedia` 的目录，作者的意思就是「这不是给相册看的」——
     * 绝大多数是各家 app 的内部缓存（WhatsApp 那一堆）。
     * 保留关掉的能力（刻意藏起来的相册确实有人要备份），但**默认站在"少即是对"那边**。
     */
    fun hideNomedia(ctx: Context): Boolean = sp(ctx).getBoolean(K_HIDE, true)

    fun setHideNomedia(ctx: Context, on: Boolean) {
        sp(ctx).edit().putBoolean(K_HIDE, on).apply()
        // ⛔ **这里不要 invalidate 扫描缓存。** 过滤发生在"取用"那一步
        //    （AllFilesSource.visible()），缓存里存的是**全部**结果 + 哪些属于 .nomedia 子树，
        //    两者都与这个开关无关 ⇒ 翻开关只要重新读一遍缓存。
        //    ⚠️ 第一版顺手调了 invalidate，结果每翻一次开关整棵树重扫 **3.6 秒**（实测）。
        FolderPrefsBus.bump()
    }
}
