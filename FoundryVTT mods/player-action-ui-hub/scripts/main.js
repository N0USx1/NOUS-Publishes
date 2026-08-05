var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/collectors/strikes.ts
function isStrike(action) {
  return action?.type === "strike";
}
function strikesOf(actor) {
  const actions = actor?.system?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter(isStrike);
}
function strikeSectorId(strike, index) {
  return `strike:${strike?.item?.id ?? strike?.slug ?? index}`;
}
function collectStrikes(actor) {
  try {
    return strikesOf(actor).map((strike, i) => {
      const ready = strike.ready !== false;
      const drawAux = (strike.auxiliaryActions ?? [])[0];
      return {
        id: strikeSectorId(strike, i),
        label: String(strike.label ?? strike.slug ?? "?"),
        // 图标取自武器物品；有图标时扇区只画图标（见 types.ts）
        img: strike.item?.img ?? void 0,
        cost: "1",
        // MAP 三段。★ 原样用 pf2e 的 label，只在前面补一个动作消耗记号：
        // 实测 label 已是 "+9 (MAP -4)"，自己再拼"第 2 击 MAP -4"会重复
        // （findings-v0.1 §2，计划 Task 7 Step 3 的写法在这一点上是错的）。
        variantLabels: (strike.variants ?? []).map((v) => `\u25C6 ${String(v?.label ?? "?")}`),
        // 未拔出 = gated（规则上此刻确实打不了），不是 risky
        state: ready ? "normal" : "gated",
        reason: ready ? void 0 : "Not drawn \u2014 spend \u25C6 to draw it first.",
        badge: !ready && drawAux ? "\u25C6 Draw" : void 0
      };
    });
  } catch (err) {
    console.error("player-action-ui-hub | collectStrikes \u5931\u8D25", err);
    return [];
  }
}
var init_strikes = __esm({
  "src/collectors/strikes.ts"() {
    "use strict";
    __name(isStrike, "isStrike");
    __name(strikesOf, "strikesOf");
    __name(strikeSectorId, "strikeSectorId");
    __name(collectStrikes, "collectStrikes");
  }
});

// src/spell-data.ts
function radiusAtRank(spell, rank) {
  const \u57FA\u7840 = Number(spell?.system?.area?.value);
  const \u8986\u76D6 = spell?.system?.heightening?.levels;
  let \u503C = Number.isFinite(\u57FA\u7840) ? \u57FA\u7840 : null;
  if (\u8986\u76D6 && rank) {
    const \u547D\u4E2D = Object.keys(\u8986\u76D6).map(Number).filter((n) => Number.isFinite(n) && n <= rank).sort((a, b) => a - b).at(-1);
    const v = \u547D\u4E2D != null ? Number(\u8986\u76D6[String(\u547D\u4E2D)]?.area?.value) : NaN;
    if (Number.isFinite(v)) \u503C = v;
  }
  return \u503C;
}
function rankOf(spell) {
  const r = Number(spell?.rank ?? spell?.system?.level?.value);
  return Number.isFinite(r) ? r : null;
}
function spellDC(spell) {
  const dc = spell?.spellcasting?.statistic?.dc?.value;
  return typeof dc === "number" ? dc : null;
}
function linkedSpellEffectUuid(spell) {
  const desc = String(spell?.system?.description?.value ?? "");
  const links = [...desc.matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)];
  const hit = links.find(([, uuid, label]) => uuid.includes("spell-effects") && /^\s*Spell Effect:/i.test(label));
  return hit?.[1] ?? null;
}
var init_spell_data = __esm({
  "src/spell-data.ts"() {
    "use strict";
    __name(radiusAtRank, "radiusAtRank");
    __name(rankOf, "rankOf");
    __name(spellDC, "spellDC");
    __name(linkedSpellEffectUuid, "linkedSpellEffectUuid");
  }
});

// src/aura-effects.ts
function auraSpecFor(slug) {
  if (!slug) return null;
  return AURA_SPECS.find((s) => s.slug === slug) ?? null;
}
function auraPlanFor(spell) {
  const spec = auraSpecFor(spell?.slug ?? null);
  if (!spec) return null;
  const radius = radiusAtRank(spell, rankOf(spell));
  if (!radius) return null;
  const effectUuid = linkedSpellEffectUuid(spell);
  if (!effectUuid) return null;
  const traits = [...spell?.system?.traits?.value ?? []];
  return { spec, radius, traits, effectUuid };
}
function buildAuraEffect(plan, casterLevel) {
  const { spec, radius, traits, effectUuid } = plan;
  return {
    name: `${spec.name} (Aura)`,
    type: "effect",
    img: "icons/svg/aura.svg",
    system: {
      description: {
        value: `<p>${spec.rule}</p><p><em>Applied by Player Action UI Hub.</em></p>`
      },
      // ⚠ 持续时间跟着法术走；anthem 族都是 1 轮，靠玩家每轮重施
      duration: { value: 1, unit: "rounds", expiry: "turn-start", sustained: false },
      level: { value: casterLevel },
      tokenIcon: { show: true },
      rules: [{
        key: "Aura",
        radius,
        traits,
        slug: `pauih-aura-${spec.slug}`,
        effects: [{ uuid: effectUuid, affects: spec.affects }]
      }]
    },
    flags: { "player-action-ui-hub": { autoApplied: true, auraFor: spec.slug } }
  };
}
var AURA_SPECS;
var init_aura_effects = __esm({
  "src/aura-effects.ts"() {
    "use strict";
    init_spell_data();
    AURA_SPECS = [
      {
        slug: "courageous-anthem",
        name: "Courageous Anthem",
        affects: "allies",
        rule: "You and all allies in the area gain a +1 status bonus to attack rolls, damage rolls, and saves against fear effects."
      },
      {
        slug: "rallying-anthem",
        name: "Rallying Anthem",
        affects: "allies",
        rule: "You and all allies in the area gain a +1 status bonus to AC and saving throws against fear."
      },
      {
        slug: "triple-time",
        name: "Triple Time",
        affects: "allies",
        rule: "You and all allies in the area gain a +10-foot status bonus to all Speeds."
      },
      {
        slug: "song-of-strength",
        name: "Song of Strength",
        affects: "allies",
        rule: "You and all allies in the area gain a +1 status bonus to Athletics checks."
      },
      {
        slug: "valiant-anthem",
        name: "Valiant Anthem",
        affects: "allies",
        rule: "You and all allies in the area gain a +10-foot status bonus to Speeds and a +1 status bonus to attack rolls."
      },
      {
        slug: "silvers-refrain",
        name: "Silver's Refrain",
        affects: "allies",
        rule: "Weapon and unarmed attacks by allies in the area are treated as silver."
      },
      {
        slug: "frenzied-revelry",
        name: "Frenzied Revelry",
        affects: "allies",
        rule: "You and your allies gain a +1 status bonus to saving throws against mental effects while in the area."
      },
      {
        slug: "coiling-dance",
        name: "Coiling Dance",
        affects: "allies",
        rule: "Your allies in the area are filled with sacred energy, making their spells and attacks holy."
      }
    ];
    __name(auraSpecFor, "auraSpecFor");
    __name(auraPlanFor, "auraPlanFor");
    __name(buildAuraEffect, "buildAuraEffect");
  }
});

// src/effects.ts
function isSelfTargeted(spell) {
  const hasTarget = !!(spell.target && String(spell.target).trim());
  return !hasTarget && !spell.area;
}
function selfEffectUuid(description) {
  const links = [...String(description ?? "").matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)];
  const hit = links.find(([, uuid, label]) => uuid.includes("spell-effects") && /^\s*Spell Effect:/i.test(label));
  return hit?.[1] ?? null;
}
async function applyEffect(actor, uuid) {
  try {
    if (!actor) return null;
    if (!actor.canUserModify?.(game.user, "update")) return null;
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const data = doc.toObject();
    foundry.utils.setProperty(data, "flags.player-action-ui-hub.autoApplied", true);
    await actor.createEmbeddedDocuments("Item", [data]);
    return doc.name ?? null;
  } catch (err) {
    console.error("player-action-ui-hub | applyEffect \u5931\u8D25", err);
    return null;
  }
}
async function applySelfEffectAfterCast(actor, spell) {
  try {
    const plan = auraPlanFor(spell);
    if (plan) {
      if (!actor?.canUserModify?.(game.user, "update")) return null;
      const data = buildAuraEffect(plan, actor?.level ?? 1);
      await actor.createEmbeddedDocuments("Item", [data]);
      return `${plan.spec.name} (Aura)`;
    }
    const shape = {
      target: spell?.system?.target?.value ?? null,
      area: spell?.system?.area ?? null
    };
    if (!isSelfTargeted(shape)) return null;
    const uuid = selfEffectUuid(String(spell?.system?.description?.value ?? ""));
    if (!uuid) return null;
    return await applyEffect(actor, uuid);
  } catch (err) {
    console.error("player-action-ui-hub | applySelfEffectAfterCast \u5931\u8D25", err);
    return null;
  }
}
var init_effects = __esm({
  "src/effects.ts"() {
    "use strict";
    init_aura_effects();
    __name(isSelfTargeted, "isSelfTargeted");
    __name(selfEffectUuid, "selfEffectUuid");
    __name(applyEffect, "applyEffect");
    __name(applySelfEffectAfterCast, "applySelfEffectAfterCast");
  }
});

