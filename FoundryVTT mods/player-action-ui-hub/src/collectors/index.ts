/**
 * 四类采集器的统一出口。
 *
 * ★ **同一份采集结果既供计数也供下钻**（设计定档 §7 明确要求）。
 *   不要为"分类层显示几条"单写一套轻量逻辑 —— 两套逻辑必然分叉，
 *   executor 的 `findStrike` 当年就是这么出的问题。
 */
export { collectStrikes, collectStrikeAuxiliaries } from "./strikes";
export { collectActions, collectFreeActions, BASIC_ACTIONS, SHEET_HINT_ID } from "./actions";
export { collectSkills, collectSkillActions } from "./skills";
export { collectClassAbilities, className } from "./class-abilities";
export { collectSpellEntries, collectSpells } from "./spells";
export { collectReactions, pickReactions, isReaction } from "./reactions";
export { collectActivations, pickActivatable, hasCharges } from "./activations";
