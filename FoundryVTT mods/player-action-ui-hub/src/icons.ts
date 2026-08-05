/**
 * 图标补位表 —— 只补 pf2e **没给**的那些。
 *
 * ★ 为什么需要：扇区遵循"图标优先、名字交给中心毂"（设计定档 §7），
 *   目的是**结构上**杜绝长名字压出扇区。没有图标就退回文字，
 *   而 `Recall Knowledge` / `Occultism Check` 这种长度实测会溢出（Nous 2026-08-05 截图）。
 *
 * ★ 全部取自 **Foundry 自带图标库**（`icons/**`，game-icons.net 的 CC BY 3.0 素材，
 *   随 Foundry 分发）—— 不引外部资源、不增分发体积、授权干净。
 *   实测库里有 7094 个文件，其中 `icons/svg/` 那 120 个是**语义化单色图标**，
 *   本来就是给 UI 用的，在深色盘面上比彩色贴图更清晰。
 *
 * ⚠ 这张表是**人为映射**，和冷启动清单一样是判断不是数据。
 *   但它的错法很轻：选错图标只是不好看，不影响任何规则判定。
 *
 * ⚠ **不要给 pf2e 已经有图标的条目做映射** —— 那是系统的选择，我们只补空缺。
 */

/** 分类层五格。用单色 SVG，与内容层的彩色贴图区分开，一眼看出这是导航层。 */
export const CATEGORY_ICONS: Record<string, string> = {
    strikes: "icons/svg/sword.svg",
    actions: "icons/svg/walk.svg",
    skills: "icons/svg/book.svg",
    class: "icons/svg/tower-flag.svg",
    spells: "icons/svg/aura.svg",
};

/**
 * 技能入口。
 * ⚠ 技能是 `Statistic` 不是 item，**根本没有 img 字段**可取，只能全部自己配。
 */
export const SKILL_ICONS: Record<string, string> = {
    acrobatics: "icons/svg/jump.svg",
    arcana: "icons/commodities/treasure/talisman-embossed-rune-red.webp",
    athletics: "icons/magic/control/buff-strength-muscle-damage.webp",
    crafting: "icons/commodities/metal/ingot-hammered-copper.webp",
    deception: "icons/commodities/treasure/mask-wood-tan.webp",
    diplomacy: "icons/skills/social/diplomacy-handshake.webp",
    intimidation: "icons/magic/control/fear-fright-mask-orange.webp",
    medicine: "icons/tools/medical/bandage-rough.webp",
    nature: "icons/svg/oak.svg",
    occultism: "icons/commodities/biological/eye-blue.webp",
    performance: "icons/skills/trades/music-notes-sound-blue.webp",
    religion: "icons/svg/temple.svg",
    society: "icons/environment/settlement/city-hall.webp",
    stealth: "icons/svg/invisible.svg",
    survival: "icons/magic/fire/flame-burning-campfire-orange.webp",
    thievery: "icons/svg/padlock.svg",
};

/** 学识类技能（`*-lore`）共用一个。玩家可以有任意多条自定义学识。 */
export const LORE_ICON = "icons/svg/book.svg";

/**
 * 基础动作。
 * ⚠ 实测 25 条里 **20 条**用的是 pf2e 的通用消耗图标
 *   （`OneAction.webp` 之流）——一圈全长一样等于没有图标，所以这些都要换掉。
 */
export const ACTION_ICONS: Record<string, string> = {
    stride: "icons/svg/walk.svg",
    step: "icons/svg/leg.svg",
    crawl: "icons/svg/falling.svg",
    leap: "icons/svg/jump.svg",
    stand: "icons/svg/up.svg",
    "drop-prone": "icons/svg/falling.svg",
    fly: "icons/svg/wing.svg",
    burrow: "icons/svg/burrow.svg",
    "grab-an-edge": "icons/svg/ladder.svg",
    "arrest-a-fall": "icons/svg/wingfoot.svg",
    mount: "icons/svg/pawprint.svg",
    aid: "icons/skills/social/diplomacy-handshake-gray.webp",
    ready: "icons/svg/target.svg",
    delay: "icons/svg/clockwork.svg",
    dismiss: "icons/svg/cancel.svg",
    release: "icons/svg/down.svg",
    sustain: "icons/svg/aura.svg",
    interact: "icons/svg/item-bag.svg",
    "point-out": "icons/svg/direction.svg",
    "affix-a-talisman": "icons/svg/anchor.svg",
    seek: "icons/svg/eye.svg",
    "sense-motive": "icons/svg/eye.svg",
    escape: "icons/svg/net.svg",
    "take-cover": "icons/svg/shield.svg",
    "avert-gaze": "icons/svg/blind.svg",
};

/** 技能动作里 pf2e 没给图标的那 4 个知识类（实测 45 条里只缺这些）。 */
export const SKILL_ACTION_ICONS: Record<string, string> = {
    "recall-knowledge": "icons/skills/trades/academics-book-study-runes.webp",
    "identify-magic": "icons/magic/symbols/question-stone-yellow.webp",
    "identify-alchemy": "icons/skills/trades/academics-investigation-puzzles.webp",
    "learn-a-spell": "icons/skills/trades/academics-study-reading-book.webp",
};

/** 裸技能检定那一格。所有技能共用 —— 它表达的是"掷这个技能"这件事本身。 */
export const CHECK_ICON = "icons/svg/d20-grey.svg";

/** 施法条目层（准备位 / 专注 / 仪式）。 */
export const SPELL_ENTRY_ICONS: Record<string, string> = {
    focus: "icons/svg/aura.svg",
    ritual: "icons/svg/statue.svg",
};
export const SPELL_ENTRY_DEFAULT = "icons/svg/book.svg";

/**
 * pf2e 的图标是不是"通用消耗图标"（`OneAction.webp` 之流）。
 * 这类图标一圈全长一样，等于没有区分度 —— 判定为空缺，交给上面的表补。
 */
export function isGenericIcon(img: string | null | undefined): boolean {
    return !img || img.startsWith("systems/pf2e/icons/actions/");
}

/** 取图标：pf2e 给的优先，通用图标视为空缺，退回补位表。 */
export function iconFor(img: string | null | undefined, fallback: string | undefined): string | undefined {
    return isGenericIcon(img) ? fallback : img!;
}