// src/area-effects.ts
function enemiesInRange(casterToken, radiusFeet) {
  try {
    const out = [];
    for (const t of canvas?.tokens?.placeables ?? []) {
      if (!t?.actor || t.id === casterToken?.id) continue;
      if (!casterToken.actor?.isEnemyOf?.(t.actor)) continue;
      const d = casterToken.distanceTo?.(t);
      if (typeof d !== "number" || d > radiusFeet) continue;
      out.push({ token: t, actor: t.actor, distance: d });
    }
    return out;
  } catch (err) {
    console.error("player-action-ui-hub | enemiesInRange \u5931\u8D25", err);
    return [];
  }
}
async function resolveSaveAgainstEnemies(casterToken, plan, dc) {
  const results = [];
  if (plan.mode !== "save" || !plan.save) return results;
  const applyOn = plan.applyOn ?? DEFAULT_APPLY_ON;
  const targets = enemiesInRange(casterToken, plan.radius);
  for (const { actor } of targets) {
    const name = actor.name ?? "?";
    try {
      const stat = actor.saves?.[plan.save];
      if (!stat) {
        results.push({ actorName: name, degree: null, applied: false, reason: "\u6CA1\u6709\u8FD9\u9879\u8C41\u514D" });
        continue;
      }
      const roll = await stat.roll({ dc: { value: dc }, skipDialog: true, createMessage: true });
      const degree = DEGREE_NAMES[roll?.degreeOfSuccess ?? -1] ?? null;
      if (!degree || !applyOn.includes(degree)) {
        results.push({ actorName: name, degree, applied: false, reason: "\u8C41\u514D\u6210\u529F" });
        continue;
      }
      if (!actor.canUserModify?.(game.user, "update")) {
        results.push({ actorName: name, degree, applied: false, reason: "\u65E0\u6743\u9650\u4FEE\u6539\u8BE5\u89D2\u8272" });
        continue;
      }
      const doc = await fromUuid(plan.effectUuid);
      if (!doc) {
        results.push({ actorName: name, degree, applied: false, reason: "\u627E\u4E0D\u5230\u6548\u679C" });
        continue;
      }
      const data = doc.toObject();
      foundry.utils.setProperty(data, "flags.player-action-ui-hub.autoApplied", true);
      await actor.createEmbeddedDocuments("Item", [data]);
      results.push({ actorName: name, degree, applied: true, reason: null });
    } catch (err) {
      console.error(`player-action-ui-hub | \u5BF9 ${name} \u7ED3\u7B97\u8C41\u514D\u5931\u8D25`, err);
      results.push({ actorName: name, degree: null, applied: false, reason: "\u51FA\u9519\uFF0C\u8BE6\u89C1\u63A7\u5236\u53F0" });
    }
  }
  return results;
}
function saveSpecFor(slug) {
  if (!slug) return null;
  return SAVE_SPECS.find((s) => s.slug === slug) ?? null;
}
function savePlanFor(spell) {
  const spec = saveSpecFor(spell?.slug ?? null);
  if (!spec) return null;
  const radius = radiusAtRank(spell, rankOf(spell));
  const effectUuid = linkedSpellEffectUuid(spell);
  if (!radius || !effectUuid) return null;
  const save = spell?.system?.defense?.save?.statistic;
  if (save !== "fortitude" && save !== "reflex" && save !== "will") return null;
  return { mode: "save", radius, effectUuid, save, applyOn: spec.applyOn ?? DEFAULT_APPLY_ON };
}
function casterTokenOf(actor) {
  const \u5168\u90E8 = actor?.getActiveTokens?.() ?? [];
  const \u672C\u573A\u666F = \u5168\u90E8.find((t) => t?.scene?.id === canvas?.scene?.id);
  return \u672C\u573A\u666F ?? \u5168\u90E8[0] ?? null;
}
function sceneHasGrid() {
  return Number(canvas?.scene?.grid?.type ?? 0) > 0;
}
async function resolveAreaAfterCast(actor, spell) {
  try {
    const plan = savePlanFor(spell);
    if (!plan) return null;
    if (!sceneHasGrid()) {
      return "This scene has no grid \u2014 PF2e cannot measure the area reliably, so no saves were rolled.";
    }
    const token = casterTokenOf(actor);
    if (!token) return null;
    const dc = spellDC(spell);
    if (dc == null) return null;
    const results = await resolveSaveAgainstEnemies(token, plan, dc);
    return summarize(results);
  } catch (err) {
    console.error("player-action-ui-hub | resolveAreaAfterCast \u5931\u8D25", err);
    return null;
  }
}
function summarize(results) {
  if (!results.length) return "No enemies in range.";
  const hit = results.filter((r) => r.applied).map((r) => r.actorName);
  const missed = results.filter((r) => !r.applied);
  const parts = [];
  if (hit.length) parts.push(`Affected: ${hit.join(", ")}`);
  for (const r of missed) parts.push(`${r.actorName}: ${r.reason}`);
  return parts.join(" \xB7 ");
}
var DEGREE_NAMES, DEFAULT_APPLY_ON, SAVE_SPECS;
var init_area_effects = __esm({
  "src/area-effects.ts"() {
    "use strict";
    init_spell_data();
    DEGREE_NAMES = ["criticalFailure", "failure", "success", "criticalSuccess"];
    DEFAULT_APPLY_ON = ["criticalFailure", "failure"];
    __name(enemiesInRange, "enemiesInRange");
    __name(resolveSaveAgainstEnemies, "resolveSaveAgainstEnemies");
    SAVE_SPECS = [
      {
        slug: "bane",
        name: "Bane",
        rule: "Enemies in the area must succeed at a Will save or take a -1 status penalty to attack rolls as long as they are in the area."
      },
      {
        slug: "malediction",
        name: "Malediction",
        rule: "Enemies in the area must succeed at a Will save or take a -1 status penalty to AC as long as they're in the area."
      }
    ];
    __name(saveSpecFor, "saveSpecFor");
    __name(savePlanFor, "savePlanFor");
    __name(casterTokenOf, "casterTokenOf");
    __name(sceneHasGrid, "sceneHasGrid");
    __name(resolveAreaAfterCast, "resolveAreaAfterCast");
    __name(summarize, "summarize");
  }
});

