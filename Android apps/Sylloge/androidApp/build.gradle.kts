import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)   // AGP 9 内建 Kotlin，但 Compose 编译器插件仍需单独应用
}

android {
    namespace = "com.nous.sylloge.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.nous.sylloge"
        minSdk = 30
        targetSdk = 36
        versionCode = 2
        versionName = "0.9.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // ⚠️ 本地用 debug 钥匙签 release，只为**在 release 包上量手感** ——
            // 官方性能文档硬规矩：**Compose 的性能只能在 release 上判断，debug 包显著更慢**
            // （debug 里编译器留着 source info / 组合追踪，且没有 AOT 预热）。
            // ⛔ 上架的正式签名另说，别把这条当发布配置。
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
    }
    buildFeatures { compose = true }
}

dependencies {
    implementation(project(":shared"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.activity.compose)
    implementation(libs.glide)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.work.runtime)
    implementation(libs.documentfile)
}

// ═══════════════════════════════════════════════════════════════════════════
// ★★ 构建期断言：合并后的清单里不许出现网络相关权限
//
// 为什么必须是**合并后**那份：清单是合并出来的，依赖库自带的 <uses-permission>
// 会并进来 —— 你翻遍自己写的那份也找不到。
// 实证（2026-08-25）：`androidx.work:work-runtime` 一直在带 ACCESS_NETWORK_STATE，
// 而我们的 README 写着「零联网」，四个月没人发现。**这条断言第一次跑就抓到了它。**
//
// ⚠️ lint 内置的 13 条权限检查全在管「你声明的权限对不对」，
//    **没有一条管「冒出了你不想要的权限」** ⇒ 平台不给哨兵，只能自己立。
// ⚠️ `tools:node="remove"` 是补救不是防线：它要求你**事先知道**是哪个权限、哪个库。
// ═══════════════════════════════════════════════════════════════════════════

androidComponents {
    onVariants { variant ->
        val cap = variant.name.replaceFirstChar { it.uppercase() }
        val manifest = variant.artifacts.get(com.android.build.api.artifact.SingleArtifact.MERGED_MANIFEST)

        // ⚠️ ⛔ 这个清单**必须是局部 val**，不能是脚本顶层的属性 ——
        //    `doLast` 引用脚本属性 = 捕获整个脚本对象，配置缓存序列化不了：
        //    "cannot serialize Gradle script object references"。
        //    同理 `logger` 也别用，直接 println。
        val forbidden = listOf(
            "INTERNET",
            "ACCESS_NETWORK_STATE",
            "ACCESS_WIFI_STATE",
            "CHANGE_NETWORK_STATE",
            "CHANGE_WIFI_STATE",
        )

        val check = tasks.register("assertNoNetworkPermissions$cap") {
            group = "verification"
            description = "合并后的清单里出现网络相关权限就让构建失败"
            inputs.file(manifest)
            doLast {
                val text = manifest.get().asFile.readText()
                val hits = forbidden.filter { text.contains("android.permission.$it") }
                if (hits.isNotEmpty()) {
                    throw GradleException(
                        buildString {
                            appendLine("⛔ 合并后的清单里出现了不许有的权限：")
                            hits.forEach { appendLine("     android.permission.$it") }
                            appendLine()
                            appendLine("Sylloge 承诺永不联网。查是谁带进来的：")
                            appendLine("  androidApp/build/intermediates/manifest_merge_blame_file/**/manifest-merger-blame-*.txt")
                            appendLine("然后在 AndroidManifest.xml 里用 tools:node=\"remove\" 摘掉，或换一个不带它的库。")
                        }
                    )
                }
                println("✅ 清单权限体检通过（$cap）：无网络相关权限")
            }
        }
        // ⚠️ ⛔ 不能用 `tasks.named("assemble$cap")` —— onVariants 跑时它还没注册。
        //    `matching {}.configureEach {}` 是惰性的，与注册顺序无关。
        tasks.matching { it.name == "assemble$cap" }.configureEach { dependsOn(check) }
    }
}

/**
 * ★★ **文案体检**（M9，2026-08-26 立）。挂在 assemble 上，⛔ 不是"记得去查"。
 *
 * 立它的原因是同一个病连犯两次：
 *   ① `Access.humanText` 把中文写死在代码里 ⇒ **法语用户的失败卡上是中文**；
 *   ② `error("建不了根目录 ")` 等 6 处同样写死 —— 修完①才顺手枚举出②。
 * ⇒ 规矩存在注释里是不会自己触发的，**只有能让构建变红的才算规矩**。
 */


// ★ 文案体检搬去了 shared/src/test/.../CopySanityTest.kt（2026-08-26）——
//   写成 Gradle 任务时 doLast 一复杂就连脚本对象一起被捕获，配置缓存每次丢；
//   逐段剔除验过：去掉任意一段都好 ⇒ 是复杂度阈值，⛔ 缩代码去躲不叫修复。
//   ⚠️ 这里只留**挂钩**：打包前必须先跑单测，⛔ 不是「记得去跑」。
tasks.matching { it.name.startsWith("assemble") }.configureEach { dependsOn(":shared:test") }
