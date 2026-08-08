/**
 * 通用动作 slug → 纲要里那条的 uuid。
 *
 * ★ 为什么要这张表：`game.pf2e.actions` 里的条目**没有 uuid、也没有 item**
 *   （实测键只有 `cost / description / img / name / sampleTasks / section / slug /
 *   traits / effect`）—— 它是一份"能执行的动作"注册表，不是文档。
 *   而"点开说明"要的是文档。
 *
 * ★★ **表是问纲要索引问出来的，不是我列的**：
 *   `pf2e.actionspf2e` 的索引里每条都带 `system.slug`，按它对上就行。
 *   ⚠ 别按 `name` 对 —— 同名条目真实存在（`triggers.ts` 那次探针就是撞上同名专长翻的车）。
 *
 * ⚠ 取索引是异步的，而采集器是同步的 —— 所以在 `ready` 取一次、缓存起来。
 *   取不到就整张表为空，采集器那边**退化成"说明不可点"**，不影响别的。
 */

const 表 = new Map<string, string>();

/** 在 `ready` 里调一次。失败不抛，只是这张表留空。 */
export async function primeActionUuids(): Promise<void> {
    try {
        const pack = (game as any).packs?.get("pf2e.actionspf2e");
        if (!pack) return;
        const idx = await pack.getIndex({ fields: ["system.slug"] });
        for (const e of idx) {
            const slug = e?.system?.slug;
            if (typeof slug === "string" && slug && !表.has(slug)) 表.set(slug, e.uuid);
        }
    } catch (err) {
        console.error("player-action-ui-hub | 取动作纲要索引失败", err);
    }
}

/** 查一条；查不到返回 undefined（调用方据此不给「可点说明」）。 */
export function actionUuid(slug: string): string | undefined {
    return 表.get(slug);
}

/** 测试用：这张表现在有多少条。 */
export function actionUuidCount(): number { return 表.size; }