// src/executor.ts
var executor_exports = {};
__export(executor_exports, {
  castSpell: () => castSpell,
  execAuxiliary: () => execAuxiliary,
  rollSkill: () => rollSkill,
  rollStrike: () => rollStrike,
  useAction: () => useAction
});
function findStrike(actor, strikeId) {
  return strikesOf(actor).find((s, i) => strikeSectorId(s, i) === strikeId) ?? null;
}
function intentEvent(realEvent) {
  const skipDefault = !game.user?.settings?.showCheckDialogs;
  const userWantsDialog = !!realEvent?.shiftKey;
  const shiftKey = userWantsDialog ? skipDefault : !skipDefault;
  return new PointerEvent("click", { shiftKey, ctrlKey: false, metaKey: false });
}
async function rollStrike(actor, strikeId, map, event) {
  try {
    const strike = findStrike(actor, strikeId);
    if (!strike) {
      ui.notifications.warn("That strike is no longer available \u2014 reopen the wheel.");
      return;
    }
    const variant = strike.variants?.[map];
    if (!variant) {
      ui.notifications.warn("That strike has no such attack in the sequence.");
      return;
    }
    await variant.roll({ event: intentEvent(event) });
  } catch (err) {
    console.error("player-action-ui-hub | rollStrike \u5931\u8D25", err);
    ui.notifications.error("The roll failed \u2014 see the console for details.");
  }
}
async function execAuxiliary(actor, strikeId, auxIndex) {
  try {
    const strike = findStrike(actor, strikeId);
    const aux = strike?.auxiliaryActions?.[auxIndex];
    if (!aux) {
      ui.notifications.warn("This weapon has no such action.");
      return;
    }
    await aux.execute();
  } catch (err) {
    console.error("player-action-ui-hub | execAuxiliary \u5931\u8D25", err);
    ui.notifications.error("The action failed \u2014 see the console for details.");
  }
}
async function rollSkill(actor, slug, event) {
  try {
    const stat = actor?.getStatistic?.(slug);
    if (!stat) {
      ui.notifications.warn("This character has no such skill.");
      return;
    }
    const wantsDialog = !!event?.shiftKey;
    await stat.roll({ skipDialog: !wantsDialog });
  } catch (err) {
    console.error("player-action-ui-hub | rollSkill \u5931\u8D25", err);
    ui.notifications.error("The check failed \u2014 see the console for details.");
  }
}
async function castSpell(actor, entryId, spellId) {
  try {
    const entry = actor?.spellcasting?.get?.(entryId);
    const spell = entry?.spells?.get?.(spellId);
    if (!entry || !spell) {
      ui.notifications.warn("That spell is no longer available \u2014 reopen the wheel.");
      return;
    }
    await entry.cast(spell, { rank: spell.rank });
    const applied = await applySelfEffectAfterCast(actor, spell);
    if (applied) ui.notifications.info(`${applied} applied.`);
    const \u7ED3\u7B97 = await resolveAreaAfterCast(actor, spell);
    if (\u7ED3\u7B97) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><strong>${spell.name}</strong></p><p>${\u7ED3\u7B97}</p>`
      });
    }
  } catch (err) {
    console.error("player-action-ui-hub | castSpell \u5931\u8D25", err);
    ui.notifications.error("Casting failed \u2014 see the console for details.");
  }
}
async function useAction(actor, slug, event) {
  try {
    const action = game.pf2e?.actions?.get(slug);
    if (!action) {
      ui.notifications.warn("That action is not available in this world.");
      return;
    }
    await action.use({ actors: actor ? [actor] : [], event: intentEvent(event) });
  } catch (err) {
    console.error("player-action-ui-hub | useAction \u5931\u8D25", err);
    ui.notifications.error("The action failed \u2014 see the console for details.");
  }
}
var init_executor = __esm({
  "src/executor.ts"() {
    "use strict";
    init_strikes();
    init_effects();
    init_area_effects();
    __name(findStrike, "findStrike");
    __name(intentEvent, "intentEvent");
    __name(rollStrike, "rollStrike");
    __name(execAuxiliary, "execAuxiliary");
    __name(rollSkill, "rollSkill");
    __name(castSpell, "castSpell");
    __name(useAction, "useAction");
  }
});

// src/geometry.ts
var TAU = Math.PI * 2;
function polar(cx, cy, r, angle) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}
__name(polar, "polar");
function sectorAngles(spec, index) {
  const { total, gap = 0, arcSpan = TAU, center = -Math.PI / 2 } = spec;
  const step = arcSpan / total;
  const start = center - arcSpan / 2 + index * step;
  return { a0: start + gap / 2, a1: start + step - gap / 2 };
}
__name(sectorAngles, "sectorAngles");
function sectorArc(spec, index) {
  const { R: R2, W: W2 } = spec;
  const { a0, a1 } = sectorAngles(spec, index);
  const circumference = TAU * R2;
  const drawn = (a1 - a0) * R2;
  return {
    dash: `${drawn.toFixed(3)} ${(circumference - drawn).toFixed(3)}`,
    rotate: a0 * 180 / Math.PI,
    strokeWidth: 2 * W2
  };
}
__name(sectorArc, "sectorArc");
function sectorCentroid(spec, index) {
  const { a0, a1 } = sectorAngles(spec, index);
  return polar(spec.cx, spec.cy, spec.R, (a0 + a1) / 2);
}
__name(sectorCentroid, "sectorCentroid");
function ringCapPath(spec, which, bulge = 1) {
  const { cx, cy, R: R2, W: W2 } = spec;
  const angles = which === "start" ? sectorAngles(spec, 0).a0 : sectorAngles(spec, spec.total - 1).a1;
  const nx = Math.cos(angles);
  const ny = Math.sin(angles);
  const outer = { x: cx + (R2 + W2) * nx, y: cy + (R2 + W2) * ny };
  const inner = { x: cx + (R2 - W2) * nx, y: cy + (R2 - W2) * ny };
  const sweep = which === "start" ? 0 : 1;
  const f = /* @__PURE__ */ __name((n) => n.toFixed(3), "f");
  const radialR = W2;
  const tangentR = W2 * bulge;
  const rot = angles * 180 / Math.PI;
  return `M ${f(outer.x)} ${f(outer.y)} A ${f(radialR)} ${f(tangentR)} ${f(rot)} 0 ${sweep} ${f(inner.x)} ${f(inner.y)} Z`;
}
__name(ringCapPath, "ringCapPath");
function capOvershoot(R2, W2, bulge = 1) {
  return Math.asin(Math.min(1, W2 * bulge / R2));
}
__name(capOvershoot, "capOvershoot");

// src/text.ts
function charWidth(ch) {
  return /[　-〿一-鿿＀-￯]/.test(ch) ? 1 : 0.5;
}
__name(charWidth, "charWidth");
function textWidth(s) {
  return [...s].reduce((n, c) => n + charWidth(c), 0);
}
__name(textWidth, "textWidth");
function wrapText(text, maxUnits) {
  const tokens = text.match(/[　-〿一-鿿＀-￯]|\s+|[^\s　-〿一-鿿＀-￯]+/g) ?? [];
  const lines = [];
  let cur = "";
  let w = 0;
  for (const tk of tokens) {
    const tw = textWidth(tk);
    if (/^\s+$/.test(tk)) {
      if (cur) {
        cur += tk;
        w += tw;
      }
      continue;
    }
    if (w + tw > maxUnits && cur) {
      lines.push(cur.trimEnd());
      cur = "";
      w = 0;
    }
    cur += tk;
    w += tw;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}
__name(wrapText, "wrapText");

// src/economy.ts
var ACTIONS_PER_TURN = 3;
var REACTIONS_PER_TURN = 1;
var ledgers = /* @__PURE__ */ new Map();
function costToPoints(cost) {
  switch (cost) {
    case "1":
      return 1;
    case "2":
      return 2;
    case "3":
      return 3;
    default:
      return 0;
  }
}
__name(costToPoints, "costToPoints");
function ledgerFor(actorId, round) {
  const cur = ledgers.get(actorId);
  if (!cur || cur.round !== round) {
    const fresh = { spent: 0, round, history: [], reactions: 0 };
    ledgers.set(actorId, fresh);
    return fresh;
  }
  return cur;
}
__name(ledgerFor, "ledgerFor");
function remaining(actorId, round) {
  return ACTIONS_PER_TURN - ledgerFor(actorId, round).spent;
}
__name(remaining, "remaining");
function spend(actorId, round, n) {
  if (n <= 0) return;
  const l = ledgerFor(actorId, round);
  l.spent += n;
  l.history.push(n);
}
__name(spend, "spend");
function undoLast(actorId, round) {
  const l = ledgerFor(actorId, round);
  const last = l.history.pop();
  if (last === void 0) return 0;
  l.spent = Math.max(0, l.spent - last);
  return last;
}
__name(undoLast, "undoLast");
function canUndo(actorId, round) {
  return ledgerFor(actorId, round).history.length > 0;
}
__name(canUndo, "canUndo");
function reactionsLeft(actorId, round) {
  return REACTIONS_PER_TURN - ledgerFor(actorId, round).reactions;
}
__name(reactionsLeft, "reactionsLeft");
function spendReaction(actorId, round) {
  ledgerFor(actorId, round).reactions += 1;
}
__name(spendReaction, "spendReaction");
function glyphs(remainingCount) {
  if (remainingCount >= 0) {
    const left = Math.min(remainingCount, ACTIONS_PER_TURN);
    return "\u25C6".repeat(left) + "\u25C7".repeat(ACTIONS_PER_TURN - left);
  }
  return "\u25C7".repeat(ACTIONS_PER_TURN) + "\u2715".repeat(Math.min(-remainingCount, 3));
}
__name(glyphs, "glyphs");
function reactionGlyph(left) {
  return left > 0 ? "\u27F3" : "\u27F2";
}
__name(reactionGlyph, "reactionGlyph");

// src/paging.ts
var PAGE_SIZE = 7;
function pageCount(total) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
__name(pageCount, "pageCount");
function normalizePage(page, count) {
  if (count <= 0) return 0;
  return (page % count + count) % count;
}
__name(normalizePage, "normalizePage");
function pageOf(items, page) {
  if (!items.length) return [];
  const p = normalizePage(page, pageCount(items.length));
  return items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
}
__name(pageOf, "pageOf");

// src/wheel-app.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var CX = 100;
var CY = 100;
var SIZE = 320;
var R_HUB = 68;
var GUTTER = 5;
var W = 13.5;
var R = R_HUB + GUTTER + W;
var R_OUTER = R + W;
var VIEW = 2 * R_OUTER;
var AppV2 = foundry.applications.api.ApplicationV2;
var HUB_CHARS_PER_LINE = 16;
var HUB_TITLE_CENTER = CY - 4;
var HUB_VARIANT_Y = CY + 19;
var HUB_STATE_Y = CY + 28;
var HUB_ECONOMY_Y = CY + 38;
var SECTOR_GAP = 0.02;
var CAP_H = 2 * W;
var W_CAP = CAP_H / 2;
var CAP_SEAM = 1.6;
var CAP_INK = 56 * Math.PI / 180;
var CAP_BULGE = 1;
var CAP_GAP_HALF = CAP_SEAM / R / 2;
var GAP_ANGLE = 2 * (CAP_INK / 2 - CAP_GAP_HALF + SECTOR_GAP + capOvershoot(R, W, CAP_BULGE) - SECTOR_GAP / 2);
var ARC_SPAN = Math.PI * 2 - GAP_ANGLE;
var IDLE_DISMISS_MS = 5e3;
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(v, hi));
}
__name(clamp, "clamp");
var WheelApp = class extends AppV2 {
  static {
    __name(this, "WheelApp");
  }
  static DEFAULT_OPTIONS = {
    id: "player-action-ui-hub-wheel",
    classes: ["pauih-wheel"],
    window: { frame: false, positioned: true },
    position: { width: SIZE, height: SIZE }
  };
  /** 当前层 */
  level;
  /**
   * 点击扇区的回调，由外部注入。
   * ⚠ 第二个参数是**真实的 MouseEvent**，不是合成的：掷骰时要原样传给
   *   pf2e 的 `variant.roll({ event })`，生态里的模组（PF2e Toolbelt 自动掩护等）
   *   靠它拿检定上下文（设计定档 §6.3）。
   */
  onPick;
  /** 点击盘外关闭用的监听器，记着以便解绑 */
  outsideHandler;
  /** Esc 关闭用的监听器（Foundry 不管无框窗，见 openAt 注释），记着以便解绑 */
  escHandler;
  constructor(level, onPick, options = {}) {
    super(options);
    this.level = level;
    this.onPick = onPick;
  }
  /**
   * 重算当前层的回调，由外部注入；**没有它就不会自动刷新**。
   * 返回 null 表示这一层已经无内容可显示（例如角色的打击全没了）→ 关盘。
   */
  rebuild;
  /** refresh 的合并闸，见 refresh() 的注释 */
  #refreshQueued = false;
  /**
   * 取动作经济现状的回调，由外部注入。
   * **不在战斗中要返回 null** —— 战斗外没有"回合"，画 ◆◆◇ 是假信息。
   */
  economy;
  /** 点了撤回时调用，由外部注入（真正的记账退还在外面做）。 */
  onUndo;
  /**
   * 取职业状态行的回调，由外部注入。返回空数组 = 这一格不出现。
   * ⚠ 与 economy 不同，它**不受"在不在战斗中"限制** ——
   *   专注点余量在战斗外一样有意义。
   */
  classState;
  /** 无操作自动收起的计时器 */
  #idleTimer;
  /** 换一层内容并重绘（钻取与双向绑定都走这里） */
  async setLevel(level) {
    this.level = level;
    await this.render(false);
  }
  /**
   * 角色数据变了：重算当前层并重绘。轮盘＝角色卡的另一个实时视图，
   * 靠这个方法兑现。
   *
   * ⚠ **必须合并**：一次拔刀会连着放出好几个文档钩子
   * （物品的 equipped 变了 → updateItem，派生数据重算 → updateActor），
   * 每个都直接 render 会在同一帧里重绘好几次，白闪且互相抢。
   * 这里推迟到下一个宏任务再做，把这一串合成一次。
   *
   * 层结构不变时保留翻选条的下标——玩家翻到第 2 击，不该因为拔了把刀就跳回第 1 击。
   */
  async refresh() {
    if (!this.rebuild || this.#refreshQueued) return;
    this.#refreshQueued = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.#refreshQueued = false;
    if (!this.rendered || !this.rebuild) return;
    const next = this.rebuild();
    if (!next) {
      await this.close();
      return;
    }
    if (this.level.variant && next.variant) next.variant.index = this.level.variant.index;
    await this.setLevel(next);
  }
  // ⚠ 计划原文写的返回类型是 Promise<HTMLElement>，tsc 报 TS2740：
  //   SVGSVGElement 不是 HTMLElement。这里按实际产物改成 SVGElement。
  //   AppV2 对 _renderHTML 的返回值不限类型，它只是原样传给 _replaceHTML。
  async _renderHTML() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${VIEW} ${VIEW}`);
    svg.setAttribute("class", "pauih-svg");
    const visible = this.#visibleSectors();
    const total = visible.length;
    const ring = { cx: CX, cy: CY, R, W, total, gap: SECTOR_GAP, arcSpan: ARC_SPAN };
    visible.forEach(({ sector, index }, pos) => {
      const group = document.createElementNS(SVG_NS, "g");
      const group_cls = `pauih-sector-g state-${sector.state}`;
      group.setAttribute("class", group_cls);
      const draw = sectorArc(ring, pos);
      const spin = document.createElementNS(SVG_NS, "g");
      spin.setAttribute("transform", `rotate(${draw.rotate} ${CX} ${CY})`);
      const arc = document.createElementNS(SVG_NS, "circle");
      arc.setAttribute("cx", String(CX));
      arc.setAttribute("cy", String(CY));
      arc.setAttribute("r", String(R));
      arc.setAttribute("stroke-width", String(draw.strokeWidth));
      arc.setAttribute("stroke-dasharray", draw.dash);
      arc.setAttribute("class", `pauih-sector state-${sector.state}`);
      arc.dataset.index = String(index);
      spin.appendChild(arc);
      group.appendChild(spin);
      if (pos === 0 || pos === total - 1) {
        const cap = document.createElementNS(SVG_NS, "path");
        cap.setAttribute("d", ringCapPath(ring, pos === 0 ? "start" : "end", CAP_BULGE));
        cap.setAttribute("class", `pauih-sector-cap state-${sector.state}`);
        cap.dataset.index = String(index);
        group.appendChild(cap);
      }
      svg.appendChild(group);
      const c = sectorCentroid(ring, pos);
      if (sector.img) {
        const size = 18;
        const img = document.createElementNS(SVG_NS, "image");
        img.setAttribute("href", sector.img);
        img.setAttribute("x", String(c.x - size / 2));
        img.setAttribute("y", String(c.y - size / 2 - (sector.badge ? 3 : 0)));
        img.setAttribute("width", String(size));
        img.setAttribute("height", String(size));
        img.setAttribute("class", `pauih-icon state-${sector.state}`);
        img.dataset.index = String(index);
        svg.appendChild(img);
      } else {
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(c.x));
        text.setAttribute("y", String(c.y));
        text.setAttribute("class", `pauih-label state-${sector.state}`);
        text.textContent = sector.label;
        text.dataset.index = String(index);
        svg.appendChild(text);
      }
      if (sector.badge) {
        const badge = document.createElementNS(SVG_NS, "text");
        badge.setAttribute("x", String(c.x));
        badge.setAttribute("y", String(c.y + (sector.img ? 8 : 9)));
        badge.setAttribute("class", `pauih-badge state-${sector.state}`);
        badge.textContent = sector.badge;
        badge.dataset.index = String(index);
        svg.appendChild(badge);
      }
    });
    const hub = document.createElementNS(SVG_NS, "circle");
    hub.setAttribute("cx", String(CX));
    hub.setAttribute("cy", String(CY));
    hub.setAttribute("r", String(R_HUB));
    hub.setAttribute("class", "pauih-hub");
    svg.appendChild(hub);
    this.#paintCapsule(svg);
    const hubText = document.createElementNS(SVG_NS, "g");
    hubText.setAttribute("class", "pauih-hub-text");
    svg.appendChild(hubText);
    this.#paintHub(hubText, null);
    return svg;
  }
  /**
   * 画底部导航胶囊（照 Nous 2026-08-05 的 mockup）。
   *
   * 三格：‹ 上一项 · ↩ 返回 · › 下一项。
   * **它是通用导航条**：上面这一层是什么，‹› 就翻什么 ——
   * 打击层翻 MAP 三段，将来条目多到要分页时就翻页。
   * 没得翻时箭头置灰不可点，但格子照画，免得胶囊忽宽忽窄。
   */
  #paintCapsule(svg) {
    const canCycle = this.#arrowMode() !== "none";
    const cells = [
      { action: "next", glyph: "\u203A", enabled: canCycle },
      { action: "back", glyph: "\u21A9", enabled: this.level.canGoBack },
      { action: "prev", glyph: "\u2039", enabled: canCycle }
    ];
    const bar = {
      cx: CX,
      cy: CY,
      R,
      W: W_CAP,
      total: cells.length,
      gap: CAP_SEAM / R,
      // 缝按弧长给，换算成角
      arcSpan: CAP_INK - 2 * capOvershoot(R, W_CAP),
      center: Math.PI / 2
      // 整段弧的中心指向正下方
    };
    cells.forEach((cell, index) => {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", `pauih-cap-g${cell.enabled ? "" : " disabled"}`);
      const draw = sectorArc(bar, index);
      const spin = document.createElementNS(SVG_NS, "g");
      spin.setAttribute("transform", `rotate(${draw.rotate} ${CX} ${CY})`);
      const arc = document.createElementNS(SVG_NS, "circle");
      arc.setAttribute("cx", String(CX));
      arc.setAttribute("cy", String(CY));
      arc.setAttribute("r", String(R));
      arc.setAttribute("stroke-width", String(draw.strokeWidth));
      arc.setAttribute("stroke-dasharray", draw.dash);
      arc.setAttribute("class", "pauih-cap");
      if (cell.enabled) arc.dataset.nav = cell.action;
      spin.appendChild(arc);
      group.appendChild(spin);
      if (index === 0 || index === cells.length - 1) {
        const end = document.createElementNS(SVG_NS, "path");
        end.setAttribute("d", ringCapPath(bar, index === 0 ? "start" : "end"));
        end.setAttribute("class", "pauih-cap-end");
        if (cell.enabled) end.dataset.nav = cell.action;
        group.appendChild(end);
      }
      svg.appendChild(group);
      const c = sectorCentroid(bar, index);
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(c.x));
      t.setAttribute("y", String(c.y));
      t.setAttribute("class", `pauih-cap-glyph${cell.enabled ? "" : " disabled"}`);
      t.textContent = cell.glyph;
      svg.appendChild(t);
    });
  }
  /**
   * 重画中心毂文字。
   *
   * ⚠ SVG 的 `<text>` **没有自动换行**（不像 HTML），整句塞进去会横着冲出轮盘、
   * 盖住扇区 —— 2026-08-04 实机就是这么翻车的。必须自己断行成多个 `<tspan>`。
   *
   * @param sector 悬停中的扇区；null = 没悬停，只显示层标题
   */
  #paintHub(g, sector) {
    g.replaceChildren();
    const line = /* @__PURE__ */ __name((text, y, cls) => {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(CX));
      t.setAttribute("y", String(y));
      t.setAttribute("class", cls);
      t.textContent = text;
      g.appendChild(t);
    }, "line");
    const center = HUB_TITLE_CENTER;
    if (!sector) {
      line(this.level.title, center, "pauih-hub-title");
    } else {
      const detailLines = sector.detail ? [sector.detail] : [];
      const reasonLines = sector.reason ? wrapText(sector.reason, HUB_CHARS_PER_LINE) : [];
      const lineHeight = 7;
      const extra = detailLines.length + reasonLines.length;
      const blockHeight = extra ? extra * lineHeight + 5 : 0;
      let y = center - blockHeight / 2;
      line(sector.label, y, "pauih-hub-title");
      y += 9;
      for (const d of detailLines) {
        line(d, y, "pauih-hub-detail");
        y += lineHeight;
      }
      for (const l of reasonLines) {
        line(l, y, `pauih-hub-reason state-${sector.state}`);
        y += lineHeight;
      }
    }
    const mode = this.#arrowMode();
    if (mode === "page") {
      const total = this.#pageCount();
      line(
        `${normalizePage(this.level.paging.page, total) + 1} / ${total}`,
        HUB_VARIANT_Y,
        "pauih-variant"
      );
    } else if (this.level.variant?.labels.length) {
      const v = this.level.variant;
      line(v.labels[v.index] ?? "", HUB_VARIANT_Y, "pauih-variant");
    }
    const state = this.classState?.() ?? [];
    if (state.length) line(state.join(" \xB7 "), HUB_STATE_Y, "pauih-class-state");
    this.#paintEconomy(g);
  }
  /**
   * 毂底的动作经济行：三个菱形 + 一个红色 « 撤回（Nous 2026-08-05 定的形态）。
   *
   * ★ **系统不记这件事**，这是我们自己的账（见 economy.ts 顶部）；
   *   **只显示不阻止**，余额为负也照实画出来。
   * ⚠ 撤回退的是**动作点记账**，不是把骰子收回来 —— 已经进聊天栏的收不回。
   */
  #paintEconomy(g) {
    const econ = this.economy?.();
    if (!econ) return;
    const y = HUB_ECONOMY_Y;
    const pipDx = 8;
    const pips = glyphs(econ.remaining);
    const hasReaction = econ.reactionsLeft !== void 0;
    const cells = pips.length + (hasReaction ? 1 : 0);
    const startX = CX - (cells - 1) * pipDx / 2 - 7;
    [...pips].forEach((ch, i) => {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(startX + i * pipDx));
      t.setAttribute("y", String(y));
      t.setAttribute("class", `pauih-pip${ch === "\u25C6" ? " full" : ch === "\u2715" ? " over" : ""}`);
      t.textContent = ch;
      g.appendChild(t);
    });
    if (hasReaction) {
      const left = econ.reactionsLeft;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(startX + pips.length * pipDx + pipDx / 2));
      t.setAttribute("y", String(y));
      t.setAttribute("class", `pauih-reaction${left > 0 ? " full" : ""}`);
      t.textContent = reactionGlyph(left);
      g.appendChild(t);
    }
    const undo = document.createElementNS(SVG_NS, "text");
    undo.setAttribute("x", String(startX + cells * pipDx + (hasReaction ? pipDx / 2 : 0) + 3));
    undo.setAttribute("y", String(y));
    undo.setAttribute("class", `pauih-undo${econ.canUndo ? "" : " disabled"}`);
    undo.textContent = "\xAB";
    if (econ.canUndo) undo.dataset.nav = "undo";
    g.appendChild(undo);
  }
  /** 当前变体下标（0 = 第 1 击）；这一层没有翻选条时返回 0。 */
  currentVariantIndex() {
    return this.level.variant?.index ?? 0;
  }
  /**
   * 当前页要画的扇区，**带上它们在全量里的下标**。
   * 没有分页状态时就是全部（下标即位置）。
   */
  #visibleSectors() {
    const all = this.level.sectors.map((sector, index) => ({ sector, index }));
    return this.level.paging ? pageOf(all, this.level.paging.page) : all;
  }
  /** 这一层总共几页；没有分页状态时恒为 1。 */
  #pageCount() {
    return this.level.paging ? pageCount(this.level.sectors.length) : 1;
  }
  /**
   * 胶囊的 `‹ ›` 现在管什么。**分页优先于 MAP 翻选** ——
   * 两者抢同一对箭头，一层不该同时开（见 types.ts 的 paging 注释）。
   */
  #arrowMode() {
    if (this.level.paging && this.#pageCount() > 1) return "page";
    if ((this.level.variant?.labels.length ?? 0) > 1) return "variant";
    return "none";
  }
  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.addEventListener("click", this.#onClick);
    content.addEventListener("mouseover", this.#onHover);
    content.addEventListener("mousemove", this.#touchIdle);
  }
  /**
   * 续上"无操作自动收起"的计时（Nous 2026-08-05 提出：晾着不动会挡视野）。
   * 任何交互——移动鼠标、点击、翻页、重绘——都会重新计时。
   */
  #touchIdle = /* @__PURE__ */ __name(() => {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      void this.close();
    }, IDLE_DISMISS_MS);
  }, "#touchIdle");
  #onClick = /* @__PURE__ */ __name((ev) => {
    this.#touchIdle();
    const el = ev.target;
    const nav = el?.dataset?.nav;
    if (nav) {
      if (nav === "prev" || nav === "next") {
        const delta = nav === "next" ? 1 : -1;
        const mode = this.#arrowMode();
        if (mode === "page" && this.level.paging) {
          this.level.paging.page += delta;
          void this.render(false);
        } else if (mode === "variant" && this.level.variant) {
          const v = this.level.variant;
          v.index = (v.index + (delta === 1 ? 1 : v.labels.length - 1)) % v.labels.length;
          void this.render(false);
        }
      } else if (nav === "undo") {
        this.onUndo?.();
        void this.render(false);
      } else if (nav === "back") {
        this.onPick({ id: "__back", label: "Back", cost: null, state: "normal" }, ev);
      }
      return;
    }
    const idx = el?.dataset?.index;
    if (idx === void 0) return;
    const sector = this.level.sectors[Number(idx)];
    if (sector) this.onPick(sector, ev);
  }, "#onClick");
  #onHover = /* @__PURE__ */ __name((ev) => {
    const el = ev.target;
    if (el?.dataset?.nav !== void 0) return;
    const idx = el?.dataset?.index;
    const g = this.element?.querySelector(".pauih-hub-text");
    if (!g) return;
    const sector = idx === void 0 ? null : this.level.sectors[Number(idx)] ?? null;
    this.#paintHub(g, sector);
  }, "#onHover");
  /**
   * 在指定屏幕坐标处弹出（**以该点为圆心**），并接管 Esc 与点击盘外关闭。
   * 靠近屏幕边缘时会把盘面拉回可视区内，否则贴边呼出会有半个盘在屏幕外、扇区点不到。
   */
  async openAt(x, y) {
    await this.render(true);
    const margin = 4;
    const left = clamp(x - SIZE / 2, margin, window.innerWidth - SIZE - margin);
    const top = clamp(y - SIZE / 2, margin, window.innerHeight - SIZE - margin);
    this.setPosition({ left, top });
    this.outsideHandler = (ev) => {
      if (!this.element?.contains(ev.target)) void this.close();
    };
    this.escHandler = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      void this.close();
    };
    this.#touchIdle();
    setTimeout(() => {
      document.addEventListener("mousedown", this.outsideHandler);
      document.addEventListener("keydown", this.escHandler, { capture: true });
    }, 0);
  }
  async close(options = {}) {
    this.rebuild = void 0;
    if (this.outsideHandler) {
      document.removeEventListener("mousedown", this.outsideHandler);
      this.outsideHandler = void 0;
    }
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = void 0;
    }
    if (this.escHandler) {
      document.removeEventListener("keydown", this.escHandler, { capture: true });
      this.escHandler = void 0;
    }
    return super.close(options);
  }
};

