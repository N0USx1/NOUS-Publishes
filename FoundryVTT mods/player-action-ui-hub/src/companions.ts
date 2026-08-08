import type { ActorPF2e } from "foundry-pf2e";
import type { SectorData } from "./types";
import { specOf } from "./actor-kinds";

/**
 * G8 · **我控制的其他单位**（Nous 2026-08-07 提出方向，同日实测定形）。
 *
 * ★★ **这条把四件事一次解开**：召唤师的幻灵、死灵的爪牙、魔宠、动物同伴 ——
 *   它们在系统里各不相同，但对轮盘来说是同一个问题：
 *   **"这一步不是我做，是我控制的另一具身体做"**。
 *
 * ★ **判据是归属，不是标签**（实测推翻了"查个级联 tag"的第一想法）：
 *
 *   | 观测 | 结果 |
 *   |---|---|
 *   | 有没有 `eidolon` 这个 actor 类型 | ❌ 没有（类型只有 army/familiar/hazard/loot/party/vehicle + character/npc） |
 *   | `eidolon` 以什么形式存在 | ✅ **生物特性** `CONFIG.PF2E.creatureTraits.eidolon` |
 *   | 图鉴里有现成幻灵卡吗 | ❌ 0 条（玩家自建，本来就不该有） |
 *   | 同类先例有硬链接吗 | ✅ **familiar 有 `system.master.id`** |
 *   | 归属读得到吗 | ✅ `actor.ownership` = `{userId: 3}` |
 *   | 有没有"归玩家账号"这个现成判据 | ✅ `actor.hasPlayerOwner` |
 *
 *   → **"我显式拥有 ∧ 它归某个玩家账号 ∧ 它不是当前这具身体"**
 *     —— 纯推导，一条映射都不用写。
 *
 * ⚠⚠ 两个坑都不报错，见 `BodyLike` 上那两段：
 *   `isOwner` 对 GM 恒真；显式归属对**创建者**自动成立。
 *
 * ⚠ **它回答不了"哪一个才是幻灵"** —— 一个玩家可能拥有两个 PC。
 *   按本模组一贯立场这不需要回答：**让玩家自己选，我们照他选的执行**，
 *   与目标选择、与反应分类是同一条路。
 *
 * ⚠ `eidolon` / `minion` 特性**只当排序提示，不当判据**：
 *   玩家没给自建 actor 打这个特性时，判据会**静默失效**（列表突然空了，
 *   而"空"与"这角色确实没有同伴"长得一模一样）。排序错了顶多是顺序难看。
 */

/** 一具可以被驱动的身体。纯数据，便于单测。 */
export interface BodyLike {
    id: string;
    name: string;
    type: string;
    img?: string;
    /**
     * `actor.ownership[我的用户 id] === 3` —— **显式**授予我的所有权。
     *
     * ⚠⚠ **不能用 `actor.isOwner`**（2026-08-07 差点发出去才量到）：
     *   GM 对世界里**每一个** actor 都 `isOwner === true`（那是权限兜底，不是归属），
     *   于是 GM 打开轮盘会看到整个世界的角色列表 —— 而这个错法**不报错**，
     *   在只有几个角色的测试世界里甚至看着像"功能正常"。
     *   实测：5 个 actor 全部 `isOwner: true`。
     */
    ownedByMe: boolean;
    /**
     * `actor.hasPlayerOwner` —— **有没有某个玩家账号**（非 GM）拥有它。
     *
     * ★★ 这一条正是 Nous 的原话："**隶属于某个玩家账号的 NPC**
     *   （要不然游戏逻辑上是不会拿给玩家操控的角色）"。
     *
     * ⚠ 光有"我显式拥有"还不够（第二次实测才发现）：
     *   **Foundry 会给创建者自动加显式归属** —— 实测新建一个 actor，
     *   `ownership` 立刻变成 `{default:0, 我:3}`。
     *   于是 GM 导入的整本怪物图鉴每一条都"我显式拥有"，列表照样爆掉。
     *
     * ★ 两条合起来才对，而且**对玩家与 GM 是同一条规则**：
     *   - 玩家：他显式拥有的东西天然就是玩家拥有的 → 第二条恒真，不改变结果；
     *   - GM：滤掉他自己建的怪，只留真正交给玩家账号的那些。
     *   实测该世界 5 个 actor 里 `hasPlayerOwner` 只有 1 个为真 —— 正是那个 PC。
     *
     * ⚠ 已知取舍：GM 单人跑召唤师、幻灵没给任何玩家账号时，这里列不出来。
     *   解法是把幻灵的所有权给那个玩家账号 —— 那本来就是要让他驱动它该做的事。
     */
    hasPlayerOwner: boolean;
    /** `system.master.id` —— 魔宠专有的硬链接，指向主人 */
    masterId?: string | null;
    /** `system.traits.value` */
    traits?: string[];
    /** 它在当前场景里有没有令牌 */
    hasToken?: boolean;
}

