package com.nous.sylloge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 盘上两份产物的单元测试。
 *
 * ★ 为什么值得单独测：这两份东西**写在 U 盘上**，没插盘就验不了；
 * 而最容易错的（转义、BOM、分隔符）恰恰全是纯逻辑。⇒ 逻辑用测试钉死，
 * 剩下的只有"把这堆字节写进那个文件"几行管道。
 */
class ManifestCsvTest {

    private val Q = '"'

    @Test
    fun `普通格不加引号`() {
        assertEquals("DCIM/Camera/IMG_1.jpg", ManifestCsv.cell("DCIM/Camera/IMG_1.jpg"))
    }

    @Test
    fun `含逗号的文件名要整格加引号`() {
        // ⚠️ 真实存在：WhatsApp 存的文件名、用户自己重命名的相册
        assertEquals(Q + "假期, 2026.jpg" + Q, ManifestCsv.cell("假期, 2026.jpg"))
    }

    @Test
    fun `内部引号翻倍（RFC 4180）`() {
        assertEquals(Q + "他说" + Q + Q + "好" + Q + Q + Q, ManifestCsv.cell("他说" + Q + "好" + Q))
    }

    @Test
    fun `含换行的字段也要包起来`() {
        val v = "a" + Char(10) + "b"
        assertEquals(Q + v + Q, ManifestCsv.cell(v))
    }

    @Test
    fun `整份以 BOM 开头 —— 否则 Excel 把中文读成乱码`() {
        val out = ManifestCsv.render(emptyList())
        assertEquals(0xEF.toByte(), out[0])
        assertEquals(0xBB.toByte(), out[1])
        assertEquals(0xBF.toByte(), out[2])
    }

    @Test
    fun `BOM 之后第一行必须是 sep 指令 —— 意大利区域的 Excel 默认分号`() {
        val txt = String(ManifestCsv.render(emptyList()), Charsets.UTF_8)
        // 去掉 BOM 字符再比
        assertTrue(txt.trimStart(Char(0xFEFF)).startsWith("sep=,"), "首行不是 sep=, ⇒ 意/法/西 Excel 会挤成一列")
    }

    @Test
    fun `行尾是 CRLF`() {
        val txt = String(ManifestCsv.render(emptyList()), Charsets.UTF_8)
        assertTrue(txt.contains("" + Char(13) + Char(10)))
    }

    @Test
    fun `一行数据的列序与表头一致`() {
        val out = ManifestCsv.render(
            listOf(ManifestRow("DCIM/a.mp4", "a.mp4", isVideo = true, bytes = 123L, copiedAt = "2026-08-25 18:00:00"))
        )
        val lines = String(out, Charsets.UTF_8).split("" + Char(13) + Char(10))
        assertEquals("relative path,name on drive,type,size (bytes),backed up at", lines[1])
        assertEquals("DCIM/a.mp4,a.mp4,video,123,2026-08-25 18:00:00", lines[2])
    }
}

class SessionLogTest {

    private fun sample(lines: List<LogLine>, tally: SessionTally) = SessionLog.render(
        startClock = "18:00:00", endClock = "18:02:03", target = "NOUS sync",
        lines = lines, tally = tally, seconds = 123L, humanBytes = "2.0 MB",
    )

    @Test
    fun `跳过的绝不逐条出现在流水里`() {
        // ⚠️ 这是这份日志的核心取舍：没插新照片时一次会跳过几千条，
        //    逐条列出会把真正发生的三五件事淹掉。数字仍然要写。
        val txt = sample(
            listOf(LogLine("copied", "DCIM/new.jpg", "2.0 MB")),
            SessionTally(copied = 1, renamed = 0, skipped = 4198, failed = 0, bytes = 2_000_000),
        )
        assertEquals(1, txt.split(Char(10)).count { it.startsWith("  copied") })
        assertTrue(txt.split(Char(10)).none { it.startsWith("  skipped") }, "跳过的不该逐条出现")
        assertTrue(txt.contains("skipped 4198"), "但汇总数字必须在")
    }

    @Test
    fun `失败要带原因 —— 只写路径等于没写`() {
        val txt = sample(
            listOf(LogLine("failed", "DCIM/big.mp4", "too_big: IOException: write failed")),
            SessionTally(0, 0, 0, 1, 0),
        )
        assertTrue(txt.contains("DCIM/big.mp4"))
        assertTrue(txt.contains("too_big"), "原因键要落到盘上的流水里")
    }

    @Test
    fun `一次会话以空行收尾 —— 追加下一次时不会粘连`() {
        val txt = sample(emptyList(), SessionTally(0, 0, 0, 0, 0))
        assertTrue(txt.endsWith("" + Char(10) + Char(10)), "结尾要留空行，否则当天第二次备份会粘在上一次后面")
    }

    @Test
    fun `目标盘名字要写进流水`() {
        assertTrue(sample(emptyList(), SessionTally(0, 0, 0, 0, 0)).contains("NOUS sync"))
    }
}

class DayLogNameTest {

    @Test
    fun `当天流水必须是 txt —— log 会被 SAF 补成 log_txt 导致追加失效`() {
        // ⚠️ 2026-08-25 真盘实测的坑：MIME text/plain + 名字 .log
        //    ⇒ 落盘 "2026-08-25.log.txt" ⇒ findFile(".log") 再也找不到 ⇒ 每次新建一份。
        assertEquals("2026-08-25.txt", Layout.dayLogName("2026-08-25"))
    }

    @Test
    fun `旧名字仍然认得，好把内容接过来`() {
        val old = Layout.legacyDayLogNames("2026-08-25")
        assertTrue("2026-08-25.log" in old)
        assertTrue("2026-08-25.log.txt" in old, "我自己踩坑期间真的生成过这个名字")
    }
}