// src/target.ts
function resolveActor() {
  const controlled = canvas?.tokens?.controlled?.[0]?.actor;
  if (controlled) return controlled;
  const bound = game?.user?.character;
  if (bound) return bound;
  return null;
}
__name(resolveActor, "resolveActor");

// src/collectors/index.ts
init_strikes();

// src/usage.ts
var MODULE_ID = "player-action-ui-hub";
var SETTING = "actionUsage";
var PROMOTE_AT = 5;
var EMPTY = { counts: {}, promoted: [] };
function registerUsageSetting() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "Action usage history",
    hint: "Which actions you have used. Actions you use often move into the front of the Actions wheel and then stay put.",
    scope: "client",
    // 使用习惯是每个玩家各自的
    config: false,
    // 不在设置面板里露出，它不是给人手改的
    type: Object,
    default: EMPTY
  });
}
__name(registerUsageSetting, "registerUsageSetting");
function usage() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTING);
    return {
      counts: raw?.counts ?? {},
      promoted: Array.isArray(raw?.promoted) ? raw.promoted : []
    };
  } catch {
    return EMPTY;
  }
}
__name(usage, "usage");
function withUse(rec, slug) {
  const counts = { ...rec.counts, [slug]: (rec.counts[slug] ?? 0) + 1 };
  const promoted = rec.promoted.includes(slug) || counts[slug] < PROMOTE_AT ? rec.promoted : [...rec.promoted, slug];
  return { counts, promoted };
}
__name(withUse, "withUse");
function bump(slug) {
  try {
    void game.settings.set(MODULE_ID, SETTING, withUse(usage(), slug));
  } catch (err) {
    console.error(`${MODULE_ID} | \u8BB0\u5F55\u52A8\u4F5C\u4F7F\u7528\u5931\u8D25`, err);
  }
}
__name(bump, "bump");
function promotedRank(rec) {
  const order = new Map(rec.promoted.map((s, i) => [s, i]));
  return (slug) => order.get(slug) ?? Number.POSITIVE_INFINITY;
}
__name(promotedRank, "promotedRank");