/** 排序提示用的特性。⚠ 只影响顺序，绝不影响入选。 */
export const HINT_TRAITS = ["eidolon", "minion", "animal", "construct"];

/**
 * 挑出"我控制的其他单位"，并排好序。
 *
 * ★ 排序按**推导强度**从强到弱 —— 越确定是这个角色的，越靠前：
 *   ① `master.id` 指着我（魔宠的硬链接，确定无疑）
 *   ② 带 eidolon/minion 这类提示特性
 *   ③ 其余按名字
 *
 * ⚠ **不能行动的类型要剔掉**（loot / party / base）：
 *   它们过得了归属这一关，但驱动它们没有意义 —— 判据复用 `actor-kinds.ts`，
 *   别在这里另写一份"哪些能动"的清单，两份必然分叉。
 */
export function pickBodies(bodies: BodyLike[], currentId: string): BodyLike[] {
    const 分 = (b: BodyLike): number => {
        if (b.masterId && b.masterId === currentId) return 0;
        if ((b.traits ?? []).some(t => HINT_TRAITS.includes(t))) return 1;
        return 2;
    };
    return bodies
        .filter(b => b.ownedByMe && b.hasPlayerOwner === true && b.id !== currentId && specOf({ type: b.type } as any).usable)
        .sort((a, b) => 分(a) - 分(b) || a.name.localeCompare(b.name));
}

/** 身体扇区的 id 前缀。 */
export const BODY_PREFIX = "body:";

/** 从 actor 读出 `BodyLike`。局部豁免收在这一处。 */
function readBody(a: any, sceneTokens: Set<string>, myUserId: string): BodyLike {
    return {
        id: a?.id,
        name: a?.name ?? "",
        type: a?.type ?? "",
        img: a?.img,
        // ⚠ 显式归属，不是 isOwner —— 见 BodyLike.ownedByMe 顶上那段
        ownedByMe: a?.ownership?.[myUserId] === 3,
        // ⚠ 与上一条**必须一起看**：Foundry 会给创建者自动加显式归属，
        //   单看归属的话 GM 导入的整本图鉴都会算进来
        hasPlayerOwner: !!a?.hasPlayerOwner,
        masterId: a?.system?.master?.id ?? null,
        traits: a?.system?.traits?.value ?? [],
        hasToken: sceneTokens.has(a?.id),
    };
}

/**
 * 采集"我控制的其他单位"扇区。只读，绝不写 actor。
 *
 * ⚠ **场上没有令牌的身体照样列出来**，只是标一句。
 *   过滤掉的话，玩家会以为模组坏了 —— 而真实情况是"它还没放到场上"，
 *   那是他自己能解决的事。**提示不是锁**，与三态守则同一条。
 */
export function collectBodies(current: ActorPF2e | null): SectorData[] {
    try {
        const currentId = (current as any)?.id ?? "";
        const 场上 = new Set<string>(
            ((globalThis as any).canvas?.tokens?.placeables ?? [])
                .map((t: any) => t?.actor?.id).filter(Boolean),
        );
        const myUserId = String((globalThis as any).game?.user?.id ?? "");
        const all: BodyLike[] = ((globalThis as any).game?.actors?.contents ?? [])
            .map((a: any) => readBody(a, 场上, myUserId));

        return pickBodies(all, currentId).map((b): SectorData => ({
            id: `${BODY_PREFIX}${b.id}`,
            label: b.name,
            img: b.img,
            cost: null,
            // ⚠ 记号说的是"**它在不在场上**"，不是"能不能点" —— 两件事别混
            badge: b.hasToken ? undefined : "◇",
            detail: b.hasToken
                ? `Drive ${b.name} with the wheel.`
                : `${b.name} has no token on this scene — place one to act with it.`,
            state: "normal",
        }));
    } catch (err) {
        console.error("player-action-ui-hub | collectBodies 失败", err);
        return [];
    }
}
