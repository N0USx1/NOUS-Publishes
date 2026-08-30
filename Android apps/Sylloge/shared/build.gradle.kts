plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// ★ 单元测试（2026-08-25 起）：盘上产物的**纯逻辑**部分靠它钉死 ——
//   写盘那一步要真 U 盘，没插盘验不了，所以逻辑必须能离线验。
dependencies {
    testImplementation(kotlin("test"))
}

tasks.test { useJUnitPlatform() }

// ★★ CopySanityTest 会去读 **androidApp 的** res/ 和 kotlin/（见那个文件的说明）。
//   ⚠️ 不声明这两个输入，只改 androidApp 时 `:shared:test` 是 UP-TO-DATE ⇒
//   **守卫根本不跑，却照样是绿的** —— 2026-08-26 反向测试当场抓到。
//   ⛔ 假绿灯比没有守卫更坏：它让人以为查过了。
tasks.named<Test>("test") {
    inputs.dir(rootProject.layout.projectDirectory.dir("androidApp/src/main/res"))
    inputs.dir(rootProject.layout.projectDirectory.dir("androidApp/src/main/kotlin"))
}