// src/icons.ts
var CATEGORY_ICONS = {
  strikes: "icons/svg/sword.svg",
  actions: "icons/svg/walk.svg",
  skills: "icons/svg/book.svg",
  class: "icons/svg/tower-flag.svg",
  spells: "icons/svg/aura.svg"
};
var SKILL_ICONS = {
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
  thievery: "icons/svg/padlock.svg"
};
var LORE_ICON = "icons/svg/book.svg";
var ACTION_ICONS = {
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
  "avert-gaze": "icons/svg/blind.svg"
};
var SKILL_ACTION_ICONS = {
  "recall-knowledge": "icons/skills/trades/academics-book-study-runes.webp",
  "identify-magic": "icons/magic/symbols/question-stone-yellow.webp",
  "identify-alchemy": "icons/skills/trades/academics-investigation-puzzles.webp",
  "learn-a-spell": "icons/skills/trades/academics-study-reading-book.webp"
};
var CHECK_ICON = "icons/svg/d20-grey.svg";
var SPELL_ENTRY_ICONS = {
  focus: "icons/svg/aura.svg",
  ritual: "icons/svg/statue.svg"
};
var SPELL_ENTRY_DEFAULT = "icons/svg/book.svg";
function isGenericIcon(img) {
  return !img || img.startsWith("systems/pf2e/icons/actions/");
}
__name(isGenericIcon, "isGenericIcon");
function iconFor(img, fallback) {
  return isGenericIcon(img) ? fallback : img;
}
__name(iconFor, "iconFor");

// src/collectors/skills.ts
function isSkillAction(a) {
  if (a.section === "basic" || a.section === "specialty-basic") return false;
  if (a.section === "skill") return true;
  return statisticList(a.statistic).filter(Boolean).length > 0;
}
__name(isSkillAction, "isSkillAction");
function rankSkills(list) {
  return [...list].sort((x, y) => (y.rank > 0 ? 1 : 0) - (x.rank > 0 ? 1 : 0) || y.rank - x.rank || x.label.localeCompare(y.label));
}
__name(rankSkills, "rankSkills");
function rankName(rank) {
  return ["Untrained", "Trained", "Expert", "Master", "Legendary"][rank] ?? "Untrained";
}
__name(rankName, "rankName");
function skillIcon(slug) {
  return SKILL_ICONS[slug] ?? (slug.endsWith("-lore") ? LORE_ICON : LORE_ICON);
}
__name(skillIcon, "skillIcon");
function collectSkills(actor) {
  try {
    const a = actor;
    const skills = a?.skills ?? {};
    const coll = game.pf2e?.actions;
    const raw = coll ? [...coll.values()] : [];
    const countBySkill = /* @__PURE__ */ new Map();
    for (const act of raw) {
      if (!isSkillAction(act) || act.traits?.includes("downtime")) continue;
      for (const st of statisticList(act.statistic).filter(Boolean)) {
        countBySkill.set(st, (countBySkill.get(st) ?? 0) + 1);
      }
    }
    const entries = Object.entries(skills).map(([slug, s]) => ({
      slug,
      label: String(s?.label ?? slug),
      rank: s?.rank ?? 0,
      mod: s?.mod ?? 0,
      actionCount: countBySkill.get(slug) ?? 0
    }));
    return rankSkills(entries).map((s) => ({
      id: `skill:${s.slug}`,
      label: s.label,
      // ⚠ 技能是 Statistic 不是 item，**没有 img 字段**，只能全部自己配
      img: skillIcon(s.slug),
      cost: null,
      state: "normal",
      // ★ 修正值走 detail（悬停时在毂里显示），**不印在扇区上** ——
      //   扇区底下挂一行小字既挤又难认（Nous 2026-08-05 指出）。
      detail: `${s.mod >= 0 ? "+" : ""}${s.mod} \xB7 ${rankName(s.rank)}`
    }));
  } catch (err) {
    console.error("player-action-ui-hub | collectSkills \u5931\u8D25", err);
    return [];
  }
}
__name(collectSkills, "collectSkills");
function collectSkillActions(actor, skillSlug) {
  try {
    const a = actor;
    const stat = a?.getStatistic?.(skillSlug);
    const out = [];
    if (stat) {
      out.push({
        id: `skillcheck:${skillSlug}`,
        /*
         * ★ 名字要完整（`Acrobatics Check`），不缩成 `Check`。
         *   一度缩过，理由是"层标题已经是技能名、且长名字压出扇区"——
         *   但**扇区上走的是图标**（见下面的 img），label 只在毂里出现，
         *   长度根本不受限。而毂里只写 `Check` 是没信息量的
         *   （Nous 2026-08-05：主标题该是 `Acrobatics Check`，`+13` 才是小字）。
         */
        label: `${stat.label} Check`,
        img: CHECK_ICON,
        cost: null,
        state: "normal",
        detail: `${stat.mod >= 0 ? "+" : ""}${stat.mod}`
      });
    }
    const coll = game.pf2e?.actions;
    for (const act of coll ? [...coll.values()] : []) {
      if (!isSkillAction(act) || act.traits?.includes("downtime")) continue;
      if (!statisticList(act.statistic).includes(skillSlug)) continue;
      out.push({
        id: `action:${act.slug}`,
        label: game.i18n.localize(act.name),
        // pf2e 没给图标的那几个用本地库补上，否则长名字会压出扇区
        img: iconFor(act.img, SKILL_ACTION_ICONS[act.slug]),
        cost: costToSectorCost(act.cost),
        state: "normal"
      });
    }
    return out;
  } catch (err) {
    console.error("player-action-ui-hub | collectSkillActions \u5931\u8D25", err);
    return [];
  }
}
__name(collectSkillActions, "collectSkillActions");

