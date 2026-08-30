package com.nous.sylloge.ui

import androidx.annotation.StringRes
import com.nous.sylloge.android.R
import androidx.compose.ui.graphics.Color

/**
 * ⛔⛔ **这个包（`com.nous.sylloge.ui`）里不许 import `android.*`。**
 *
 * 界面层只吃「纯数据 + 回调」，MediaStore / SAF / WorkManager / 通知
 * 一律由外面喂进来（`docs/core-spec.md` §6.1）。
 *
 * 这样做的三个回报：迭代能用 `@Preview` 不装机；M11 的 Windows 查看器直接复用；
 * 而且它逼着我们把「引擎会产生哪些状态」显式写出来 —— 就是下面这个 sealed interface。
 */

/**
 * 准备阶段的步骤。Nous 2026-08-25 给的序列。
 *
 * ★ 这一段是**用户唯一能理解「为什么还没开始」的地方**。
 * 缺了它，插上盘到开始拷之间就是一个黑箱，用户只会觉得卡住了。
 */
enum class PrepStep(@StringRes val labelRes: Int) {
    WaitUsb(R.string.step_wait_usb),
    UsbFound(R.string.step_usb_found),
    Checking(R.string.step_checking),
    VerifySet(R.string.step_verify_set),
    ReadLog(R.string.step_read_log),
    Collect(R.string.step_collect),
    Prepared(R.string.step_prepared),
    AwaitConfirm(R.string.step_await_confirm),
}

/** 准备阶段卡住时，那颗按钮该干什么。 */
enum class PrepFix {
    /** 再走一遍流程（盘没插、临时错误）。 */
    Retry,
    /** 去拉 SAF 选 U 盘。 */
    PickUsb,
    /** ⭐ 去要**完整的**照片权限 —— 用户当前只给了"部分照片"。 */
    PhotoPermission,
}

/** 某一步当下的样子。 */
enum class StepPhase { Pending, Active, Done, Failed }

data class PrepLine(val step: PrepStep, val phase: StepPhase, val detail: String = "")

/**
 * 上卡的全部状态。**UI 只认这个，⛔ 不认引擎里的类型。**
 *
 * ⚠️ 这张清单必须覆盖 `core-spec.md` §4 的每一行 ——
 * 漏掉的那个就是用户会卡住的地方。
 */
sealed interface DeckState {

    /**
     * 准备阶段：字在往下滚。
     * `fix` = **这一步失败了该点什么去修**。⛔ 别让界面靠"第几行失败了"去猜 ——
     * 那是把决定藏在下标里，加一步就全错（2026-08-25 加照片权限那条时定）。
     */
    data class Preparing(val lines: List<PrepLine>, val fix: PrepFix = PrepFix.Retry) : DeckState

    /** 准备完成 ⇒ ★**整张卡变绿，自己就是确认按钮**。 */
    data class Ready(
        /** ⚠️ 分开报：照片 / 视频（Nous 2026-08-25）。`newCount` 是派生量。 */
        val newPhotos: Int,
        val newVideos: Int,
        val newBytes: Long,
        val skipPhotos: Int,
        val skipVideos: Int,
        val target: String,
        /**
         * ⚠️ **0 张新的有两个完全不同的原因**，⛔ 不许用同一句话打发：
         * ①真的都备份过了 ②**一个文件夹都没勾**。
         * 后者说"已全部备份"是**假话** —— 用户会以为东西已经在盘上了（2026-08-25 真机抓到）。
         */
        val nothingSelected: Boolean = false,
    ) : DeckState {
        val newCount: Int get() = newPhotos + newVideos
        val skipCount: Int get() = skipPhotos + skipVideos
    }

    /**
     * 拷贝中 ⇒ ★**整张卡就是进度条**，填充横扫整张卡。
     * `accent` 从当前正在拷的那张照片采出来，⛔ 逐张跳会闪，外面要补间。
     */
    data class Running(
        val done: Int,
        val total: Int,
        val currentName: String,
        val fileFraction: Float,
        val accent: Color?,
    ) : DeckState

    data class Done(val copied: Int, val skipped: Int, val failed: Int) : DeckState

    /** ⚠️ 掉盘 / 只读 / 引擎报错，都落这里。带原因，⛔ 不许只说"失败了"。 */
    data class Failed(val reason: String) : DeckState

    /**
     * ⚠️ **平台逼出来的状态**：Android 12+ 禁止后台启动前台服务
     * ⇒ 被系统杀掉的长任务**无法静默恢复**。
     * ★ 正确行为是**下次打开时告诉用户**，⛔ 不是偷偷重试。数据是安全的。
     */
    data class NeedsResume(val done: Int, val total: Int) : DeckState

    /**
     * ⭐⭐ **看不到全部照片** ⇒ 整张卡爆红，卡本身就是「重新申请权限」按钮
     * （Nous 2026-08-25 定：⛔ 不许缩进准备流程里当一行小字 —— 那行会被右边夹掉，
     * 而且这件事严重到不该和「某一步失败」长得一样）。
     *
     * ⚠️ **两种情况必须分开说**：
     * - `partial = true`：Android 14 的「仅选中的照片」。MediaStore **不报错，只是少返回几千张**
     *   ⇒ 对备份 app 是**致命的沉默失败**，⛔ 绝不能显示成「没有照片」或「备份完成」。
     * - `partial = false`：一张都读不到。
     */
    data class NoPhotoPermission(val partial: Boolean) : DeckState
}
