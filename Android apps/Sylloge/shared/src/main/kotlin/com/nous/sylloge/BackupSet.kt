package com.nous.sylloge

/**
 * **备份集身份** —— 双层验证的第二层。
 *
 * ## 为什么需要它
 *
 * 第一层是 U 盘的卷 ID（`A0F5-37E5`），快，但它标识的是**那块盘**，不是**这份备份**。
 * 用户为了换大盘，在电脑上把整个备份文件夹拷到新 U 盘 —— 卷 ID 变了，
 * 于是 app 把它当成全新的盘：几千张全判"待备份"，然后**把几十 GB 从盘上重读一遍算哈希**，
 * 慢到让人以为坏了。
 *
 * 所以身份必须**跟着文件夹走**：把一个标识文件放进备份目录里。
 * 拷到哪、插在哪台手机上，它都还是同一份备份集。
 *
 * ## 文件长什么样
 *
 * `<备份根目录>/_backup/sylloge.json`，UTF-8 明文 JSON。
 * ⚠️ 里面**必须带一段人话说明** —— 在电脑上翻到这个文件的人（可能是几年后的用户自己）
 * 得能看懂这是什么、能不能删。
 */
data class BackupSetMarker(
    /** 备份集的永久身份。⭐ 判重就按它分组，不按卷 ID。 */
    val setId: String,
    /** 文件格式版本，以后改结构靠它兼容 */
    val format: Int = FORMAT,
    /** 建这份备份的设备（信息用，不参与判定） */
    val device: String,
    val createdAtMs: Long,
    val lastBackupAtMs: Long,
    val entryCount: Int,
) {
    companion object {
        const val FORMAT = 1
        const val FILE_NAME = "sylloge.json"

        /** 写进文件里的人话说明。⛔ 别删这段，它是给几年后翻到这个文件的人看的。 */
        const val HUMAN_NOTE =
            // ⚠️ **英文**：这块盘会被插到任何一台电脑上，读它的人不一定懂中文。
            //    盘上的东西是**数据**，人话由 app 按手机语言给（Nous 2026-08-26）。
            "This is the backup-set marker file written by Sylloge, an Android photo backup app. " +
            "The photos next to it keep the folder structure they had on the phone, so you can " +
            "browse and copy them with any file manager. " +
            "You can copy this whole folder to another USB drive as-is: Sylloge recognises it by " +
            "the setId below and carries on backing up incrementally instead of starting over. " +
            "Deleting this file will not damage the photos, but Sylloge will then treat the folder " +
            "as an unknown backup and re-verify every file on the next run, which is slow."
    }
}

/** 插上一块盘之后，它到底是什么情况。 */
sealed interface SetIdentity {
    /** 盘上有标识文件，而且本机认识这个备份集 —— 直接增量续传 */
    data class Known(val marker: BackupSetMarker) : SetIdentity

    /**
     * 盘上有标识文件，但本机没有它的记录 ——
     * 换了手机 / 重装了 app / 别人的备份。要么导入盘上的 catalog，要么全量校验。
     */
    data class Foreign(val marker: BackupSetMarker) : SetIdentity

    /** 盘上没有标识文件 —— 全新的盘，或者用户手动删过 */
    data object Fresh : SetIdentity

    /** 盘上有目录但标识文件读不懂（版本太新 / 损坏） */
    data class Unreadable(val reason: String) : SetIdentity
}