// src/collectors/actions.ts
function costToSectorCost(cost) {
  if (cost === 1 || cost === "1") return "1";
  if (cost === 2 || cost === "2") return "2";
  if (cost === 3 || cost === "3") return "3";
  if (cost === "reaction" || cost === "free") return cost;
  return null;
}
__name(costToSectorCost, "costToSectorCost");
function statisticList(statistic) {
  if (!statistic) return [];
  return Array.isArray(statistic) ? statistic : [statistic];
}
__name(statisticList, "statisticList");
var COLD_START_ORDER = [
  "stride",
  "step",
  "seek",
  "take-cover",
  "aid",
  "demoralize",
  "trip",
  "grapple",
  "shove",
  "escape",
  "hide",
  "feint",
  "tumble-through",
  "ready",
  "delay",
  "stand",
  "drop-prone",
  "recall-knowledge",
  "point-out",
  "interact"
];
function tierOf(a, rankOf2) {
  if (a.traits.includes("exploration")) return 4;
  if (a.section === "basic") return 0;
  if (a.section === "specialty-basic") return 1;
  const stats = statisticList(a.statistic).filter(Boolean);
  if (stats.length === 0) return 1;
  return Math.max(...stats.map(rankOf2)) >= 1 ? 2 : 3;
}
__name(tierOf, "tierOf");
function rankActions(list, rankOf2, frontOf = () => Number.POSITIVE_INFINITY) {
  return list.filter((a) => !a.traits.includes("downtime")).map((a) => {
    const cold = COLD_START_ORDER.indexOf(a.slug);
    return {
      a,
      front: frontOf(a.slug),
      cold: cold < 0 ? Number.MAX_SAFE_INTEGER : cold,
      tier: tierOf(a, rankOf2)
    };
  }).sort((x, y) => x.front - y.front || x.cold - y.cold || x.tier - y.tier || x.a.slug.localeCompare(y.a.slug)).map((x) => x.a);
}
__name(rankActions, "rankActions");
function collectActions(actor) {
  try {
    const coll = game.pf2e?.actions;
    if (!coll) return [];
    const raw = [...coll.values()].filter((a) => !isSkillAction(a));
    const rankOf2 = /* @__PURE__ */ __name((slug) => actor?.getStatistic?.(slug)?.rank ?? 0, "rankOf");
    const front = promotedRank(usage());
    return rankActions(raw, rankOf2, front).map((a) => ({
      id: `action:${a.slug}`,
      // ⚠ 必须 localize，理由见 RawAction.name 的注释
      label: game.i18n.localize(a.name),
      // ⚠ 实测 25 条基础动作里 20 条用的是 pf2e 的**通用消耗图标**
      //   （OneAction.webp 之流）—— 一圈全长一样等于没有图标，要换掉
      img: iconFor(a.img, ACTION_ICONS[a.slug]),
      cost: costToSectorCost(a.cost),
      state: "normal"
    }));
  } catch (err) {
    console.error("player-action-ui-hub | collectActions \u5931\u8D25", err);
    return [];
  }
}
__name(collectActions, "collectActions");

// src/collectors/class-abilities.ts
function belongsToClass(item, classSlug, resolve) {
  const seen = /* @__PURE__ */ new Set();
  let cur = item;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.traits?.includes(classSlug)) return true;
    cur = cur.grantedById ? resolve(cur.grantedById) : void 0;
  }
  return false;
}
__name(belongsToClass, "belongsToClass");
function iconFromChain(item, resolve) {
  const seen = /* @__PURE__ */ new Set();
  let cur = item;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (!isGenericIcon(cur.img)) return cur.img;
    cur = cur.grantedById ? resolve(cur.grantedById) : void 0;
  }
  return void 0;
}
__name(iconFromChain, "iconFromChain");
function pickClassItems(items, classSlug, resolve) {
  if (!classSlug) return [];
  return items.filter((i) => {
    if (i.actionType === "passive") return false;
    return belongsToClass(i, classSlug, resolve);
  });
}
__name(pickClassItems, "pickClassItems");
function className(actor) {
  return actor?.class?.name ?? null;
}
__name(className, "className");
function collectClassAbilities(actor) {
  try {
    const classSlug = actor?.class?.slug ?? null;
    if (!classSlug) return [];
    const items = (actor?.items?.contents ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      img: i.img,
      traits: i.system?.traits?.value ?? [],
      actionType: i.system?.actionType?.value,
      actions: i.system?.actions?.value ?? null,
      category: i.system?.category,
      grantedById: i.flags?.pf2e?.grantedBy?.id ?? null
    }));
    const byId = new Map(items.map((i) => [i.id, i]));
    const resolve = /* @__PURE__ */ __name((id) => byId.get(id), "resolve");
    return pickClassItems(items, classSlug, resolve).map((i) => {
      const cost = i.actionType === "reaction" ? "reaction" : i.actionType === "free" ? "free" : costToSectorCost(i.actions ?? null);
      return {
        id: `class:${i.id}`,
        label: i.name,
        // 自己是通用消耗图标时，沿 grantedBy 链去上一环取专属图标（见 iconFromChain）
        img: iconFromChain(i, resolve),
        cost,
        // ★ 反应在扇区上直接标出来（Nous 2026-08-05 定"用记号区分"）：
        //   它与主动动作混在同一圈里，不标的话玩家会以为它花掉一个动作。
        badge: cost === "reaction" ? "\u27F3" : void 0,
        state: "normal"
      };
    });
  } catch (err) {
    console.error("player-action-ui-hub | collectClassAbilities \u5931\u8D25", err);
    return [];
  }
}
__name(collectClassAbilities, "collectClassAbilities");

// src/collectors/spells.ts
function usableEntries(entries) {
  return entries.filter((e) => (e.spellCount ?? 0) > 0);
}
__name(usableEntries, "usableEntries");
function focusBadge(pool) {
  if (!pool || pool.max <= 0) return void 0;
  return `\u2726 ${pool.value}/${pool.max}`;
}
__name(focusBadge, "focusBadge");
function slotBadge(slot) {
  if (!slot || slot.max <= 0) return void 0;
  return `\u25C8 ${slot.value}/${slot.max}`;
}
__name(slotBadge, "slotBadge");
function spellCost(spell) {
  switch (spell.actionGlyph) {
    case "1":
      return "1";
    case "2":
      return "2";
    case "3":
      return "3";
    case "R":
      return "reaction";
    case "F":
      return "free";
    default:
      return null;
  }
}
__name(spellCost, "spellCost");
function collectSpellEntries(actor) {
  try {
    const contents = actor?.spellcasting?.contents ?? [];
    const entries = contents.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category ?? e.system?.prepared?.value,
      isFocusPool: e.isFocusPool,
      spellCount: e.spells?.size ?? 0
    }));
    const pool = actor?.system?.resources?.focus ?? null;
    return usableEntries(entries).map((e) => ({
      id: `spellentry:${e.id}`,
      label: e.name,
      // 条目自带的是 pf2e 的默认占位图（三个条目长一样），换成按类别区分的
      img: SPELL_ENTRY_ICONS[e.category ?? ""] ?? SPELL_ENTRY_DEFAULT,
      cost: null,
      state: "normal",
      badge: e.isFocusPool ? focusBadge(pool) : void 0
    }));
  } catch (err) {
    console.error("player-action-ui-hub | collectSpellEntries \u5931\u8D25", err);
    return [];
  }
}
__name(collectSpellEntries, "collectSpellEntries");
function collectSpells(actor, entryId) {
  try {
    const entry = actor?.spellcasting?.get?.(entryId);
    if (!entry) return [];
    const slots = entry.system?.slots ?? {};
    return [...entry.spells ?? []].map((s) => {
      const slot = s.isCantrip || s.isFocusSpell ? null : slots[`slot${s.rank}`] ?? null;
      return {
        id: `spell:${entryId}:${s.id}`,
        label: s.name,
        img: s.img,
        cost: spellCost(s),
        state: "normal",
        badge: slotBadge(slot)
      };
    });
  } catch (err) {
    console.error("player-action-ui-hub | collectSpells \u5931\u8D25", err);
    return [];
  }
}
__name(collectSpells, "collectSpells");

// src/main.ts
init_executor();

