package com.nous.sylloge.ui

import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.nous.sylloge.android.R

/**
 * 下卡第 2 页：说明此 app。
 *
 * ★ 结构与文案 = **Nous 2026-08-30 定稿**（点清单他裁过），排版照他的参照：
 *   **系统设置那种卡片行**（icon + 标题 + 小字副标题，整行可点）。
 * ★ 「导出错误目录」是**一个动作**：导出诊断包 + 自动打开反馈页（⛔ 不拆两个按钮）。
 * ⚠️ 文案全部走 strings.xml（五语，守卫保对齐），⛔ 别写死。
 * ⚠️ 打赏（Ko-fi）：点击只是 ACTION_VIEW 交系统浏览器，app 本身零网络权限。
 *   M10 上架转买断后这一行整个摘掉。
 */
@Composable
fun AboutPage(
    version: String,
    /** 最后一次备份写到的盘（卷名 / 根目录名），没备份过为 null。 */
    savedLocation: String?,
    hideNomedia: Boolean,
    onHideNomediaChange: (Boolean) -> Unit,
    /** 一键反馈：导出诊断包 + 打开反馈页。 */
    onFeedback: () -> Unit,
    /** 打开 Ko-fi 打赏页（系统浏览器）。 */
    onKofi: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.padding(horizontal = 4.dp)) {
            Text("Sylloge", style = MaterialTheme.typography.headlineSmall)
            Text(
                stringResource(R.string.about_tagline),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(10.dp))
            PointRow(R.drawable.ic_no_net, stringResource(R.string.about_no_net))
            PointRow(R.drawable.ic_files_safe, stringResource(R.string.about_no_delete))
        }

        Spacer(Modifier.height(4.dp))

        SettingsRow(
            iconRes = R.drawable.ic_usb,
            title = stringResource(R.string.about_saved_location),
            detail = savedLocation ?: "\u2014",
        )
        SettingsRow(
            iconRes = R.drawable.ic_hide_folder,
            title = stringResource(R.string.about_hide_nomedia_title),
            detail = stringResource(R.string.about_hide_nomedia_detail),
        ) {
            Switch(checked = hideNomedia, onCheckedChange = onHideNomediaChange)
        }
        SettingsRow(
            iconRes = R.drawable.ic_bug,
            title = stringResource(R.string.about_export_title),
            detail = stringResource(R.string.about_export_detail),
            onClick = onFeedback,
        )
        // ★ 打赏行保留设置风；Nous 的 Ko-fi 卡图做成**行右侧小图**（2026-08-30 定）。
        //   图的正本在 D:/NOUS-Publishes/assets/kofi-support@2x.png，他更新后同步拷来。
        SettingsRow(
            iconRes = R.drawable.ic_coffee,
            title = stringResource(R.string.about_kofi_title),
            onClick = onKofi,
            verticalPad = 5.dp,
            endPad = 5.dp,
        ) {
            Image(
                painterResource(R.drawable.kofi_card),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.height(62.dp).clip(RoundedCornerShape(10.dp)),
            )
        }

        Spacer(Modifier.height(4.dp))
        Text(
            stringResource(R.string.about_version, version),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        Spacer(Modifier.height(14.dp))
    }
}

/** 卖点一行：官方 Material Symbols icon + Nous 的说辞。 */
@Composable
private fun PointRow(iconRes: Int, text: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(iconRes), contentDescription = null, modifier = Modifier.size(26.dp))
        Spacer(Modifier.width(14.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

/**
 * 设置风卡片行（Nous 给的参照 = 系统「网络和互联网」页）：
 * 每行一张浅色圆角卡，icon 左、标题 + 小字，右侧放控件；给了 onClick 整行可点。
 */
@Composable
private fun SettingsRow(
    iconRes: Int,
    title: String,
    detail: String? = null,
    onClick: (() -> Unit)? = null,
    /** 行的竖向留白。打赏行传小值 —— 让右侧图往白边里压（Nous 2026-08-30）。 */
    verticalPad: androidx.compose.ui.unit.Dp = 14.dp,
    /** 行的右侧留白。打赏行同样压小 —— 图要贴到行的右缘。 */
    endPad: androidx.compose.ui.unit.Dp = 16.dp,
    trailing: (@Composable () -> Unit)? = null,
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier
                .let { if (onClick != null) it.clickable(onClick = onClick) else it }
                .padding(start = 16.dp, end = endPad, top = verticalPad, bottom = verticalPad),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(painterResource(iconRes), contentDescription = null, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge)
                if (detail != null) Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (trailing != null) { Spacer(Modifier.width(12.dp)); trailing() }
        }
    }
}
