package com.nous.sylloge

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * ★★ **文案体检**（M9，2026-08-26 立）。⛔ 不是"记得去查"，是**不过就红**。
 *
 * 立它的原因是同一个病连犯两次：
 *   ① `Access.humanText` 把中文写死在代码里 ⇒ **法语用户的失败卡上是中文**；
 *   ② `error("建不了根目录 ")` 等 6 处同样写死 —— 修完①才顺手枚举出②。
 * ⇒ 规矩存在注释里不会自己触发，**只有能让构建变红的才算规矩**。
 *
 * ⚠️ **为什么在这里、不在 build.gradle.kts**（2026-08-26 走过的弯路）：
 * 写成 Gradle 任务时，`doLast` 那个 lambda 一复杂就会**连整个脚本对象一起被捕获**
 * ⇒ 配置缓存报 "cannot serialize Gradle script object references"，每次构建都丢缓存。
 * 逐段剔除验过：**去掉任意一段都好，跟哪一段无关** ⇒ 是复杂度阈值，
 * ⛔ 缩代码去躲阈值不叫修复（下次一改就回来）。
 * ⇒ 搬进普通 Kotlin 测试：没有脚本对象、可读可测，还顺带被 `:shared:test` 带着跑。
 *
 * ⚠️ 测试的工作目录是 `shared/`，所以路径都从这里往上走。
 */
class CopySanityTest {

    private val res = File("../androidApp/src/main/res")
    private val appSrc = File("../androidApp/src/main/kotlin")
    private val langs = listOf("values", "values-zh", "values-it", "values-fr", "values-es")

    /** 只留代码：注释**抹成空格**（行号不变）。⚠️ 只剥 `//` 会把 KDoc 里的中文当成字面量。 */
    private fun stripComments(text: String): String {
        val lf = Char(10)
        val sb = StringBuilder(text.length)
        var i = 0
        var inBlock = false
        var inLine = false
        var inStr = false
        while (i < text.length) {
            val c = text[i]
            val n = if (i + 1 < text.length) text[i + 1] else ' '
            when {
                c == lf -> { inLine = false; inStr = false; sb.append(c); i++ }
                inBlock -> if (c == '*' && n == '/') { inBlock = false; sb.append("  "); i += 2 } else { sb.append(' '); i++ }
                inLine -> { sb.append(' '); i++ }
                !inStr && c == '/' && n == '*' -> { inBlock = true; sb.append("  "); i += 2 }
                !inStr && c == '/' && n == '/' -> { inLine = true; sb.append("  "); i += 2 }
                c == '"' -> { inStr = !inStr; sb.append(c); i++ }
                else -> { sb.append(c); i++ }
            }
        }
        return sb.toString()
    }

    private val han = Regex("[" + Char(0x4e00) + "-" + Char(0x9fff) + "]")
    private fun texts() = langs.associateWith { File(res, "$it/strings.xml").readText() }

    @Test
    fun `五语的 key 必须对齐 —— 少一条就是那门语言原样露出英文`() {
        val keyRe = Regex("<(?:string|plurals) name=@([^@]+)@".replace('@', '"'))
        val keys = texts().mapValues { (_, t) -> keyRe.findAll(t).map { it.groupValues[1] }.toSet() }
        // app_name 只在默认语言里，⛔ 不翻译
        val base = keys.getValue("values") - "app_name"
        val bad = langs.flatMap { l ->
            val k = keys.getValue(l) - "app_name"
            (base - k).map { "$l 缺 $it" } + (k - base).map { "$l 多出 $it" }
        }
        assertTrue(bad.isEmpty(), "五语 key 不齐：" + bad.joinToString("; "))
    }

    @Test
    fun `占位符个数必须一致 —— 差一个就在运行时抛 IllegalFormatException`() {
        val t = texts()
        val argRe = Regex("%[0-9][" + Char(36) + "]")
        val keyRe = Regex("<string name=@([^@]+)@".replace('@', '"'))
        val base = keyRe.findAll(t.getValue("values")).map { it.groupValues[1] }.toSet()
        val bad = base.mapNotNull { key ->
            // ⚠️ 括号不能省：`.replace` 只绑最后一个字面量，漏了就是永不匹配的死正则
            //    （2026-08-26 反向测试抓出来的 —— 尺子自己坏了）
            val re = Regex(("<string name=@" + Regex.escape(key) + "@>(.*?)</string>").replace('@', '"'), RegexOption.DOT_MATCHES_ALL)
            val counts = langs.mapNotNull { l -> re.find(t.getValue(l))?.let { m -> l to argRe.findAll(m.groupValues[1]).map { it.value }.toSet().size } }
            if (counts.map { it.second }.toSet().size > 1) "$key $counts" else null
        }
        assertTrue(bad.isEmpty(), "占位符个数不一致：" + bad.joinToString("; "))
    }

    @Test
    fun `异常消息里不许写死中文 —— 那条路的终点是用户的失败卡`() {
        val throwRe = Regex("(?:error|require|check|checkNotNull)[(][ ]*@([^@]*)@".replace('@', '"'))
        val bad = ArrayList<String>()
        appSrc.walkTopDown().filter { it.extension == "kt" }.forEach { f ->
            stripComments(f.readText()).lines().forEachIndexed { i, ln ->
                throwRe.findAll(ln).forEach { m ->
                    if (han.containsMatchIn(m.groupValues[1])) bad += f.name + ":" + (i + 1) + " " + m.groupValues[1]
                }
            }
        }
        assertTrue(bad.isEmpty(), "写死中文的异常消息（应加一条 string 用 ctx.getString 抛）：" + bad.joinToString("; "))
    }

    @Test
    fun `写到 U 盘上的字面量必须英文 —— 盘是数据，会说话的是 app`() {
        // ★ 盘会被插到任何一台电脑上（Nous 2026-08-26）：写死中文 =
        //   把"写它时那台手机的语言"腌进数据里，换台手机再备份就成了混合语言。
        val strRe = Regex("@([^@]*)@".replace('@', '"'))
        val bad = ArrayList<String>()
        listOf("src/main/kotlin/com/nous/sylloge/DriveReports.kt",
               "src/main/kotlin/com/nous/sylloge/BackupSet.kt").forEach { rel ->
            val f = File(rel)
            assertTrue(f.exists(), "写盘文件找不到：$rel")
            stripComments(f.readText()).lines().forEachIndexed { i, ln ->
                strRe.findAll(ln).forEach { m ->
                    if (han.containsMatchIn(m.groupValues[1])) bad += f.name + ":" + (i + 1) + " " + m.groupValues[1]
                }
            }
        }
        // 流水的动词在 app 侧拼，⛔ 也不许中文
        val logRe = Regex("LogLine[(][ ]*@([^@]*)@".replace('@', '"'))
        appSrc.walkTopDown().filter { it.extension == "kt" }.forEach { f ->
            stripComments(f.readText()).lines().forEachIndexed { i, ln ->
                logRe.findAll(ln).forEach { m ->
                    if (han.containsMatchIn(m.groupValues[1])) bad += f.name + ":" + (i + 1) + " 流水动词 " + m.groupValues[1]
                }
            }
        }
        assertTrue(bad.isEmpty(), "写到盘上的中文：" + bad.joinToString("; "))
    }
}