// src/class-state.ts
var MAX_STATE_LINES = 3;
var COMMON_RESOURCES = [
  { path: "focus", key: "focus", label: "Focus" },
  { path: "heroPoints", key: "hero", label: "Hero Points" },
  { path: "mythicPoints", key: "mythic", label: "Mythic" }
];
var CLASS_RESOURCES = {
  // 实测路径：`actor.system.resources.crafting.infusedReagents`
  alchemist: [{ path: "crafting.infusedReagents", key: "reagents", label: "Reagents" }]
};
function \u8BFB\u8D44\u6E90(a, path) {
  const v = path.split(".").reduce((o, k) => o?.[k], a?.system?.resources);
  if (!v || typeof v.max !== "number" || v.max <= 0) return null;
  return { value: Number(v.value ?? 0), max: Number(v.max) };
}
__name(\u8BFB\u8D44\u6E90, "\u8BFB\u8D44\u6E90");
function collectToggles(actor) {
  const a = actor;
  const \u5F52\u7EC4 = /* @__PURE__ */ new Map();
  for (const opts of Object.values(a?.synthetics?.toggles ?? {})) {
    for (const opt of Object.values(opts)) {
      const option = String(opt?.option ?? "");
      if (!option || \u5F52\u7EC4.has(option)) continue;
      const label = String(opt?.label ?? option);
      const \u9009\u4E2D = opt?.selection != null ? (opt.suboptions ?? []).find((s) => s?.value === opt.selection) : null;
      const value = \u9009\u4E2D ? String(\u9009\u4E2D.label ?? \u9009\u4E2D.value) : opt?.enabled ? "on" : "off";
      \u5F52\u7EC4.set(option, { key: `toggle:${option}`, label, value });
    }
  }
  return [...\u5F52\u7EC4.values()];
}
__name(collectToggles, "collectToggles");
function collectEffects(actor) {
  const a = actor;
  const out = [];
  for (const e of a?.itemTypes?.effect ?? []) {
    const badge = e?.system?.badge;
    const \u8BA1\u6570 = badge && typeof badge.value === "number" ? String(badge.value) : null;
    const label = String(e?.name ?? "").replace(/^\s*Effect:\s*/i, "");
    out.push({ key: `effect:${e?.slug ?? label}`, label, value: \u8BA1\u6570 ?? "active" });
  }
  return out;
}
__name(collectEffects, "collectEffects");
function readClassState(actor) {
  try {
    const a = actor;
    const classSlug = a?.class?.slug ?? null;
    const \u8868 = [...COMMON_RESOURCES, ...classSlug ? CLASS_RESOURCES[classSlug] ?? [] : []];
    const resources = [];
    for (const r of \u8868) {
      const v = \u8BFB\u8D44\u6E90(a, r.path);
      if (v) resources.push({ key: r.key, label: r.label, value: `${v.value}/${v.max}` });
    }
    return { resources, toggles: collectToggles(actor), effects: collectEffects(actor) };
  } catch (err) {
    console.error("player-action-ui-hub | readClassState \u5931\u8D25", err);
    return { resources: [], toggles: [], effects: [] };
  }
}
__name(readClassState, "readClassState");
function classStateLines(input) {
  const \u6709\u9009\u62E9 = input.toggles.filter((t) => t.value !== "on" && t.value !== "off");
  const \u7EAF\u5F00\u5173 = input.toggles.filter((t) => t.value === "on" || t.value === "off");
  const \u6392\u597D = [...input.resources, ...\u6709\u9009\u62E9, ...input.effects, ...\u7EAF\u5F00\u5173];
  return \u6392\u597D.slice(0, MAX_STATE_LINES).map((l) => `${l.label} \u2726 ${l.value}`);
}
__name(classStateLines, "classStateLines");

// src/main.ts
init_aura_effects();
init_area_effects();

