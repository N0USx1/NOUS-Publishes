import { evaluate, PRELUDE } from "./cdp.mjs";
const r = await evaluate(`
${PRELUDE}
const actor = game.actors.getName("Nous offnirr") ?? game.actors.filter(a=>a.type==="character")[0];
const entry = actor.spellcasting?.contents?.find(e => e.statistic);
const spell = entry?.spells?.contents?.[0];
return {
  角色: actor.name,
  施法条目: entry?.name ?? null,
  DC路径_entry: entry?.statistic?.dc?.value ?? null,
  DC路径_spell: spell?.spellcasting?.statistic?.dc?.value ?? null,
  spell有无spellcasting: !!spell?.spellcasting,
  token数: actor.getActiveTokens?.().length ?? null,
  token有distanceTo: typeof actor.getActiveTokens?.()[0]?.distanceTo,
  场景网格: canvas?.scene?.grid?.type ?? null,
  场景名: canvas?.scene?.name ?? null,
};
`);
console.log(JSON.stringify(r, null, 1));