// src/macros.ts
init_strikes();
function unarmedStrikes(actor) {
  return strikesOf(actor).map((s, i) => ({ strike: s, id: strikeSectorId(s, i) })).filter((x) => x.strike?.item?.category === "unarmed");
}
__name(unarmedStrikes, "unarmedStrikes");
function \u5F92\u624B\u6247\u533A(actor) {
  return unarmedStrikes(actor).map(({ strike, id }) => ({
    id,
    label: strike.label ?? strike.item?.name ?? "Unarmed",
    img: strike.item?.img,
    cost: null,
    state: strike.ready === false ? "gated" : "normal",
    reason: strike.ready === false ? "Not available right now." : void 0,
    variantLabels: (strike.variants ?? []).map((v) => v.label)
  }));
}
__name(\u5F92\u624B\u6247\u533A, "\u5F92\u624B\u6247\u533A");
function variantIndexFor(start, nth, variantCount) {
  return Math.min(Math.max(start, 0) + nth, Math.max(variantCount - 1, 0));
}
__name(variantIndexFor, "variantIndexFor");
var FLURRY_OF_BLOWS = {
  slug: "flurry-of-blows",
  name: "Flurry of Blows",
  steps: [
    {
      title: /* @__PURE__ */ __name(() => "Flurry \xB7 1st Strike", "title"),
      options: /* @__PURE__ */ __name((actor) => \u5F92\u624B\u6247\u533A(actor), "options"),
      // 翻选条在**第一步**：选的是这次连击的起始 MAP，不是单独某一击的
      variantLabels: /* @__PURE__ */ __name((actor) => unarmedStrikes(actor)[0]?.strike?.variants?.map((v) => v.label), "variantLabels")
    },
    {
      title: /* @__PURE__ */ __name(() => "Flurry \xB7 2nd Strike", "title"),
      // ⚠ 第二步照样列**全部**徒手打击 —— 规则是"两次徒手打击"，
      //   没说必须不同。同一只拳头打两下是合法的，不要替玩家排除。
      options: /* @__PURE__ */ __name((actor) => \u5F92\u624B\u6247\u533A(actor), "options")
    }
  ],
  async run(actor, ctx, ev) {
    const \u5168\u90E8 = unarmedStrikes(actor);
    const \u53D6 = /* @__PURE__ */ __name((id) => \u5168\u90E8.find((x) => x.id === id)?.strike, "\u53D6");
    const a = \u53D6(ctx.picks[0]);
    const b = \u53D6(ctx.picks[1]);
    if (!a || !b) {
      ui.notifications.warn("Those strikes are no longer available \u2014 reopen the wheel.");
      return;
    }
    const { rollStrike: rollStrike2 } = await Promise.resolve().then(() => (init_executor(), executor_exports));
    await rollStrike2(actor, ctx.picks[0], variantIndexFor(ctx.variantIndex, 0, a.variants?.length ?? 3), ev);
    await rollStrike2(actor, ctx.picks[1], variantIndexFor(ctx.variantIndex, 1, b.variants?.length ?? 3), ev);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>Flurry of Blows</strong></p><p>If both Strikes hit the same creature, combine their damage <em>before</em> applying resistances and weaknesses.</p>`
    });
  }
};
var MACROS = [FLURRY_OF_BLOWS];
function macroFor(slug) {
  if (!slug) return null;
  return MACROS.find((m) => m.slug === slug) ?? null;
}
__name(macroFor, "macroFor");
function levelForStep(actor, macro, stepIndex, ctx) {
  const step = macro.steps[stepIndex];
  if (!step) return null;
  const sectors = step.options(actor, ctx);
  if (!sectors.length) return null;
  const labels = step.variantLabels?.(actor, ctx);
  return {
    title: step.title(actor, ctx),
    canGoBack: true,
    sectors,
    variant: labels && labels.length > 1 ? { index: ctx.variantIndex, labels } : void 0
  };
}
__name(levelForStep, "levelForStep");

// src/main.ts
var MODULE_ID2 = "player-action-ui-hub";
var lastMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
document.addEventListener("mousemove", (ev) => {
  lastMouse = { x: ev.clientX, y: ev.clientY };
});
function currentRound(actor) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const inIt = combat.combatants?.some((c) => c.actor?.id === actor?.id);
  return inIt ? combat.round ?? null : null;
}
__name(currentRound, "currentRound");
var openWheel = null;
var \u6D3B\u8DC3\u7F16\u6392 = null;
function \u63A8\u8FDB\u7F16\u6392(actor, s, ev) {
  const \u72B6\u6001 = \u6D3B\u8DC3\u7F16\u6392;
  if (!\u72B6\u6001) return;
  if (s.id === "__back") {
    \u72B6\u6001.ctx.picks.pop();
    \u72B6\u6001.step -= 1;
    if (\u72B6\u6001.step < 0) {
      \u6D3B\u8DC3\u7F16\u6392 = null;
      const sectors = collectClassAbilities(actor);
      void openWheel.setLevel({
        title: className(actor) ?? "Class",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    const \u56DE = levelForStep(actor, \u72B6\u6001.macro, \u72B6\u6001.step, \u72B6\u6001.ctx);
    if (\u56DE) void openWheel.setLevel(\u56DE);
    return;
  }
  \u72B6\u6001.ctx.variantIndex = openWheel.currentVariantIndex();
  \u72B6\u6001.ctx.picks.push(s.id);
  \u72B6\u6001.step += 1;
  const \u4E0B\u4E00\u5C42 = levelForStep(actor, \u72B6\u6001.macro, \u72B6\u6001.step, \u72B6\u6001.ctx);
  if (\u4E0B\u4E00\u5C42) {
    void openWheel.setLevel(\u4E0B\u4E00\u5C42);
    return;
  }
  const \u8DD1 = \u72B6\u6001.macro.run(actor, \u72B6\u6001.ctx, ev);
  \u6D3B\u8DC3\u7F16\u6392 = null;
  void \u8DD1.then(() => openWheel?.close());
}
__name(\u63A8\u8FDB\u7F16\u6392, "\u63A8\u8FDB\u7F16\u6392");
var openWheelActor = null;
function buildStrikeLevel(actor) {
  const strikes = collectStrikes(actor);
  if (!strikes.length) return null;
  const labels = strikes[0]?.variantLabels ?? [];
  return {
    title: "Strikes",
    canGoBack: true,
    variant: labels.length ? { index: 0, labels } : void 0,
    sectors: strikes
  };
}
__name(buildStrikeLevel, "buildStrikeLevel");
function openAt(x, y) {
  const actor = resolveActor();
  if (!actor) {
    ui.notifications.warn("Player Action UI Hub: no character to act with \u2014 select your token first.");
    return;
  }
  openWheel?.close();
  openWheelActor = actor;
  const counts = {
    strikes: collectStrikes(actor).length,
    actions: collectActions(actor).length,
    skills: collectSkills(actor).length,
    class: collectClassAbilities(actor).length,
    spells: collectSpellEntries(actor).length
  };
  const cat = /* @__PURE__ */ __name((id, label) => ({
    id,
    label,
    // 分类层用单色 SVG，与内容层的彩色贴图区分开 —— 一眼看出这是导航层
    img: CATEGORY_ICONS[id],
    // ★ 计数移到 detail：印在扇区上会挤（`Actions (25)` 比图标宽得多），
    //   而它是"想知道才看"的参考数，悬停时在毂里给就够了。
    detail: `${counts[id]} available`,
    cost: null,
    state: counts[id] > 0 ? "normal" : "gated",
    reason: counts[id] > 0 ? void 0 : "Nothing available in this category right now."
  }), "cat");
  const level = {
    title: actor.name,
    canGoBack: false,
    sectors: [
      cat("strikes", "Strikes"),
      cat("actions", "Actions"),
      cat("skills", "Skills"),
      cat("class", "Class"),
      cat("spells", "Spells")
    ]
  };
  \u6D3B\u8DC3\u7F16\u6392 = null;
  openWheel = new WheelApp(level, (s, ev) => {
    if (\u6D3B\u8DC3\u7F16\u6392) {
      \u63A8\u8FDB\u7F16\u6392(actor, s, ev);
      return;
    }
    if (s.id === "strikes") {
      const strikeLevel = buildStrikeLevel(actor);
      if (!strikeLevel) {
        ui.notifications.info("This character has no strikes available.");
        return;
      }
      openWheel.rebuild = () => buildStrikeLevel(actor);
      void openWheel.setLevel(strikeLevel);
      return;
    }
    if (s.id === "actions") {
      const sectors = collectActions(actor);
      if (!sectors.length) {
        ui.notifications.info("No general actions are available.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({
        title: "Actions",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id === "class") {
      const sectors = collectClassAbilities(actor);
      if (!sectors.length) {
        ui.notifications.info("This character has no class abilities to use.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({
        title: className(actor) ?? "Class",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id === "skills") {
      const sectors = collectSkills(actor);
      if (!sectors.length) {
        ui.notifications.info("This character has no skills.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({
        title: "Skills",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id.startsWith("skill:")) {
      const slug = s.id.slice("skill:".length);
      const sectors = collectSkillActions(actor, slug);
      if (!sectors.length) {
        ui.notifications.info("Nothing available for that skill.");
        return;
      }
      void openWheel.setLevel({
        title: s.label,
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id.startsWith("skillcheck:")) {
      const slug = s.id.slice("skillcheck:".length);
      void rollSkill(actor, slug, ev).then(() => openWheel?.close());
      return;
    }
    if (s.id === "spells") {
      const sectors = collectSpellEntries(actor);
      if (!sectors.length) {
        ui.notifications.info("This character has no spells to cast.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({ title: "Spells", canGoBack: true, sectors });
      return;
    }
    if (s.id.startsWith("spellentry:")) {
      const entryId = s.id.slice("spellentry:".length);
      const sectors = collectSpells(actor, entryId);
      if (!sectors.length) {
        ui.notifications.info("That spellcasting entry has no spells.");
        return;
      }
      void openWheel.setLevel({
        title: s.label,
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id === "__back") {
      openWheel.rebuild = void 0;
      void openWheel.setLevel(level);
      return;
    }
    if (s.id.startsWith("strike:")) {
      if (s.state === "gated") {
        void execAuxiliary(actor, s.id, 0);
      } else {
        const map = openWheel.currentVariantIndex();
        const round = currentRound(actor);
        if (round !== null) spend(actor.id, round, costToPoints(s.cost));
        void rollStrike(actor, s.id, map, ev).then(() => openWheel?.close());
      }
      return;
    }
    if (s.id.startsWith("action:")) {
      const slug = s.id.slice("action:".length);
      bump(slug);
      const round = currentRound(actor);
      if (round !== null) spend(actor.id, round, costToPoints(s.cost));
      void useAction(actor, slug, ev).then(() => openWheel?.close());
      return;
    }
    if (s.id.startsWith("class:")) {
      const itemId = s.id.slice("class:".length);
      const item = actor.items.get(itemId);
      if (!item) {
        ui.notifications.warn("That ability is no longer available \u2014 reopen the wheel.");
        return;
      }
      const round = currentRound(actor);
      if (round !== null) {
        if (s.cost === "reaction") spendReaction(actor.id, round);
        else spend(actor.id, round, costToPoints(s.cost));
      }
      const macro = macroFor(item.slug);
      if (macro) {
        const \u8D77\u6B65 = levelForStep(actor, macro, 0, { picks: [], variantIndex: 0 });
        if (!\u8D77\u6B65) {
          ui.notifications.info("Nothing available to use with that ability right now.");
          return;
        }
        \u6D3B\u8DC3\u7F16\u6392 = { macro, step: 0, ctx: { picks: [], variantIndex: 0 } };
        openWheel.rebuild = void 0;
        void openWheel.setLevel(\u8D77\u6B65);
        return;
      }
      void game.pf2e.rollItemMacro(item.uuid).then(() => openWheel?.close());
      return;
    }
    if (s.id.startsWith("spell:")) {
      const [, entryId, spellId] = s.id.split(":");
      const round = currentRound(actor);
      if (round !== null) {
        if (s.cost === "reaction") spendReaction(actor.id, round);
        else spend(actor.id, round, costToPoints(s.cost));
      }
      void castSpell(actor, entryId, spellId).then(() => openWheel?.close());
      return;
    }
    ui.notifications.info(`"${s.label}" is not implemented yet.`);
  });
  openWheel.economy = () => {
    const round = currentRound(actor);
    if (round === null) return null;
    return {
      remaining: remaining(actor.id, round),
      canUndo: canUndo(actor.id, round),
      reactionsLeft: reactionsLeft(actor.id, round)
    };
  };
  openWheel.classState = () => classStateLines(readClassState(actor));
  openWheel.onUndo = () => {
    const round = currentRound(actor);
    if (round !== null) undoLast(actor.id, round);
  };
  void openWheel.openAt(x, y);
}
__name(openAt, "openAt");
Hooks.once("init", () => {
  console.log(`${MODULE_ID2} | init`);
  registerUsageSetting();
  game.keybindings.register(MODULE_ID2, "openWheel", {
    name: "Summon Action Wheel",
    hint: "Opens the wheel at the cursor. Equivalent to Ctrl+left-click; rebind this if Ctrl+click is awkward on your setup.",
    // modifiers 显式给空数组：省略它在运行时等价
    // （client/helpers/interaction/client-keybindings.mjs:261
    //   `binding.modifiers = this.#validateModifiers(binding.modifiers ?? [])`），
    // 但类型包把它标成必填，写全比开豁免干净。
    editable: [{ key: "KeyR", modifiers: [] }],
    onDown: /* @__PURE__ */ __name(() => {
      openAt(lastMouse.x, lastMouse.y);
      return true;
    }, "onDown"),
    precedence: 0
  });
});
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID2);
  console.log(
    `%c${MODULE_ID2} | ready | v${mod?.version ?? "?"}`,
    "color:#c9a959;font-weight:bold"
  );
  const demoLevel = {
    title: "Strikes",
    canGoBack: false,
    sectors: [
      { id: "a", label: "Longsword", cost: "1", state: "normal" },
      { id: "b", label: "Shortbow", cost: "1", state: "normal" },
      // risky：亮度不变，只有琥珀描边与角标
      {
        id: "c",
        label: "Magic Missile",
        cost: "2",
        state: "risky",
        reason: "Stupefied 2: casting requires a DC 7 flat check or the spell is disrupted.",
        badge: "\u26A0 Flat DC 7"
      },
      // gated：变暗
      {
        id: "d",
        label: "Dagger",
        cost: "1",
        state: "gated",
        reason: "Not drawn \u2014 spend \u25C6 to draw it first.",
        badge: "\u25C6 Draw"
      }
    ]
  };
  globalThis.pauih = {
    /** 调试入口：不传坐标就用鼠标当前所在位置 */
    demo: /* @__PURE__ */ __name((x, y) => {
      const w = new WheelApp(demoLevel, (s) => console.log("picked:", s.label));
      void w.openAt(x ?? lastMouse.x, y ?? lastMouse.y);
      return w;
    }, "demo"),
    /**
     * 给游戏内冒烟测试用的纯函数出口。
     *
     * ⚠ 暴露的是**真实执行路径上的那几个**，不是给测试另写一份 ——
     *   另写一份就是又造一个会腐坏的副本，测的还是副本不是产品。
     */
    _test: {
      auraPlanFor,
      buildAuraEffect,
      savePlanFor,
      sceneHasGrid,
      resolveAreaAfterCast,
      macroFor,
      levelForStep,
      unarmedStrikes,
      readClassState,
      classStateLines
    }
  };
  function isWheelSummon(ev) {
    return ev.button === 0 && ev.ctrlKey && ev.target?.tagName === "CANVAS";
  }
  __name(isWheelSummon, "isWheelSummon");
  for (const type of ["pointerdown", "mousedown", "pointerup", "click"]) {
    document.addEventListener(type, (ev) => {
      const me = ev;
      if (!isWheelSummon(me)) return;
      me.preventDefault();
      me.stopImmediatePropagation();
      if (type === "pointerdown") openAt(me.clientX, me.clientY);
    }, { capture: true });
  }
  const REFRESH_HOOKS = ["updateActor", "updateItem", "createItem", "deleteItem"];
  for (const h of REFRESH_HOOKS) {
    Hooks.on(h, (doc) => {
      if (!openWheel?.rendered || !openWheelActor) return;
      const changed = doc?.documentName === "Actor" ? doc : doc?.actor ?? doc?.parent;
      if (!changed?.id || changed.id !== openWheelActor.id) return;
      void openWheel.refresh();
    });
  }
});
//# sourceMappingURL=main.js.map
