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

// src/strike-damage.ts
async function primeStrikeDamage(actor) {
  const a = actor;
  const actorId = a?.id;
  if (!actorId) return;
  const strikes = (a?.system?.actions ?? []).filter((x) => x?.type === "strike");
  await Promise.all(strikes.map(async (s, i) => {
    const k = \u952E(actorId, strikeSectorId(s, i));
    try {
      const f = await s.damage?.({ getFormula: true });
      if (typeof f === "string" && f.trim()) \u7F13\u5B58.set(k, f.trim());
      else \u7F13\u5B58.delete(k);
    } catch {
      \u7F13\u5B58.delete(k);
    }
  }));
}
function strikeDamageOf(actor, strikeKey) {
  const actorId = actor?.id;
  return actorId ? \u7F13\u5B58.get(\u952E(actorId, strikeKey)) : void 0;
}
function clearStrikeDamage() {
  \u7F13\u5B58.clear();
}
var \u7F13\u5B58, \u952E;
var init_strike_damage = __esm({
  "src/strike-damage.ts"() {
    "use strict";
    init_strikes();
    \u7F13\u5B58 = /* @__PURE__ */ new Map();
    \u952E = /* @__PURE__ */ __name((actorId, key) => `${actorId}::${key}`, "\u952E");
    __name(primeStrikeDamage, "primeStrikeDamage");
    __name(strikeDamageOf, "strikeDamageOf");
    __name(clearStrikeDamage, "clearStrikeDamage");
  }
});

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
function ammoSectorId(strikeKey, ammoId) {
  return `ammo:${strikeKey}:${ammoId}`;
}
function parseAmmoSectorId(id) {
  if (!id.startsWith("ammo:")) return null;
  const rest = id.slice("ammo:".length).split(":");
  if (rest.length < 2) return null;
  const ammoId = rest.pop() ?? "";
  const strikeKey = rest.join(":");
  return strikeKey && ammoId ? { strikeKey, ammoId } : null;
}
function collectStrikeAuxiliaries(actor) {
  try {
    const out = [];
    strikesOf(actor).forEach((strike, i) => {
      const strikeId = strikeSectorId(strike, i);
      const \u6B66\u5668\u540D = String(strike.label ?? strike.slug ?? "?");
      (strike.auxiliaryActions ?? []).forEach((aux, ai) => {
        if (String(aux?.label ?? "").trim() === "Drop") return;
        out.push({
          id: `aux:${strikeId}:${ai}`,
          // 带上武器名：多把武器时光写 "Sheathe" 分不清是哪把
          label: `${\u6B66\u5668\u540D} \xB7 ${String(aux?.label ?? "?")}`,
          /*
           * ★ 图标要留（Nous 2026-08-08："那些特别类型的 strike 的 icon 全部都丢失了"）。
           *   我上一版为了让蓝字显出来把图标去了 —— **那是把两件事绑在了一起**：
           *   环上认的是图标，"这不是攻击"由**毂里的名字变蓝**来说。
           *   去掉图标换一个颜色，等于用一个更重要的东西换一个次要的。
           */
          img: strike.item?.img ?? void 0,
          infoUuid: strike.item?.uuid,
          cost: costOf(aux?.actions),
          state: "normal",
          /*
           * ★ 亮蓝 = **点了不掷骰**（Nous 2026-08-08）：
           *   打击层里混着"打出去"和"摆弄武器"两类，
           *   不给区分就只能靠读名字 —— 而这里正是每回合要快的地方。
           */
          tone: "aux"
        });
      });
      const ammo = strike?.ammunition;
      if (ammo?.requiresReload) {
        const \u6709\u5F39\u836F = (ammo.compatible?.length ?? 0) > 0 || ammo.selected != null;
        const \u6D88\u8017 = Number(ammo.reloadGlyph);
        const \u88C5\u7740 = strike?.item?.ammo ?? null;
        const \u5F39\u6570 = \u88C5\u7740 ? Number(Number(\u88C5\u7740.system?.uses?.max) > 1 ? \u88C5\u7740.system?.uses?.value : \u88C5\u7740.system?.quantity) || 0 : 0;
        out.push({
          id: `reload:${strikeId}`,
          label: `${\u6B66\u5668\u540D} \xB7 Reload`,
          img: strike.item?.img ?? void 0,
          infoUuid: strike.item?.uuid,
          cost: costOf(Number.isFinite(\u6D88\u8017) ? \u6D88\u8017 : 1),
          // ⛔ 这一格也有图标 —— 图标下面同样不写字（Nous 2026-08-08）
          badge: void 0,
          // ★ 全部进毂：装的是什么、还剩几发
          hubNotes: [\u88C5\u7740 ? `\u25C8 ${String(\u88C5\u7740.name ?? "?")} \xD7${\u5F39\u6570}` : "\u2300 Not loaded"],
          // 装填也不掷骰，与拔刀收鞘同一类
          tone: "aux",
          // ★ 没弹药就灰 + ⛔ + 说明为什么 —— 这一条**不是我们判的规则**，
          //   是角色卡自己就这么显示的
          state: \u6709\u5F39\u836F ? "normal" : "gated",
          reason: \u6709\u5F39\u836F ? "Reloading is an Interact action in PF2e." : "No compatible ammunition in your inventory."
        });
      }
    });
    return out;
  } catch (err) {
    console.error("player-action-ui-hub | collectStrikeAuxiliaries \u5931\u8D25", err);
    return [];
  }
}
function costOf(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v === 0 ? "free" : String(v);
}
function collectStrikes(actor) {
  try {
    return strikesOf(actor).filter((s) => s.ready !== false).map((strike, i) => {
      const am = strike?.ammunition;
      const \u8981\u88C5\u586B = !!am?.requiresReload;
      const \u7A7A\u67AA = \u8981\u88C5\u586B && !strike?.item?.ammo;
      const \u88C5\u7740 = strike?.item?.ammo ?? null;
      const \u5F39\u6570 = \u88C5\u7740 ? Number(Number(\u88C5\u7740.system?.uses?.max) > 1 ? \u88C5\u7740.system?.uses?.value : \u88C5\u7740.system?.quantity) || 0 : 0;
      const \u653B\u51FB\u51CF\u503C = (strike.modifiers ?? []).filter((m) => m?.enabled && !m?.ignored && Number(m?.modifier) < 0).reduce((n, m) => n + Number(m.modifier), 0);
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
        /*
         * ★ 伤害串（Nous 2026-08-08："攻击那里没有说明 ok，但是没有写伤害数值说明"）。
         *   取的是系统算好的成品 `1d6 + 1 piercing` —— 力量、符文、增伤都在里面。
         *   ⚠ 取不到就不显示，**不退回武器基础伤害**：那个不含任何加值，
         *     会稳定地少报一截，而且格式对、类型对，看不出是错的。
         */
        /*
         * ★★ **要用的数印在扇区上**（Nous 2026-08-08 定的一致性规矩）：
         *   毂里的说明区拿掉之后，"这一格的关键数字"必须在格子上，
         *   否则要点开才知道 —— 而攻击加值是每次都要看的那个数。
         * ⚠ 取**第一击**的 label（pf2e 给的 `+14`），不自己算：
         *   加值由力量/熟练/符文/增益共同决定，自己拼一定会漏。
         */
        /*
         * ⛔ **图标下面一个字都不写**（Nous 2026-08-08："icon 下面应该什么都不说，
         *   信息都应该在圆盘里面"）。加值原来印在这里，现在毂里的 MAP 那一行
         *   本来就写着 `◆ +14`（第 1 击），**一个数不丢**。
         * ★ 这一条是对 12.6 的**修正**：一致性不该靠"每格都给"去凑 ——
         *   扇区一格宽 46 单位，越给越不齐；毂容得下，所以在毂里给全。
         */
        badge: void 0,
        // 伤害仍然带着 —— 它进聊天卡
        detail: strikeDamageOf(actor, strikeSectorId(strike, i)),
        // ★ 点标题 → 把这把武器的说明发到聊天栏（武器本身就是文档）
        infoUuid: strike.item?.uuid,
        state: \u7A7A\u67AA ? "gated" : "normal",
        // ⚠ 这一层不画 reason（说明区已拿掉），但仍要写对：它是这一格状态的出处
        reason: \u7A7A\u67AA ? "Not loaded." : void 0,
        /*
         * ★ 毂里逐行给这一格的数值。顺序按**做决定用得着的先后**：
         *   伤害是每次都要看的，弹药只在需要装填的武器上才有。
         * ⚠ 伤害串取系统算好的成品（力量/符文/增伤都在里面），取不到就整行不画 ——
         *   不退回武器基础伤害：那个稳定地少报一截，而且格式对、类型对，看不出是错的。
         */
        hubNotes: [
          strikeDamageOf(actor, strikeSectorId(strike, i)),
          \u8981\u88C5\u586B ? \u88C5\u7740 ? `\u25C8 ${String(\u88C5\u7740.name ?? "?")} \xD7${\u5F39\u6570}` : "\u2300 Not loaded" : "",
          // ⚠ 用真减号 U+2212，不是连字符 —— 一串数字里 `-` 太容易看成分隔符
          \u653B\u51FB\u51CF\u503C < 0 ? `\u26A0 \u2212${Math.abs(\u653B\u51FB\u51CF\u503C)} to hit` : ""
        ].filter(Boolean)
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
    init_strike_damage();
    __name(isStrike, "isStrike");
    __name(strikesOf, "strikesOf");
    __name(strikeSectorId, "strikeSectorId");
    __name(ammoSectorId, "ammoSectorId");
    __name(parseAmmoSectorId, "parseAmmoSectorId");
    __name(collectStrikeAuxiliaries, "collectStrikeAuxiliaries");
    __name(costOf, "costOf");
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
  applyEffectTo: () => applyEffectTo,
  castSpell: () => castSpell,
  execAuxiliary: () => execAuxiliary,
  rollSkill: () => rollSkill,
  rollSpellAttack: () => rollSpellAttack,
  rollSpellDamage: () => rollSpellDamage,
  rollSpellSave: () => rollSpellSave,
  rollStrike: () => rollStrike,
  rollStrikeDamage: () => rollStrikeDamage,
  sendReloadMessage: () => sendReloadMessage,
  spellHasDamage: () => spellHasDamage,
  useAction: () => useAction
});
function findStrike(actor, strikeId) {
  return strikesOf(actor).find((s, i) => strikeSectorId(s, i) === strikeId) ?? null;
}
function intentEvent(realEvent, kind = "check") {
  const skipDefault = !game.user?.settings?.[kind === "check" ? "showCheckDialogs" : "showDamageDialogs"];
  const userWantsDialog = !!realEvent?.shiftKey;
  const shiftKey = userWantsDialog ? skipDefault : !skipDefault;
  return new PointerEvent("click", { shiftKey, ctrlKey: false, metaKey: false });
}
async function rollStrike(actor, strikeId, map, event) {
  try {
    const strike = findStrike(actor, strikeId);
    if (!strike) {
      ui.notifications.warn("That strike is no longer available \u2014 reopen the wheel.");
      return null;
    }
    const variant = strike.variants?.[map];
    if (!variant) {
      ui.notifications.warn("That strike has no such attack in the sequence.");
      return null;
    }
    const rolled = await variant.roll({ event: intentEvent(event) });
    return rolled && typeof rolled === "object" ? rolled : null;
  } catch (err) {
    console.error("player-action-ui-hub | rollStrike \u5931\u8D25", err);
    ui.notifications.error("The roll failed \u2014 see the console for details.");
    return null;
  }
}
async function rollStrikeDamage(actor, strikeId, map, event, critical) {
  try {
    const strike = findStrike(actor, strikeId);
    if (!strike) return false;
    const \u6253 = strike;
    const fn = critical ? \u6253.critical ?? \u6253.damage : \u6253.damage;
    if (typeof fn !== "function") return false;
    await fn.call(\u6253, { event: intentEvent(event, "damage"), mapIncreases: map });
    return true;
  } catch (err) {
    console.error("player-action-ui-hub | rollStrikeDamage \u5931\u8D25", err);
    return false;
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
async function castSpell(actor, entryId, spellId, rank, slotIndex) {
  try {
    const entry = actor?.spellcasting?.get?.(entryId);
    const spell = entry?.spells?.get?.(spellId);
    if (!entry || !spell) {
      ui.notifications.warn("That spell is no longer available \u2014 reopen the wheel.");
      return;
    }
    await entry.cast(spell, {
      rank: rank ?? spell.rank,
      // ⚠ 只有真给了才传：传 undefined 与不传对 pf2e 是一回事，但传 null 不是
      ...slotIndex === void 0 ? {} : { slotId: slotIndex }
    });
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
async function sendReloadMessage(actor, weapon, ammo) {
  try {
    const w = weapon, am = ammo;
    const ac = w?.actor ?? actor;
    if (!ac || !w || !am) return false;
    const n = w.system?.traits?.value?.includes?.("repeating") ? 3 : Number(w.reload);
    const glyph = n > 0 && Number.isInteger(n) ? String(n) : null;
    const cfg = CONFIG.PF2E ?? {};
    const render = foundry.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    if (typeof render !== "function") return false;
    const flavor = await render("systems/pf2e/templates/chat/action/flavor.hbs", {
      action: {
        title: "PF2E.Actions.Interact.Title",
        subtitle: "PF2E.Actions.Interact.Reload.Title",
        glyph
      },
      // ⚠ 照 traitSlugToObject 的返回形状；label 要能被模板的 {{localize}} 吃下去
      traits: [{
        name: "manipulate",
        label: cfg.actionTraits?.manipulate ?? "manipulate",
        description: cfg.traitsDescriptions?.manipulate ?? null
      }]
    });
    const content = await render("systems/pf2e/templates/chat/action/content.hbs", {
      imgPath: w.img,
      message: game.i18n.format("PF2E.Actions.Interact.Reload.Description", {
        actor: ac.name,
        weapon: w.name,
        ammo: am.name
      })
    });
    const token = ac.getActiveTokens?.(false, true)?.shift?.() ?? null;
    await ChatMessage.create({
      content,
      flavor,
      speaker: ChatMessage.getSpeaker({ actor: ac, token }),
      style: CONST.CHAT_MESSAGE_STYLES.EMOTE
    });
    return true;
  } catch (err) {
    console.error("player-action-ui-hub | \u88C5\u586B\u56DE\u6267\u5931\u8D25", err);
    return false;
  }
}
async function rollSpellSave(target, spell, caster) {
  try {
    const sp = spell;
    const stat = String(sp?.system?.defense?.save?.statistic ?? "");
    if (!stat) return null;
    const save = target?.saves?.[stat];
    if (!save?.roll) return null;
    const dc = Number(sp?.spellcasting?.statistic?.dc?.value);
    const r = await save.roll({
      dc: Number.isFinite(dc) ? { value: dc, label: `${String(sp?.name ?? "Spell")} DC` } : void 0,
      item: sp,
      origin: caster,
      extraRollOptions: ["magical", "spell"],
      skipDialog: true
    });
    return r && typeof r === "object" ? r : null;
  } catch (err) {
    console.error("player-action-ui-hub | rollSpellSave \u5931\u8D25", target?.name, err);
    return null;
  }
}
async function rollSpellAttack(spell, event) {
  try {
    const sp = spell;
    if (typeof sp?.rollAttack !== "function") return false;
    await sp.rollAttack(intentEvent(event, "check"));
    return true;
  } catch (err) {
    console.error("player-action-ui-hub | rollSpellAttack \u5931\u8D25", err);
    return false;
  }
}
async function rollSpellDamage(spell, event) {
  try {
    const sp = spell;
    if (typeof sp?.rollDamage !== "function") return false;
    await sp.rollDamage(intentEvent(event, "damage"));
    return true;
  } catch (err) {
    console.error("player-action-ui-hub | rollSpellDamage \u5931\u8D25", err);
    return false;
  }
}
async function spellHasDamage(spell) {
  try {
    const d = await spell?.getDamage?.();
    return !!d;
  } catch {
    return false;
  }
}
async function applyEffectTo(targets, effectUuid, origin) {
  const total = targets.length;
  if (!total || !effectUuid) return { ok: 0, total };
  let ok = 0;
  try {
    const \u539F\u4EF6 = await fromUuid(effectUuid);
    if (!\u539F\u4EF6?.toObject) {
      ui.notifications.warn("That spell effect could not be found.");
      return { ok: 0, total };
    }
    const \u540D\u5B57 = String(\u539F\u4EF6.name ?? "");
    for (const t of targets) {
      try {
        const actor = t?.actor ?? t;
        if (!actor?.createEmbeddedDocuments) continue;
        const \u5DF2\u6709 = (actor.itemTypes?.effect ?? []).some((e) => String(e?.name ?? "") === \u540D\u5B57);
        if (\u5DF2\u6709) continue;
        const obj = \u539F\u4EF6.toObject();
        obj.flags = obj.flags ?? {};
        obj.flags.pf2e = obj.flags.pf2e ?? {};
        if (origin?.actor?.uuid) {
          obj.flags.pf2e.origin = { actor: origin.actor.uuid };
        }
        await actor.createEmbeddedDocuments("Item", [obj]);
        ok++;
      } catch (err) {
        console.error("player-action-ui-hub | \u8D34\u6548\u679C\u5931\u8D25", t?.name, err);
      }
    }
  } catch (err) {
    console.error("player-action-ui-hub | applyEffectTo \u5931\u8D25", err);
  }
  return { ok, total };
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
    __name(rollStrikeDamage, "rollStrikeDamage");
    __name(execAuxiliary, "execAuxiliary");
    __name(rollSkill, "rollSkill");
    __name(castSpell, "castSpell");
    __name(sendReloadMessage, "sendReloadMessage");
    __name(rollSpellSave, "rollSpellSave");
    __name(rollSpellAttack, "rollSpellAttack");
    __name(rollSpellDamage, "rollSpellDamage");
    __name(spellHasDamage, "spellHasDamage");
    __name(applyEffectTo, "applyEffectTo");
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
  const { total, gap = 0, arcSpan = TAU, center = -Math.PI / 2, weights } = spec;
  const w = weights && weights.length === total ? weights : null;
  const \u603B\u6743 = w ? w.reduce((a, b) => a + b, 0) : total;
  const \u524D\u9762 = w ? w.slice(0, index).reduce((a, b) => a + b, 0) : index;
  const \u672C\u683C = w ? w[index] : 1;
  const start = center - arcSpan / 2 + \u524D\u9762 / \u603B\u6743 * arcSpan;
  const step = \u672C\u683C / \u603B\u6743 * arcSpan;
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
function capsFor(pos, total) {
  const out = [];
  if (pos === 0) out.push("start");
  if (pos === total - 1) out.push("end");
  return out;
}
__name(capsFor, "capsFor");
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
  if (!cur) {
    const fresh = { spent: 0, round, history: [], reactions: 0, attacks: 0 };
    ledgers.set(actorId, fresh);
    return fresh;
  }
  cur.round = round;
  return cur;
}
__name(ledgerFor, "ledgerFor");
function actionsThisTurn(cond = {}) {
  const \u57FA\u51C6 = ACTIONS_PER_TURN + (cond.quickened ? 1 : 0);
  return Math.max(0, \u57FA\u51C6 - Math.max(0, cond.lost ?? 0));
}
__name(actionsThisTurn, "actionsThisTurn");
function remaining(actorId, round, cond = {}) {
  return actionsThisTurn(cond) - ledgerFor(actorId, round).spent;
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
function refund(actorId, round, n) {
  if (n <= 0) return;
  const l = ledgerFor(actorId, round);
  l.spent = Math.max(0, l.spent - n);
}
__name(refund, "refund");
function reactionsLeft(actorId, round) {
  return REACTIONS_PER_TURN - ledgerFor(actorId, round).reactions;
}
__name(reactionsLeft, "reactionsLeft");
function spendReaction(actorId, round) {
  ledgerFor(actorId, round).reactions += 1;
}
__name(spendReaction, "spendReaction");
function noteAttack(actorId, round, n = 1) {
  ledgerFor(actorId, round).attacks += n;
}
__name(noteAttack, "noteAttack");
function attacksThisTurn(actorId, round) {
  return ledgerFor(actorId, round).attacks;
}
__name(attacksThisTurn, "attacksThisTurn");
function resetTurn(actorId, round) {
  ledgers.set(actorId, { spent: 0, round, history: [], reactions: 0, attacks: 0 });
}
__name(resetTurn, "resetTurn");
function clearAll() {
  ledgers.clear();
}
__name(clearAll, "clearAll");
function glyphs(remainingCount, total = ACTIONS_PER_TURN) {
  const \u683C = Math.max(0, total);
  if (remainingCount >= 0) {
    const left = Math.min(remainingCount, \u683C);
    return "\u25C6".repeat(left) + "\u25C7".repeat(\u683C - left);
  }
  return "\u25C7".repeat(\u683C) + "\u2715".repeat(Math.min(-remainingCount, 3));
}
__name(glyphs, "glyphs");
function reactionGlyph(left) {
  return left > 0 ? "\u27F3" : "\u27F2";
}
__name(reactionGlyph, "reactionGlyph");

// src/paging.ts
var PAGE_SIZE = 9;
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
function carryPage(prev, next, nextPageCount) {
  if (!prev || !next) return next?.page ?? 0;
  const \u65E7 = prev.groups?.length ? prev.groups[normalizePage(prev.page, prev.groups.length)]?.label : void 0;
  if (\u65E7 !== void 0 && next.groups?.length) {
    const i = next.groups.findIndex((g) => g.label === \u65E7);
    if (i >= 0) return i;
  }
  return normalizePage(prev.page, nextPageCount);
}
__name(carryPage, "carryPage");

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
var SECTOR_LABEL_UNITS = 7;
var LABEL_LH = 9;
var MAX_LABEL_LINES = 2;
var STATE_MARK = { normal: "", risky: "\u26A0", gated: "\u26D4" };
var HUB_STATE_UNITS = 16;
var HUB_TITLE_MARGIN = 10;
var HUB_TITLE_MIN_SCALE = 0.82;
var HUB_TITLE_PX = 11.5;
var HUB_TITLE_LH_RATIO = 0.95;
var HUB_PARENT_Y = CY - 38;
var HUB_TITLE_Y = CY - 28;
var HUB_ROW_Y = CY - 6;
var HUB_ROW_LH = 11;
var MAX_HUB_ROWS = 6;
var HUB_STATE_RESERVED = 2;
var HUB_NOTE_UNITS = 20;
var HUB_ECONOMY_Y = CY - 50;
var SLOT_BOTTOM_Y = CY + 30;
var SLOT_ROW = 4.6;
var SLOT_COL = 8;
var SLOT_R = 1.7;
var SLOT_SPENT_R = 0.6;
var SLOT_MAX_ROWS = 4;
var SLOT_LABEL_Y = CY + 38;
var SECTOR_GAP = 0.02;
var CAP_H = 2 * W;
var W_CAP = CAP_H / 2;
var CAP_WEIGHTS = [1, 2.2, 1];
var CAP_SEAM = 1.6;
var CAP_INK = 56 * Math.PI / 180;
var CAP_BULGE = 1;
var CAP_GAP_HALF = CAP_SEAM / R / 2;
var GAP_ANGLE = 2 * (CAP_INK / 2 - CAP_GAP_HALF + SECTOR_GAP + capOvershoot(R, W, CAP_BULGE) - SECTOR_GAP / 2);
var ARC_SPAN = Math.PI * 2 - GAP_ANGLE;
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
   * 现在还停在**最外那一层**（分类层）吗。
   *
   * ★ 判据是 `canGoBack === false` —— **只有分类层没有上一层**，
   *   这不是巧合而是定义。拿标题去比对（`title === actor.name`）会在
   *   换身体、改名字时静默失效。
   * ★ 用途：卡上那份清单异步回来之后要不要重建分类层
   *   （已经下钻了就不该把人踢回外层）。
   */
  get atRoot() {
    return this.level.canGoBack === false;
  }
  /**
   * 点击扇区的回调，由外部注入。
   * ⚠ 第二个参数是**真实的 MouseEvent**，不是合成的：掷骰时要原样传给
   *   pf2e 的 `variant.roll({ event })`，生态里的模组（PF2e Toolbelt 自动掩护等）
   *   靠它拿检定上下文（设计定档 §6.3）。
   */
  onPick;
  /*
   * ⛔ **「点盘外关闭」已经拆掉**（Nous 2026-08-08）：
   *   > "点击其他地方会关掉 ui 重置不是好设计，一旦误触就会重置不好，
   *   >  手抖全家爆炸。还是单独留 esc 退出 ui 最好。"
   *
   * ★ 病根：这个盘是**有状态**的 —— 下钻了两层、翻到第 3 环、
   *   编排走到第二步。一次落在盘外的点击把这些全清了，
   *   而**"点空白处"恰恰是没点中扇区时最容易发生的那一下**：
   *   手抖的代价从"这次没点着"升级成"从头再来"。
   * ★ 关闭的路留了三条，每一条都是**明确要关**的动作：Esc、返回键退到底、执行完自动关。
   */
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
   * 点毂里那几行说明 → 打开这个 uuid 的说明窗。由外部注入（这一层不碰 Foundry 的文档 API）。
   * ⚠ 与 `onPick` 分开：**看说明不等于执行**（合成一个会让人不敢点）。
   */
  onInfo;
  /**
   * 取职业状态行的回调，由外部注入。返回空数组 = 这一格不出现。
   * ⚠ 与 economy 不同，它**不受"在不在战斗中"限制** ——
   *   专注点余量在战斗外一样有意义。
   */
  classState;
  /** 无操作自动收起的计时器 */
  /** 换一层内容并重绘（钻取与双向绑定都走这里） */
  async setLevel(level) {
    this.level = level;
    this.#\u5168\u540D = null;
    this.#\u5168\u540D\u63D0\u793A(null);
    this.#hoveredIndex = null;
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
   *
   * ⚠⚠ **翻页位置同理，而且原来漏了**（2026-08-08 修）：上面这句意图只对 `variant`
   *   实现过，`paging` 没带 —— 而每个 `rebuild` 返回的都是 `page: 0`。
   *   于是在 1 环页点一下休息，盘就弹回戏法页；戏法页上没有环 badge，
   *   看起来像"数据没刷新"。★ **位置丢失会伪装成数据不更新**，
   *   查的时候差点顺着"双向绑定坏了"往下挖（那条链实测是好的）。
   *   带法见 `carryPage`：有分组时按**环标签**找回，不按下标。
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
    if (next.paging) {
      const \u65B0\u9875\u6570 = next.paging.groups?.length || pageCount(next.sectors.length);
      next.paging.page = carryPage(this.level.paging, next.paging, \u65B0\u9875\u6570);
    }
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
      for (const which of capsFor(pos, total)) {
        const cap = document.createElementNS(SVG_NS, "path");
        cap.setAttribute("d", ringCapPath(ring, which, CAP_BULGE));
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
        const \u5168\u90E8 = wrapText(sector.label, SECTOR_LABEL_UNITS);
        const \u884C = \u5168\u90E8.slice(0, MAX_LABEL_LINES);
        if (\u5168\u90E8.length > MAX_LABEL_LINES && \u884C.length) \u884C[\u884C.length - 1] += "\u2026";
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", String(c.x));
        text.setAttribute("y", String(c.y - (\u884C.length - 1) * LABEL_LH / 2));
        text.setAttribute(
          "class",
          `pauih-label state-${sector.state}${sector.tone ? ` tone-${sector.tone}` : ""}`
        );
        text.dataset.index = String(index);
        \u884C.forEach((l, i) => {
          const span = document.createElementNS(SVG_NS, "tspan");
          span.setAttribute("x", String(c.x));
          if (i > 0) span.setAttribute("dy", String(LABEL_LH));
          span.textContent = l;
          text.appendChild(span);
        });
        svg.appendChild(text);
      }
      const \u8B66\u793A = STATE_MARK[sector.state] ?? "";
      if (\u8B66\u793A) {
        const mark = document.createElementNS(SVG_NS, "text");
        mark.setAttribute("x", String(c.x + 9));
        mark.setAttribute("y", String(c.y - 7));
        mark.setAttribute("class", `pauih-state-mark state-${sector.state}`);
        mark.textContent = \u8B66\u793A;
        mark.dataset.index = String(index);
        svg.appendChild(mark);
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
    const cells = [
      { action: "next", glyph: "\u203A", enabled: this.#canStep(1) },
      { action: "back", glyph: "\u21A9", enabled: this.level.canGoBack },
      { action: "prev", glyph: "\u2039", enabled: this.#canStep(-1) }
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
      center: Math.PI / 2,
      // 整段弧的中心指向正下方
      /*
       * ★ 返回键做宽、箭头做窄（Nous 2026-08-07）。
       * ⚠ 顺序跟着 `cells` 走 —— 那个数组是**反的**（下标越大越靠左），
       *   所以中间那个 2.2 对的是 `back`。改 cells 顺序时这里要一起改，
       *   两者对不上不会报错，只会把宽格子放到箭头上。
       */
      weights: CAP_WEIGHTS
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
      for (const which of capsFor(index, cells.length)) {
        const end = document.createElementNS(SVG_NS, "path");
        end.setAttribute("d", ringCapPath(bar, which));
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
      return t;
    }, "line");
    if (!sector) {
      const \u5C42 = this.#\u753B\u6807\u9898(g, this.level.title, HUB_TITLE_Y, "pauih-hub-title");
      this.#\u5168\u540D = \u5C42.truncated ? this.level.title : null;
    } else {
      const \u7236\u5C42 = this.level.canGoBack ? this.level.title : null;
      if (\u7236\u5C42) line(\u7236\u5C42, HUB_PARENT_Y, "pauih-hub-parent");
      const \u540D = sector.hubLabel ?? sector.label;
      const \u6807 = this.#\u753B\u6807\u9898(
        g,
        \u540D,
        HUB_TITLE_Y,
        `pauih-hub-title${sector.tone ? ` tone-${sector.tone}` : ""}`,
        sector.infoUuid
      );
      this.#\u5168\u540D = \u6807.truncated ? \u540D : null;
    }
    let \u884C\u53F7 = 0;
    const \u4E0B\u4E00\u884C\u4F4D = /* @__PURE__ */ __name(() => \u884C\u53F7 >= MAX_HUB_ROWS ? null : HUB_ROW_Y + \u884C\u53F7++ * HUB_ROW_LH, "\u4E0B\u4E00\u884C\u4F4D");
    const \u753B\u884C = /* @__PURE__ */ __name((text, cls) => {
      const y = \u4E0B\u4E00\u884C\u4F4D();
      if (y !== null) line(text, y, cls);
    }, "\u753B\u884C");
    const mode = this.#arrowMode();
    if (mode === "page") {
      const total = this.#pageCount();
      const g2 = this.#pageGroup();
      const \u6709\u70B9\u9635 = !!this.level.slots?.columns.length;
      \u753B\u884C(
        g2 ? \u6709\u70B9\u9635 || !g2.badge ? g2.label : `${g2.label}  ${g2.badge}` : `${normalizePage(this.level.paging.page, total) + 1} / ${total}`,
        "pauih-variant"
      );
    } else if (this.level.variant?.labels.length && \u884C\u53F7 < MAX_HUB_ROWS) {
      const v = this.level.variant;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(CX));
      t.setAttribute("y", String(\u4E0B\u4E00\u884C\u4F4D()));
      t.setAttribute("class", "pauih-variant");
      v.labels.forEach((l, i) => {
        if (i > 0) {
          const sep = document.createElementNS(SVG_NS, "tspan");
          sep.setAttribute("class", "pauih-variant-sep");
          sep.textContent = " \xB7 ";
          t.appendChild(sep);
        }
        const span = document.createElementNS(SVG_NS, "tspan");
        span.setAttribute("class", i === v.index ? "pauih-variant-on" : "pauih-variant-off");
        span.textContent = i === v.index ? l : l.replace(/^◆\s*/, "");
        t.appendChild(span);
      });
      g.appendChild(t);
    }
    const \u72B6\u6001\u884C = [];
    for (const entry of this.classState?.() ?? []) {
      for (const l of wrapText(entry, HUB_STATE_UNITS)) \u72B6\u6001\u884C.push(l);
    }
    const \u6570\u503C\u4E0A\u9650 = MAX_HUB_ROWS - Math.min(\u72B6\u6001\u884C.length, HUB_STATE_RESERVED);
    for (const n of sector?.hubNotes ?? []) {
      for (const l of wrapText(n, HUB_NOTE_UNITS)) {
        if (\u884C\u53F7 >= \u6570\u503C\u4E0A\u9650) break;
        \u753B\u884C(l, "pauih-hub-detail");
      }
      if (\u884C\u53F7 >= \u6570\u503C\u4E0A\u9650) break;
    }
    if (this.level.slots?.columns.length) {
      const cols = this.level.slots.columns;
      const \u9875 = this.#pageGroup();
      const current = \u9875 ? cols.findIndex((c) => c.label === \u9875.label) : -1;
      this.#\u753B\u70B9\u9635(g, { columns: cols, current }, this.#\u5C06\u82B1\u6389(cols, current, sector));
      this.#paintEconomy(g);
      return;
    }
    for (const l of \u72B6\u6001\u884C) \u753B\u884C(l, "pauih-class-state");
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
    const pips = glyphs(econ.remaining, econ.total);
    const hasReaction = econ.reactionsLeft !== void 0;
    const \u7EC4\u534A\u5BBD = (pips.length - 1) * pipDx / 2;
    const \u4FA7\u8DDD = \u7EC4\u534A\u5BBD + pipDx + 2;
    [...pips].forEach((ch, i) => {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(CX - \u7EC4\u534A\u5BBD + i * pipDx));
      t.setAttribute("y", String(y));
      t.setAttribute("class", `pauih-pip${ch === "\u25C6" ? " full" : ch === "\u2715" ? " over" : ""}`);
      t.textContent = ch;
      g.appendChild(t);
    });
    if (hasReaction) {
      const left = econ.reactionsLeft;
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", String(CX - \u4FA7\u8DDD));
      t.setAttribute("y", String(y));
      t.setAttribute("class", `pauih-reaction${left > 0 ? " full" : ""}`);
      t.textContent = reactionGlyph(left);
      g.appendChild(t);
    }
    const undo = document.createElementNS(SVG_NS, "text");
    undo.setAttribute("x", String(CX + \u4FA7\u8DDD));
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
    const g = this.#pageGroup();
    if (g) return all.slice(g.from, g.from + g.count);
    return this.level.paging ? pageOf(all, this.level.paging.page) : all;
  }
  /**
   * 悬停这一格，会吃掉当前这一环的**哪一个位** —— 返回那个点的行号；不预示时 −1。
   *
   * ★ Nous 2026-08-08 定的：
   *   > "在第二页开始的里面，悬浮于会用到那个技能槽中匹配的点开始闪烁变红，
   *   >  表示你发法术会用到。"
   *   ★ 这一条把点阵从**记账**变成**预告**：原来它答"我还剩几个"，
   *     现在还答"点下去之后会变成什么样" —— 而后者才是做决定要的。
   *
   * ⚠ **戏法页天然不预示**：`slotMatrix` 不收 cantrips，所以那一页
   *   `current` 恒为 −1（实测过）。不用另写一条"是不是戏法"的判断 ——
   *   少一个自己维护的判据，就少一处会和系统说法分叉的地方。
   *
   * 四道闸，每道都对应一种"点了其实不花位"：
   *   ① 没悬停；② 出口格（`tone: "link"`，开角色卡的那个蓝 `+`）；
   *   ③ 规则上此刻用不了（`gated`）；④ 这一环已经空了。
   * ⚠ 由下往上填，所以"下一个被吃的"是**最上面那个还亮着的**，即 `value - 1`。
   *   ⚠ 这里**不夹到画得下的行数**：夹了就会指着一个错的位，
   *     由调用处按行号是否超出去决定改点 `^`（见 `#画点阵`）。
   */
  #\u5C06\u82B1\u6389(cols, current, sector) {
    if (!sector || current < 0) return -1;
    if (sector.tone === "link" || sector.state === "gated") return -1;
    const \u5269 = cols[current]?.value ?? 0;
    return \u5269 > 0 ? \u5269 - 1 : -1;
  }
  /** 当前页对应的组；这一层不是按组分页时返回 null。 */
  #pageGroup() {
    const gs = this.level.paging?.groups;
    if (!gs?.length) return null;
    return gs[normalizePage(this.level.paging.page, gs.length)] ?? null;
  }
  /** 这一层总共几页；没有分页状态时恒为 1。 */
  #pageCount() {
    if (this.level.paging?.groups?.length) return this.level.paging.groups.length;
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
  /**
   * 往这个方向还走不走得动（`+1` 下一项 / `-1` 上一项）。
   *
   * ★★ **不循环**（Nous 2026-08-07："不要无限滚轮：1>2>3 就停下，
   *   然后左右键会因为到底了置灰"）。
   *   循环的毛病是**没有边界反馈**：翻到最后一页再点一下，画面变了，
   *   但玩家以为自己翻过了头还是没翻动 —— 他得读页码才知道。
   *   到底就停 + 箭头变灰，手感和页码是同一件事，不用读数字。
   */
  #canStep(delta) {
    const mode = this.#arrowMode();
    if (mode === "page") {
      const p = this.level.paging.page;
      return delta > 0 ? p < this.#pageCount() - 1 : p > 0;
    }
    if (mode === "variant") {
      const v = this.level.variant;
      return delta > 0 ? v.index < v.labels.length - 1 : v.index > 0;
    }
    return false;
  }
  /**
   * 往这个方向走一步；走不动就什么都不做（**不循环**）。
   * @returns 真的动了没有
   */
  #step(delta) {
    if (!this.#canStep(delta)) return false;
    const mode = this.#arrowMode();
    if (mode === "page") this.level.paging.page += delta;
    else if (mode === "variant") this.level.variant.index += delta;
    void this.render(false);
    return true;
  }
  _replaceHTML(result, content) {
    content.replaceChildren(result);
    content.addEventListener("click", this.#onClick);
    content.addEventListener("mouseover", this.#onHover);
    content.addEventListener("wheel", this.#onWheel, { passive: false });
  }
  /**
   * 续上"无操作自动收起"的计时（Nous 2026-08-05 提出：晾着不动会挡视野）。
   * 任何交互——移动鼠标、点击、翻页、重绘——都会重新计时。
   */
  /**
   * 滚轮 = 翻页 / 翻档（Nous 2026-08-07："在 ui 里面滚轮没有，我们可以借用这个来做翻页"）。
   *
   * ★ 复用**底部胶囊那套完全一样的逻辑**：`#arrowMode()` 决定这一层的箭头管的是
   *   分页还是 MAP 档位，滚轮就跟着它走。分两套写必然分叉 ——
   *   胶囊翻到第 2 页、滚轮却翻档位，是最难查的那种"看起来随机"的毛病。
   *
   * ⚠ 必须 `preventDefault`：不挡的话滚轮会穿到画布上去缩放地图，
   *   玩家想翻页却把整张图缩没了。
   * ⚠ `passive: false` 不能省 —— 被动监听里 preventDefault 无效且只在控制台给一句警告。
   */
  #onWheel = /* @__PURE__ */ __name((ev) => {
    const mode = this.#arrowMode();
    if (mode === "none") return;
    ev.preventDefault();
    ev.stopPropagation();
    this.#step(ev.deltaY > 0 ? 1 : -1);
  }, "#onWheel");
  #onClick = /* @__PURE__ */ __name((ev) => {
    const el = ev.target;
    const nav = el?.dataset?.nav;
    if (nav) {
      if (nav === "prev" || nav === "next") {
        this.#step(nav === "next" ? 1 : -1);
      } else if (nav === "undo") {
        this.onUndo?.();
        void this.render(false);
      } else if (nav === "back") {
        this.onPick({ id: "__back", label: "Back", cost: null, state: "normal" }, ev);
      }
      return;
    }
    const info = el?.dataset?.info;
    if (info) {
      this.onInfo?.(info);
      return;
    }
    const idx = el?.dataset?.index;
    if (idx === void 0) return;
    const sector = this.level.sectors[Number(idx)];
    if (sector) this.onPick(sector, ev);
  }, "#onClick");
  /**
   * 画标题，长名字**先缩后断**（Nous 2026-08-07："这种太长的名字的需要缩小字号并且换行"）。
   *
   * ★★ **宽度是量出来的，不是算出来的。**
   *   我第一版按"每单位 ≈ 0.84 × 字号"推预算 —— 实测差了三成
   *   （Signika 比那个系数宽，标题还带 0.5px 的 letter-spacing），
   *   于是"缩完了"的标题照样顶出去 18 个单位。
   *   ⚠ 这个错**看不出来**：缩放确实生效了，只是缩得不够。
   *   ★ 元素已经在 DOM 里，`getBBox()` 一量就有真值 —— 别为省一次测量去猜一个系数。
   *
   * ⚠⚠ **锚只钉第一行**。名字是锚（playbook 总纲），它的 y 必须是常量；
   *   第二行往下长，说明区跟着让位 —— 让位的是**解释**，不是锚。
   *
   * @returns `h` = 第二行占掉的额外高度（0 = 只有一行）；
   *          `truncated` = 名字**没显示全**（收了省略号）——上层据此挂全名提示
   */
  #\u753B\u6807\u9898(g, text, y, cls, infoUuid) {
    const \u753B = /* @__PURE__ */ __name((t, yy) => {
      const el = document.createElementNS(SVG_NS, "text");
      el.setAttribute("x", String(CX));
      el.setAttribute("y", String(yy));
      el.setAttribute("class", infoUuid ? `${cls} linkable` : cls);
      el.textContent = t;
      if (infoUuid) el.dataset.info = infoUuid;
      g.appendChild(el);
      return el;
    }, "\u753B");
    const dy = y - CY;
    const \u53EF\u7528 = 2 * Math.sqrt(Math.max(0, R_HUB * R_HUB - dy * dy)) - HUB_TITLE_MARGIN;
    const \u7B2C\u4E00 = \u753B(text, y);
    let \u5BBD = \u7B2C\u4E00.getBBox().width;
    if (\u5BBD <= \u53EF\u7528) return { h: 0, truncated: false };
    const scale = Math.max(HUB_TITLE_MIN_SCALE, \u53EF\u7528 / \u5BBD);
    \u7B2C\u4E00.setAttribute("font-size", `${(HUB_TITLE_PX * scale).toFixed(2)}px`);
    \u5BBD = \u7B2C\u4E00.getBBox().width;
    if (\u5BBD <= \u53EF\u7528) return { h: 0, truncated: false };
    const \u6BCF\u5355\u4F4D = \u5BBD / Math.max(1, textWidth(text));
    const \u884C = wrapText(text, \u53EF\u7528 / \u6BCF\u5355\u4F4D);
    const lh = HUB_TITLE_PX * scale * HUB_TITLE_LH_RATIO;
    \u7B2C\u4E00.textContent = \u884C[0];
    if (\u884C.length <= 1) return { h: 0, truncated: false };
    const \u6536\u4E86 = \u884C.length > 2;
    const \u7B2C\u4E8C = \u753B(\u6536\u4E86 ? \u884C[1] + "\u2026" : \u884C[1], y + lh);
    \u7B2C\u4E8C.setAttribute("font-size", `${(HUB_TITLE_PX * scale).toFixed(2)}px`);
    return { h: lh, truncated: \u6536\u4E86 };
  }
  /**
   * 画法术位点阵图。
   *
   * ★ 形态是 Nous 2026-08-08 定的："纵是剩余 slot 的点，等于 4 就显示 4 个点，
   *   大于上面还在加一个 `^`；横就是角色有的环数量，下方写 spell slots。"
   *   加上："用掉了的 slot 之后就置灰。"
   *
   * ★ 为什么它比原来那行 `2nd Rank ◈ 4/4` 好：那一行只说得了**当前这一环**，
   *   而选环时要比的是**各环还剩多少**。点阵一眼给全，占的地方还更小。
   *
   * ⚠ 由下往上填：剩下的在底下（电池的样子），用掉的灰点浮在上面。
   *   反过来画的话"还剩几个"要从顶上数下来，多一步换算。
   */
  #\u753B\u70B9\u9635(g, slots, \u5C06\u82B1\u6389 = -1) {
    const cols = slots.columns;
    if (!cols.length) return;
    const \u603B\u5BBD = (cols.length - 1) * SLOT_COL;
    cols.forEach((c, ci) => {
      const x = CX - \u603B\u5BBD / 2 + ci * SLOT_COL;
      const \u753B\u51E0\u884C = Math.min(SLOT_MAX_ROWS, c.max);
      const \u672C\u5217 = ci === slots.current;
      for (let r = 0; r < \u753B\u51E0\u884C; r++) {
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("cx", String(x));
        dot.setAttribute("cy", String(SLOT_BOTTOM_Y - r * SLOT_ROW));
        const \u8FD8\u5728 = r < c.value;
        dot.setAttribute("r", String(\u8FD8\u5728 ? SLOT_R : SLOT_R * SLOT_SPENT_R));
        dot.setAttribute("class", `pauih-slot-dot${\u8FD8\u5728 ? "" : " spent"}` + (\u672C\u5217 ? " current" : "") + (\u672C\u5217 && r === \u5C06\u82B1\u6389 ? " next" : ""));
        g.appendChild(dot);
      }
      if (c.max > SLOT_MAX_ROWS) {
        const t = document.createElementNS(SVG_NS, "text");
        t.setAttribute("x", String(x));
        t.setAttribute("y", String(SLOT_BOTTOM_Y - SLOT_MAX_ROWS * SLOT_ROW));
        t.setAttribute("class", `pauih-slot-more${\u672C\u5217 ? " current" : ""}` + (\u672C\u5217 && \u5C06\u82B1\u6389 >= SLOT_MAX_ROWS ? " next" : ""));
        t.textContent = "^";
        g.appendChild(t);
      }
    });
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(CX));
    label.setAttribute("y", String(SLOT_LABEL_Y));
    label.setAttribute("class", "pauih-slot-label");
    label.textContent = "spell slots";
    g.appendChild(label);
  }
  #onHover = /* @__PURE__ */ __name((ev) => {
    const el = ev.target;
    if (el?.dataset?.nav !== void 0) return;
    const idx = el?.dataset?.index;
    const g = this.element?.querySelector(".pauih-hub-text");
    if (!g) return;
    if (idx === void 0) return;
    if (idx !== this.#hoveredIndex) {
      this.#hoveredIndex = idx;
      this.#paintHub(g, this.level.sectors[Number(idx)] ?? null);
    }
    this.#\u5168\u540D\u63D0\u793A(el);
  }, "#onHover");
  /**
   * 毂里那个名字**没显示全**时的全名；显示全了就是 null。
   * 由 `#画标题` 每次重画时写，`#全名提示` 读它决定要不要弹黑框。
   */
  #\u5168\u540D = null;
  /**
   * 名字放不下时，在**轮盘上方**弹一个黑框写全名
   * （Nous 2026-08-07："做成 hover 会在 ui 上方显现黑框然后写全名"）。
   *
   * ★★ **用 Foundry 自己的提示层，不自己画一个**：
   *   它的 z-index 是 9999（我们的窗是 app+10），天然压在轮盘上面；
   *   跟随、延迟、消失、配色全是现成的，还与用户的主题一致。
   *   自己画一个要重做这一整套，而且一定跟 core 的长得不一样。
   *
   * ⚠ 挂在**扇区元素**上而不是毂上：提示要指着"你正指的那一格"，
   *   指着毂的话玩家不知道它在说谁。
   * ⚠ 每次悬停都要先关再开 —— 不关的话换一格时旧提示会留在原地。
   */
  #\u5168\u540D\u63D0\u793A(el) {
    const tip = game?.tooltip;
    if (!tip) return;
    try {
      tip.deactivate?.();
      if (el && this.#\u5168\u540D) tip.activate?.(el, { text: this.#\u5168\u540D, direction: "UP" });
    } catch (err) {
      console.error("player-action-ui-hub | \u5168\u540D\u63D0\u793A\u5931\u8D25", err);
    }
  }
  /**
   * 毂里现在显示的是哪一格（`data-index` 的原文），`null` = 还没悬停过任何一格。
   *
   * ⚠ 换层时必须清掉 —— 不清的话新层第一眼显示的是**上一层某一格**的说明。
   * ⚠⚠ **它只回答"毂里画的是谁"，不回答"鼠标在哪"**（2026-08-08 钉死）：
   *   毂是停留式的，鼠标离开扇区之后这个值照旧留着。
   *   任何"鼠标此刻在不在某格上"的判断都**不能**拿它当依据 ——
   *   全名提示就是这么坏过一次的（见 `#onHover` 末尾）。
   */
  #hoveredIndex = null;
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
    this.escHandler = (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      void this.close();
    };
    setTimeout(() => {
      document.addEventListener("keydown", this.escHandler, { capture: true });
    }, 0);
  }
  /**
   * 关盘时要收拾的**盘外状态**（目前只有一处：选目标层预选的那些目标）。
   *
   * ⚠ 必须挂在这里而不是各个关盘调用点：关的路有三条
   *   （Esc、返回退到底、执行完自动关），漏掉任何一条都会**把选中的目标留在画布上** ——
   *   而盘一关就没有取消它们的入口了。
   *   ★ Nous 2026-08-08 实机撞到的就是这个："我被夹在这个无法清除的选择框里面。"
   */
  onClosed;
  async close(options = {}) {
    this.rebuild = void 0;
    try {
      this.onClosed?.();
    } catch (err) {
      console.error("player-action-ui-hub | onClosed \u5931\u8D25", err);
    }
    this.#\u5168\u540D = null;
    this.#\u5168\u540D\u63D0\u793A(null);
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

// src/icons.ts
var CATEGORY_ICONS = {
  strikes: "icons/svg/sword.svg",
  actions: "icons/svg/walk.svg",
  skills: "icons/svg/book.svg",
  class: "icons/svg/tower-flag.svg",
  spells: "icons/svg/aura.svg",
  // 循环箭头 —— 与扇区上那个 ⟳ 记号同形，两处指的是同一件事
  reactions: "icons/svg/regen.svg",
  // 自由动作：不花动作点 —— 用"轻"的意象，与 actions 的走路人明确区分
  free: "icons/svg/wing.svg",
  /*
   * 激活（卷轴/魔杖/药水/药剂）——**背包里那些能点一下放效果的东西**。
   * ⚠ 不能用 `book.svg`：那是 skills 那一格在用的，同图标等于没图标。
   * ⚠ 也不能像 spells：这两格**会同时出现**（法师既有法术书又有卷轴），
   *   长得像就等于让人每次都要读一遍标签才知道点哪个。
   * ★ 用箱子：与 spells 的光环、skills 的书都明显不同，
   *   而且"从包里掏一件出来"正是这一格的语义。
   */
  activations: "icons/svg/chest.svg",
  // 换的是"谁在做"，不是"做什么" —— 用个明显不同类的图标把这条轴分开
  bodies: "icons/svg/pawprint.svg",
  // 沙漏 —— 这一格问的是"什么该随时间降下去"
  conditions: "icons/svg/hazard.svg"
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

// src/triggers.ts
function expandLocalize(html, localize) {
  if (!localize) return html;
  return String(html).replace(/@Localize\[([^\]]+)\]/g, (_, key) => {
    try {
      return localize(String(key)) ?? "";
    } catch {
      return "";
    }
  });
}
__name(expandLocalize, "expandLocalize");
function triggerOf(descriptionHtml, localize) {
  const html = expandLocalize(String(descriptionHtml ?? ""), localize);
  const m = html.match(/<strong>\s*Trigger\s*<\/strong>\s*([\s\S]{0,1200}?)(<\/p>|<hr|<strong)/i);
  if (!m) return null;
  const \u6587 = stripTags(m[1]);
  return \u6587 ? \u6587 : null;
}
__name(triggerOf, "triggerOf");
function stripTags(html) {
  return String(html).replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "$1").replace(/@UUID\[[^\]]+\]/g, "").replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/@\w+\[[^\]]*\]/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
__name(stripTags, "stripTags");
function requirementOf(descriptionHtml, localize) {
  const html = expandLocalize(String(descriptionHtml ?? ""), localize);
  const m = html.match(/<strong>\s*Requirements?\s*<\/strong>\s*([\s\S]{0,1200}?)(<\/p>|<hr|<strong)/i);
  if (!m) return null;
  const \u6587 = stripTags(m[1]);
  return \u6587 ? \u6587 : null;
}
__name(requirementOf, "requirementOf");
function clauseFor(descriptionHtml, isReaction2, localize) {
  return isReaction2 ? triggerOf(descriptionHtml, localize) ?? requirementOf(descriptionHtml, localize) : requirementOf(descriptionHtml, localize);
}
__name(clauseFor, "clauseFor");
var HUB_CLAUSE_MAX = 114;
function shorten(text, max = HUB_CLAUSE_MAX) {
  if (!text) return null;
  if (text.length <= max) return text;
  const \u786C\u5207 = text.slice(0, max - 1);
  const \u7A7A\u683C = \u786C\u5207.lastIndexOf(" ");
  const \u5207\u70B9 = \u7A7A\u683C > max * 0.6 ? \u7A7A\u683C : \u786C\u5207.length;
  return text.slice(0, \u5207\u70B9).replace(/[\s,;:]+$/, "") + "\u2026";
}
__name(shorten, "shorten");
function summaryOf(descriptionHtml, localize) {
  const html = expandLocalize(String(descriptionHtml ?? ""), localize);
  if (!html.trim()) return null;
  const i = html.indexOf("<hr");
  let \u6B63\u6587 = i >= 0 ? html.slice(html.indexOf(">", i) + 1) : html;
  const j = \u6B63\u6587.indexOf("<hr");
  if (j >= 0) \u6B63\u6587 = \u6B63\u6587.slice(0, j);
  \u6B63\u6587 = \u6B63\u6587.replace(/^(\s*<p>\s*)<strong>[^<]*<\/strong>/i, "$1");
  const \u6587 = stripTags(\u6B63\u6587);
  return \u6587 ? \u6587 : null;
}
__name(summaryOf, "summaryOf");
function detailLine(descriptionHtml, isReaction2, max = HUB_CLAUSE_MAX, localize) {
  return shorten(summaryOf(descriptionHtml, localize) ?? clauseFor(descriptionHtml, isReaction2, localize), max);
}
__name(detailLine, "detailLine");

// src/restrictions.ts
function isRaging(actor) {
  const a = actor;
  const \u6709\u6548\u679C = (a?.itemTypes?.effect ?? []).some((e) => e?.slug === "effect-rage");
  if (\u6709\u6548\u679C) return true;
  try {
    return !!a?.getRollOptions?.(["all"])?.includes?.("rage");
  } catch {
    return false;
  }
}
__name(isRaging, "isRaging");
function restrictionFor(item, state) {
  if (!state.raging) return null;
  const traits = item.traits ?? [];
  if (!traits.includes("concentrate")) return null;
  if (traits.includes("rage")) return null;
  if (item.slug === "seek") return null;
  return {
    state: "gated",
    reason: "Raging: you can't use concentrate actions unless they have the rage trait."
  };
}
__name(restrictionFor, "restrictionFor");
function restrictionStateOf(actor) {
  return { raging: isRaging(actor) };
}
__name(restrictionStateOf, "restrictionStateOf");

// src/sheet-actions.ts
var \u7F13\u5B582 = /* @__PURE__ */ new Map();
function \u6536(raw, group) {
  const id = raw?.id ?? raw?.item?.id;
  if (!id) return null;
  const cost = raw?.actionCost ?? raw?.cost ?? null;
  const n = cost?.type === "action" ? Number(cost?.value) : null;
  return {
    id: String(id),
    name: String(raw?.name ?? raw?.label ?? "?"),
    img: raw?.img,
    group,
    // ⚠ 只有卡明确说 false 才当不可用：不少条目根本不带这个字段
    usable: raw?.usable !== false,
    traits: (raw?.traits ?? []).map((t) => String(t?.value ?? t?.slug ?? t)),
    actions: Number.isFinite(n) ? n : null,
    frequency: raw?.frequency ?? null
  };
}
__name(\u6536, "\u6536");
function normalizeSheetActions(actions) {
  const out = [];
  const \u63A8 = /* @__PURE__ */ __name((arr, group) => {
    for (const raw of arr ?? []) {
      const x = \u6536(raw, group);
      if (x) out.push(x);
    }
  }, "\u63A8");
  const enc = actions?.encounter;
  if (enc) {
    \u63A8(enc.action?.actions, "action");
    \u63A8(enc.reaction?.actions, "reaction");
    \u63A8(enc.free?.actions, "free");
  }
  if (actions?.active?.actions) {
    for (const raw of actions.active.actions) {
      const \u6D88\u8017 = raw?.actionCost?.type ?? raw?.cost?.type;
      const g = \u6D88\u8017 === "reaction" ? "reaction" : \u6D88\u8017 === "free" ? "free" : "action";
      const x = \u6536(raw, g);
      if (x) out.push(x);
    }
  }
  return out;
}
__name(normalizeSheetActions, "normalizeSheetActions");
async function primeSheetActions(actor) {
  const a = actor;
  const id = a?.id;
  if (!id) return;
  try {
    const ctx = await a.sheet?.getData?.({});
    const list = normalizeSheetActions(ctx?.actions);
    if (ctx) \u7F13\u5B582.set(id, list);
    else \u7F13\u5B582.delete(id);
  } catch {
    \u7F13\u5B582.delete(id);
  }
}
__name(primeSheetActions, "primeSheetActions");
function sheetActionsOf(actor) {
  const id = actor?.id;
  return id ? \u7F13\u5B582.get(id) ?? null : null;
}
__name(sheetActionsOf, "sheetActionsOf");
function clearSheetActions() {
  \u7F13\u5B582.clear();
}
__name(clearSheetActions, "clearSheetActions");

// src/collectors/sheet-sectors.ts
function sheetSector(s, idPrefix, item, \u9650\u5236\u6001) {
  const it = item;
  const cost = s.group === "reaction" ? "reaction" : s.group === "free" ? "free" : costToSectorCost(s.actions);
  const \u9650 = restrictionFor({ slug: it?.slug ?? null, traits: s.traits }, \u9650\u5236\u6001);
  const \u6B21 = frequencyBadge(s.frequency);
  return {
    id: `${idPrefix}${s.id}`,
    label: s.name,
    img: s.img,
    cost,
    // ⚠ 两种角标不能都要：反应的 ⟳ 是"这是什么"，次数是"还剩几次"。
    //   同时出现会挤在一格里互相顶掉 —— 次数更要紧，它决定点不点得动。
    badge: \u6B21 ?? (cost === "reaction" ? "\u27F3" : void 0),
    detail: detailLine(
      it?.system?.description?.value ?? "",
      cost === "reaction",
      HUB_CLAUSE_MAX,
      (k) => game.i18n.localize(k)
    ) ?? void 0,
    // ★ 说明可点 —— 卡上的条目本身就是文档，直接给它的 uuid
    infoUuid: it?.uuid,
    state: \u9650?.state ?? (\u7528\u5B8C\u4E86(s.frequency) ? "gated" : "normal"),
    reason: \u9650?.reason ?? (\u7528\u5B8C\u4E86(s.frequency) ? `Used up \u2014 ${perLabel(s.frequency?.per)} limit of ${s.frequency?.max}.` : void 0)
  };
}
__name(sheetSector, "sheetSector");
function \u7528\u5B8C\u4E86(f) {
  return !!f && Number(f.value) <= 0;
}
__name(\u7528\u5B8C\u4E86, "\u7528\u5B8C\u4E86");
function frequencyBadge(f) {
  if (!f || !Number.isFinite(Number(f.max))) return void 0;
  return `${Number(f.value ?? 0)}/${Number(f.max)}`;
}
__name(frequencyBadge, "frequencyBadge");
function perLabel(per) {
  const \u88683 = {
    round: "per-round",
    turn: "per-turn",
    hour: "hourly",
    day: "daily",
    week: "weekly",
    PT1M: "per-minute",
    PT10M: "per-10-minutes",
    PT1H: "hourly",
    PT24H: "daily"
  };
  return \u88683[String(per)] ?? "frequency";
}
__name(perLabel, "perLabel");

// src/action-uuids.ts
var \u8868 = /* @__PURE__ */ new Map();
async function primeActionUuids() {
  try {
    const pack = game.packs?.get("pf2e.actionspf2e");
    if (!pack) return;
    const idx = await pack.getIndex({ fields: ["system.slug"] });
    for (const e of idx) {
      const slug = e?.system?.slug;
      if (typeof slug === "string" && slug && !\u8868.has(slug)) \u8868.set(slug, e.uuid);
    }
  } catch (err) {
    console.error("player-action-ui-hub | \u53D6\u52A8\u4F5C\u7EB2\u8981\u7D22\u5F15\u5931\u8D25", err);
  }
}
__name(primeActionUuids, "primeActionUuids");
function actionUuid(slug) {
  return \u8868.get(slug);
}
__name(actionUuid, "actionUuid");

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
var BASIC_ACTIONS = ["aid", "take-cover", "tumble-through"];
var SHEET_HINT_ID = "sheet:actions";
function collectActions(actor) {
  try {
    const coll = game.pf2e?.actions;
    const \u9650\u5236\u6001 = restrictionStateOf(actor);
    const \u57FA\u672C = (coll ? BASIC_ACTIONS.map((slug) => coll.get(slug)).filter((a) => !!a) : []).map((a) => \u901A\u7528\u6247\u533A(a, \u9650\u5236\u6001));
    const \u5361 = sheetActionsOf(actor);
    const byId = new Map((actor?.items?.contents ?? []).map((i) => [i.id, i]));
    const \u81EA\u5F55 = (\u5361 ?? []).filter((s) => s.group === "action").map((s) => sheetSector(s, "class:", byId.get(s.id), \u9650\u5236\u6001));
    return [...\u57FA\u672C, ...\u81EA\u5F55, \u6DFB\u52A0\u63D0\u793A()];
  } catch (err) {
    console.error("player-action-ui-hub | collectActions \u5931\u8D25", err);
    return [];
  }
}
__name(collectActions, "collectActions");
function \u6DFB\u52A0\u63D0\u793A() {
  return {
    id: SHEET_HINT_ID,
    /*
     * ⚠ 环上只放一个记号（Nous 2026-08-07："边盘上面的 ui 就只放一个蓝色的加号
     *   就够，本来就没地方放"）。一格宽约 50px，塞得下记号塞不下句子。
     */
    label: "+",
    // 句子在毂里说 —— 那里有的是地方
    hubLabel: "Add on sheet",
    cost: null,
    state: "normal",
    tone: "link",
    detail: "Anything you drag onto your sheet's Actions tab shows up here. Click to open it."
  };
}
__name(\u6DFB\u52A0\u63D0\u793A, "\u6DFB\u52A0\u63D0\u793A");
function collectFreeActions(actor) {
  try {
    const \u5361 = sheetActionsOf(actor);
    if (!\u5361) return [];
    const \u9650\u5236\u6001 = restrictionStateOf(actor);
    const byId = new Map((actor?.items?.contents ?? []).map((i) => [i.id, i]));
    return \u5361.filter((s) => s.group === "free").sort((a, b) => a.name.localeCompare(b.name)).map((s) => sheetSector(s, "class:", byId.get(s.id), \u9650\u5236\u6001));
  } catch (err) {
    console.error("player-action-ui-hub | collectFreeActions \u5931\u8D25", err);
    return [];
  }
}
__name(collectFreeActions, "collectFreeActions");
function \u901A\u7528\u6247\u533A(a, \u9650\u5236\u6001) {
  const \u9650 = restrictionFor({ slug: a.slug, traits: a.traits }, \u9650\u5236\u6001);
  return {
    id: `action:${a.slug}`,
    // ⚠ 必须 localize，理由见 RawAction.name 的注释
    label: game.i18n.localize(a.name),
    // ⚠ 实测 25 条基础动作里 20 条用的是 pf2e 的**通用消耗图标**
    //   （OneAction.webp 之流）—— 一圈全长一样等于没有图标，要换掉
    img: iconFor(a.img, ACTION_ICONS[a.slug]),
    cost: costToSectorCost(a.cost),
    /*
     * ★ **把「要求」摆到眼前**（2026-08-05，丙类调研的副产品）：
     *   实测注册表 70 条里 27 条有 Requirements，
     *   而 Trip 的 "You have at least one hand free" 正是设计定档点名要处理的那条。
     *   这是③段「条件灰显」里**可推导的那一半** ——
     *   判断满不满足很难且容易算错，把要求显示出来推得出来，且零映射。
     * ⚠ `description` 与 `name` 一样是本地化 key，必须 localize 后再解析。
     */
    detail: detailLine(
      a.description ? game.i18n.localize(a.description) : null,
      a.cost === "reaction"
    ) ?? void 0,
    /*
     * ★ **灰显不是禁止**（三态守则）：`gated` 只是变暗 + 画 ⛔ + 在毂里说明为什么，
     *   点下去照样执行。PF2e 的特例太多，误拦比不拦更伤。
     */
    state: \u9650?.state ?? "normal",
    reason: \u9650?.reason,
    // ★ 说明可点 → 打开纲要里那条的说明窗（毂里放不下的部分一点就有）
    infoUuid: actionUuid(a.slug)
  };
}
__name(\u901A\u7528\u6247\u533A, "\u901A\u7528\u6247\u533A");

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
      /*
       * ★ 加值印在**扇区上**（Nous 2026-08-08："skillcheck 里面除了 check
       *   下面有写 +数值 之外，其他的都没有……这个得让所有的都有一致性"）。
       *   毂里的说明区拿掉之后，每一格自己带那个数才是唯一的一致做法。
       */
      badge: `${s.mod >= 0 ? "+" : ""}${s.mod}`,
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
        badge: `${stat.mod >= 0 ? "+" : ""}${stat.mod}`,
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

// src/actor-kinds.ts
var KIND_SPECS = {
  character: { kind: "character", usable: true, abilityTitle: null, abilities: "class" },
  npc: { kind: "npc", usable: true, abilityTitle: "Abilities", abilities: "sheet" },
  familiar: { kind: "familiar", usable: true, abilityTitle: "Abilities", abilities: "sheet" },
  // 陷阱实测**有打击**，GM 要靠它掷攻击
  hazard: { kind: "hazard", usable: true, abilityTitle: "Abilities", abilities: "sheet" },
  vehicle: { kind: "vehicle", usable: true, abilityTitle: "Abilities", abilities: "sheet" },
  army: { kind: "army", usable: true, abilityTitle: "Abilities", abilities: "sheet" },
  loot: {
    kind: "loot",
    usable: false,
    abilityTitle: null,
    abilities: "none",
    note: "A loot pile has nothing to act with."
  },
  party: {
    kind: "party",
    usable: false,
    abilityTitle: null,
    abilities: "none",
    note: "A party actor is a container, not something that acts."
  },
  base: {
    kind: "base",
    usable: false,
    abilityTitle: null,
    abilities: "none",
    note: "This actor type has no sheet data to act on."
  }
};
function kindOf(actor) {
  const t = actor?.type;
  return t && t in KIND_SPECS ? t : "base";
}
__name(kindOf, "kindOf");
function specOf(actor) {
  const k = kindOf(actor);
  return KIND_SPECS[k] ?? KIND_SPECS.npc;
}
__name(specOf, "specOf");
function usesSheetAbilities(actor) {
  return specOf(actor).abilities === "sheet";
}
__name(usesSheetAbilities, "usesSheetAbilities");

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
function pickClassItems(items, classSlug, resolve, sheetAbilities = false) {
  return items.filter((i) => {
    if (i.actionType === "passive") return false;
    return isOwnAbility(i, classSlug, resolve, sheetAbilities);
  });
}
__name(pickClassItems, "pickClassItems");
function isOwnAbility(item, classSlug, resolve, sheetAbilities = false) {
  if (sheetAbilities) return item.type === "action";
  if (classSlug && belongsToClass(item, classSlug, resolve)) return true;
  return !!item.traits?.includes("archetype");
}
__name(isOwnAbility, "isOwnAbility");
function className(actor) {
  return actor?.class?.name ?? specOf(actor).abilityTitle;
}
__name(className, "className");
function collectClassAbilities(actor) {
  try {
    const classSlug = actor?.class?.slug ?? null;
    const items = (actor?.items?.contents ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      img: i.img,
      traits: i.system?.traits?.value ?? [],
      actionType: i.system?.actionType?.value,
      actions: i.system?.actions?.value ?? null,
      category: i.system?.category,
      grantedById: i.flags?.pf2e?.grantedBy?.id ?? null,
      description: i.system?.description?.value ?? ""
    }));
    const byId = new Map(items.map((i) => [i.id, i]));
    const resolve = /* @__PURE__ */ __name((id) => byId.get(id), "resolve");
    const \u9650\u5236\u6001 = restrictionStateOf(actor);
    const \u5361 = sheetActionsOf(actor);
    if (\u5361) {
      const byId2 = new Map((actor?.items?.contents ?? []).map((i) => [i.id, i]));
      return \u5361.map((s) => sheetSector(s, "class:", byId2.get(s.id), \u9650\u5236\u6001));
    }
    return pickClassItems(items, classSlug, resolve, usesSheetAbilities(actor)).map((i) => {
      const \u9650 = restrictionFor({ slug: i.slug ?? null, traits: i.traits }, \u9650\u5236\u6001);
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
        /*
         * ★ **反应显示它的触发条件**（丙类第一件能做的事，2026-08-05）。
         *   实测 105 个反应里 99 个（94%）描述里带 Trigger 段，
         *   而**没有一个**用规则元素表达时机 —— 所以"自动开反应窗口"做不到，
         *   但"把那句话摆到眼前"做得到，且对全职业通用、零映射。
         *   玩家真正卡住的是"我现在到底能不能反击"，答案本来就写在条目里。
         * ⚠ 只给反应。主动动作的触发段（如果有）不是玩家等的那件事。
         */
        //   ⚠ 必须把 localize 传进去：NPC 的能力描述常常整段是 @Localize 引用，
        //     不展开的话**每一个 NPC 反应都读不到触发条件**，而且不报错。
        detail: detailLine(
          i.description,
          cost === "reaction",
          HUB_CLAUSE_MAX,
          (k) => game.i18n.localize(k)
        ) ?? void 0,
        // ★ 灰显不是禁止：变暗 + ⛔ + 毂里说明为什么，点下去照样执行
        state: \u9650?.state ?? "normal",
        reason: \u9650?.reason
      };
    });
  } catch (err) {
    console.error("player-action-ui-hub | collectClassAbilities \u5931\u8D25", err);
    return [];
  }
}
__name(collectClassAbilities, "collectClassAbilities");

// src/spell-slots.ts
var \u7F13\u5B583 = /* @__PURE__ */ new Map();
var \u952E2 = /* @__PURE__ */ __name((actorId, entryId) => `${actorId}::${entryId}`, "\u952E");
async function primeSpellGroups(actor) {
  const a = actor;
  const actorId = a?.id;
  if (!actorId) return;
  for (const entry of a?.spellcasting?.contents ?? []) {
    const k = \u952E2(actorId, entry.id);
    try {
      const sd = await entry.getSheetData?.({});
      if (sd?.groups) \u7F13\u5B583.set(k, sd.groups);
      else \u7F13\u5B583.delete(k);
    } catch {
      \u7F13\u5B583.delete(k);
    }
  }
}
__name(primeSpellGroups, "primeSpellGroups");
function spellGroupsOf(actor, entryId) {
  const actorId = actor?.id;
  return actorId ? \u7F13\u5B583.get(\u952E2(actorId, entryId)) ?? null : null;
}
__name(spellGroupsOf, "spellGroupsOf");
function clearSpellGroups() {
  \u7F13\u5B583.clear();
}
__name(clearSpellGroups, "clearSpellGroups");
function \u7EC4\u540D(g, localize) {
  const raw = String(g.label ?? g.id ?? "");
  return /^PF2E\./.test(raw) && localize ? localize(raw) || raw : raw;
}
__name(\u7EC4\u540D, "\u7EC4\u540D");
function spellPages(groups, localize) {
  const out = [];
  for (const g of groups ?? []) {
    const \u6574\u73AF\u7528\u5B8C = g.uses?.value !== void 0 && Number(g.uses.value) <= 0;
    const entries = [];
    (g.active ?? []).forEach((slot, i) => {
      const sp = slot?.spell;
      if (!slot || !sp?.id) return;
      entries.push({
        expended: \u6574\u73AF\u7528\u5B8C || !!slot.expended,
        spellId: sp.id,
        name: String(sp.name ?? "?"),
        img: sp.img,
        actionGlyph: sp.actionGlyph,
        castRank: Number(slot.castRank ?? sp.rank ?? g.maxRank ?? 1),
        slotIndex: i,
        description: sp.system?.description?.value,
        uuid: sp.uuid
      });
    });
    if (!entries.length) continue;
    const badge = g.uses?.value !== void 0 && Number.isFinite(Number(g.uses.max)) ? `\u25C8 ${Number(g.uses.value)}/${Number(g.uses.max)}` : void 0;
    const label = \u7EC4\u540D(g, localize);
    for (let k = 0; k < entries.length; k += PAGE_SIZE) {
      out.push({ label, badge, entries: entries.slice(k, k + PAGE_SIZE) });
    }
  }
  return out;
}
__name(spellPages, "spellPages");
function slotMatrix(groups) {
  const out = [];
  for (const g of groups ?? []) {
    if (g.id === "cantrips") continue;
    const max = Number(g.uses?.max ?? 0);
    if (!Number.isFinite(max) || max <= 0) continue;
    const \u5269 = g.uses?.value !== void 0 ? Number(g.uses.value) : (g.active ?? []).filter((s) => s && !s.expended).length;
    out.push({ label: String(g.label ?? g.id), value: Math.max(0, Math.min(max, \u5269)), max });
  }
  return out;
}
__name(slotMatrix, "slotMatrix");

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
  const \u7A7A = { sectors: [], groups: [], columns: [] };
  try {
    const entry = actor?.spellcasting?.get?.(entryId);
    if (!entry) return \u7A7A;
    const groups = spellGroupsOf(actor, entryId);
    if (groups) {
      const pages = spellPages(groups, (k) => game.i18n.localize(k));
      const sectors = [];
      const ranges = [];
      for (const p of pages) {
        ranges.push({ label: p.label, badge: p.badge, from: sectors.length, count: p.entries.length });
        for (const e of p.entries) {
          sectors.push({
            id: `spell:${entryId}:${e.spellId}:${e.castRank}:${e.slotIndex}`,
            label: e.name,
            img: e.img,
            cost: spellCost({ actionGlyph: e.actionGlyph }),
            /*
             * ★★ **用掉的位置灰保留，不抽走**（Nous 2026-08-08）：
             *   > "用掉的就直接消失了，这个应该置灰保留，按照原来的 sheet
             *   >  点击弹窗无效，我们那个红框置灰也应该做到一样的效果。"
             *   ★ 角色卡对用掉的法术是**划线保留**（截图里 Force Barrage / Acid Grip）。
             *     整条抽走会让这一页的格数随用量变化，玩家每施一次法就要重新找位置
             *     （playbook 一：格数不变、宽度可变）。
             * ⚠ `gated` 在本盘里是**红框 + 压暗**，而且**照旧可点** ——
             *   点了由 pf2e 自己拒绝（"slot is already expended"），
             *   与角色卡上点划线法术的行为一致。
             * ⚠ 理由**指得到字段**（`slot.expended`），不是我们编的（playbook 7.5）。
             */
            state: e.expended ? "gated" : "normal",
            reason: e.expended ? "That slot is already expended." : void 0,
            // ⚠ 这里**不再画余量角标** —— 余量是整环共用的一个数，
            //   印在每一格上是同一件事说 N 遍。它现在在毂里那一行（页标签）。
            // ★ 法术也要有说明（Nous 2026-08-08："各种法术也没有功能说明"）
            detail: detailLine(
              e.description,
              false,
              HUB_CLAUSE_MAX,
              (k) => game.i18n.localize(k)
            ) ?? void 0,
            infoUuid: e.uuid
          });
        }
      }
      return { sectors, groups: ranges, columns: slotMatrix(groups) };
    }
    const slots = entry.system?.slots ?? {};
    return {
      sectors: [...entry.spells ?? []].map((s) => {
        const slot = s.isCantrip || s.isFocusSpell ? null : slots[`slot${s.rank}`] ?? null;
        return {
          id: `spell:${entryId}:${s.id}`,
          label: s.name,
          img: s.img,
          cost: spellCost(s),
          state: "normal",
          badge: slotBadge(slot)
        };
      }),
      groups: [],
      columns: []
    };
  } catch (err) {
    console.error("player-action-ui-hub | collectSpells \u5931\u8D25", err);
    return \u7A7A;
  }
}
__name(collectSpells, "collectSpells");

// src/collectors/reactions.ts
function isReaction(item) {
  return item.actionType === "reaction" || item.time === "reaction";
}
__name(isReaction, "isReaction");
function pickReactions(items) {
  return items.filter(isReaction).sort((a, b) => a.name.localeCompare(b.name));
}
__name(pickReactions, "pickReactions");
function collectReactions(actor) {
  try {
    const \u5361 = sheetActionsOf(actor);
    if (\u5361) {
      const byId2 = new Map((actor?.items?.contents ?? []).map((i) => [i.id, i]));
      const \u9650\u5236\u6001 = restrictionStateOf(actor);
      return \u5361.filter((s) => s.group === "reaction").sort((a, b) => a.name.localeCompare(b.name)).map((s) => sheetSector(s, "reaction:", byId2.get(s.id), \u9650\u5236\u6001));
    }
    const items = (actor?.items?.contents ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      img: i.img,
      traits: i.system?.traits?.value ?? [],
      actionType: i.system?.actionType?.value,
      time: i.system?.time?.value ?? null,
      actions: i.system?.actions?.value ?? null,
      category: i.system?.category,
      grantedById: i.flags?.pf2e?.grantedBy?.id ?? null,
      description: i.system?.description?.value ?? "",
      // 实测：法术的归属条目在 `system.location.value`
      entryId: i.type === "spell" ? i.system?.location?.value ?? null : null
    }));
    const byId = new Map(items.map((i) => [i.id, i]));
    const resolve = /* @__PURE__ */ __name((id) => byId.get(id), "resolve");
    return pickReactions(items).map((i) => ({
      /*
       * ★ **法术反应沿用 `spell:` 前缀**，让它落回已有的施法分支 ——
       *   施放要扣法术位、要认施法条目，那套逻辑只该有一份。
       *   照抄一份到这里，就是又造了一个会腐坏的副本。
       */
      id: i.type === "spell" && i.entryId ? `spell:${i.entryId}:${i.id}` : `reaction:${i.id}`,
      label: i.name,
      /*
       * ⚠ **不兜底成同一个图标**（2026-08-07 我先那么做了，Nous 否掉）：
       *   反应多半是从纲要直接装上的独立条目，既没有 grantedBy 链可回溯、
       *   自己的图标又是 pf2e 的通用动作图标（视为空缺）——
       *   全兜底成循环箭头的话，一圈长得一模一样，**等于没有图标**。
       * ★ 正解是让**标签断成两行**（见 wheel-app 的 SECTOR_LABEL_UNITS）：
       *   "Reactive Strike" 原来被切成 "Reactive Str…"，那是断行没做，
       *   不是"必须有图标"。
       */
      img: iconFromChain(i, resolve),
      cost: "reaction",
      // 这一整层都是反应，但记号仍要画：玩家会从别的层跳进来，
      // 少了它就得靠"我记得这层是反应层"来读，那是把状态放进人脑
      badge: "\u27F3",
      /*
       * ★ 触发条件就是这一格的**全部价值**。玩家卡住的不是"找不到反击按钮"，
       *   而是"我现在到底能不能反击" —— 而那句话本来就写在条目里。
       * ⚠ 必须传 localize：NPC 的能力描述常常整段是 @Localize 引用，
       *   不展开的话每一个 NPC 反应都读不到触发条件，且不报错。
       */
      detail: detailLine(i.description, true, HUB_CLAUSE_MAX, (k) => game.i18n.localize(k)) ?? void 0,
      // 三态守则：提示不是锁。反应槽用完了也照常可点（见毂里的 ⟳ 计数），
      // 因为"这一轮还能不能反应"是规则判断，规则判断归玩家
      state: "normal"
    }));
  } catch (err) {
    console.error("player-action-ui-hub | collectReactions \u5931\u8D25", err);
    return [];
  }
}
__name(collectReactions, "collectReactions");

// src/collectors/activations.ts
function hasCharges(i) {
  if (!i.uses || i.uses.value === void 0) return true;
  return Number(i.uses.value) > 0;
}
__name(hasCharges, "hasCharges");
function pickActivatable(items) {
  return items.filter((i) => {
    if (!hasCharges(i)) return false;
    if ((i.activationCount ?? 0) > 0) return true;
    return i.type === "consumable" && (i.isMagical === true || i.isAlchemical === true);
  }).sort((a, b) => a.name.localeCompare(b.name));
}
__name(pickActivatable, "pickActivatable");
function collectActivations(actor) {
  try {
    const items = (actor?.items?.contents ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      img: i.img,
      type: i.type,
      isMagical: i.isMagical,
      isAlchemical: i.isAlchemical,
      uses: i.system?.uses ?? null,
      activationCount: Object.keys(i.system?.activations ?? {}).length,
      // ⚠ 消耗品的动作消耗不在 `system.actions` 上，多数是 1 个动作；
      //   读不到就不画记号（宁可不画也不画错一个，同 costToSectorCost 的立场）
      actions: i.system?.actions?.value ?? null,
      description: i.system?.description?.value ?? ""
    }));
    return pickActivatable(items).map((i) => ({
      id: `activate:${i.id}`,
      label: i.name,
      img: i.img,
      cost: costToSectorCost(i.actions ?? null),
      // 还剩几次是"不看就会点错"的信息 → 印在扇区上
      badge: i.uses && Number.isFinite(Number(i.uses.max)) && Number(i.uses.max) > 1 ? `${Number(i.uses.value ?? 0)}/${Number(i.uses.max)}` : void 0,
      detail: detailLine(
        i.description,
        false,
        HUB_CLAUSE_MAX,
        (k) => game.i18n.localize(k)
      ) ?? void 0,
      state: "normal",
      infoUuid: actor?.items?.get?.(i.id)?.uuid
    }));
  } catch (err) {
    console.error("player-action-ui-hub | collectActivations \u5931\u8D25", err);
    return [];
  }
}
__name(collectActivations, "collectActivations");

// src/main.ts
init_executor();

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

// src/class-state.ts
var MAX_STATE_LINES = 3;
var HIDDEN_RESOURCES = /* @__PURE__ */ new Set(["investiture"]);
var RESOURCE_LABELS = {
  focus: "Focus",
  heroPoints: "Hero Points",
  mythicPoints: "Mythic",
  versatileVials: "Vials",
  infusedReagents: "Reagents"
};
function humanizeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
__name(humanizeKey, "humanizeKey");
function resourceLines(actor) {
  const pools = actor?.system?.resources ?? {};
  const out = [];
  for (const [key, v] of Object.entries(pools)) {
    if (HIDDEN_RESOURCES.has(key)) continue;
    const max = Number(v?.max);
    if (!Number.isFinite(max) || max <= 0) continue;
    out.push({
      key: `res:${key}`,
      label: RESOURCE_LABELS[key] ?? humanizeKey(key),
      value: `${Number(v?.value ?? 0)}/${max}`
    });
  }
  return out;
}
__name(resourceLines, "resourceLines");
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
var ACTION_CONDITIONS = ["slowed", "stunned"];
function turnConditions(actor) {
  const \u751F\u6548 = actor?.conditions?.active ?? [];
  let lost = 0;
  const notes = [];
  for (const c of \u751F\u6548) {
    if (ACTION_CONDITIONS.includes(c?.slug)) {
      const n = Number(c?.value ?? 0);
      if (Number.isFinite(n) && n > 0) {
        lost += n;
        notes.push(`${c.name}`);
      }
    }
  }
  const quickened = \u751F\u6548.some((c) => c?.slug === "quickened");
  if (quickened) notes.push("Quickened");
  return { lost, quickened, notes };
}
__name(turnConditions, "turnConditions");
function readClassState(actor) {
  try {
    const resources = resourceLines(actor);
    return { resources, toggles: collectToggles(actor), effects: collectEffects(actor) };
  } catch (err) {
    console.error("player-action-ui-hub | readClassState \u5931\u8D25", err);
    return { resources: [], toggles: [], effects: [] };
  }
}
__name(readClassState, "readClassState");
function classStateLines(input) {
  const \u5F00\u5173 = [
    ...input.toggles.filter((t) => t.value !== "on" && t.value !== "off"),
    ...input.toggles.filter((t) => t.value === "on" || t.value === "off")
  ];
  return [...input.resources, ...\u5F00\u5173, ...input.effects].map((l) => `${l.label} \u2726 ${l.value}`).slice(0, MAX_STATE_LINES);
}
__name(classStateLines, "classStateLines");

// src/main.ts
init_aura_effects();
init_area_effects();

// src/spell-target.ts
function targetingOf(spell) {
  const sys = spell?.system;
  if (sys?.area) return "area";
  const target = String(sys?.target?.value ?? "").trim();
  if (!target) return "none";
  const range = String(sys?.range?.value ?? "").trim();
  if (!range) return "none";
  return "pick";
}
__name(targetingOf, "targetingOf");
var CAST_PREFIX = "cast:";
function castSectorId(spellSectorId) {
  return CAST_PREFIX + spellSectorId.slice("spell:".length);
}
__name(castSectorId, "castSectorId");
function spellSectorIdOf(castId) {
  if (!castId.startsWith(CAST_PREFIX)) return null;
  const rest = castId.slice(CAST_PREFIX.length);
  return rest ? `spell:${rest}` : null;
}
__name(spellSectorIdOf, "spellSectorIdOf");
var ACTS_PREFIX = "acts:";
function actsSectorId(n, spellSectorId) {
  return `${ACTS_PREFIX}${n}:${spellSectorId.slice("spell:".length)}`;
}
__name(actsSectorId, "actsSectorId");
function parseActsSectorId(id) {
  if (!id.startsWith(ACTS_PREFIX)) return null;
  const rest = id.slice(ACTS_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0) return null;
  const n = Number(rest.slice(0, cut));
  const \u5C3E = rest.slice(cut + 1);
  if (!Number.isFinite(n) || n < 1 || !\u5C3E) return null;
  return { n, spellSectorId: `spell:${\u5C3E}` };
}
__name(parseActsSectorId, "parseActsSectorId");

// src/area-buff.ts
var SPELL_EFFECT_APPLY = {
  // 2026-08-08 实测：emanation15，effect = "Spell Effect: Bless"
  bless: "allies",
  // 2026-08-08 实测：emanation10，effect = "Spell Effect: Bane"
  bane: "enemies",
  /*
   * —— 吟游诗人的赞歌（Nous 2026-08-08 点名："这个 anthem，戏称绿屁，
   *    因为朋友玩 bard 每次都放整个屏幕变绿"）——
   *
   * ★ 这一族正是这条路最该覆盖的：**每回合都在放、范围大、贴的人多**。
   *   Courageous Anthem 是 emanation **60 尺** —— 手动一个个点友军正是他说的那个痛点。
   * ⚠ 同族里 **Dirge of Doom / Counter Performance 没有 effect item**（实测效果数 0），
   *   所以登记了也没用（`areaBuffOf` 会在 UUID 那关返回 null）—— 索性不登记，
   *   免得下一个人以为它们已经接上了。
   * ⚠ `Allegro` 是 `1 ally` 的单体法术、没有 area，走的是「选目标」那条路，不属这里。
   */
  "courageous-anthem": "allies",
  // emanation60，effect = "Spell Effect: Courageous Anthem"
  "rallying-anthem": "allies",
  // emanation60，effect = "Spell Effect: Rallying Anthem"
  "valiant-anthem": "allies",
  // emanation30，effect = "Spell Effect: Valiant Anthem"
  /*
   * —— 单体增益：贴给「选目标」那一步选中的人 ——
   *
   * ⚠ 这一类原来是**整条断的**：选完目标、法术也放出去了，
   *   但 `Spell Effect: Haste` 从来没挂上 —— 玩家还得自己去纲要里拖一次。
   *   ★ 而且它不报错，法术卡照常发出去，看着像成了（2026-08-08 扫描时发现）。
   * ⚠ 只登记**确认过描述里恰好一个 effect** 的；`targets` 不需要判敌我，
   *   目标是玩家自己点的 —— 所以这一类比范围那类安全得多。
   */
  haste: "targets",
  // effect = "Spell Effect: Haste"
  heroism: "targets",
  // effect = "Spell Effect: Heroism"
  fly: "targets",
  // effect = "Spell Effect: Fly"
  /*
   * —— 自身增益：不选目标，施放完直接挂到自己身上 ——
   * ⚠ 这一类的 `targetingOf` 是 `none`（没有射程 ⇒ 作用于自己），
   *   所以它**不经过确认层** —— 也不需要：目标只有一个而且不会选错。
   */
  "sure-strike": "self"
  // effect = "Spell Effect: Sure Strike"
};
function areaPickMode(area, hasGrid) {
  if (!hasGrid) return "manual";
  return area?.type === "emanation" && Number(area?.value) > 0 ? "auto" : "manual";
}
__name(areaPickMode, "areaPickMode");
function spellEffectUuidOf(spell) {
  const desc = String(spell?.system?.description?.value ?? "");
  if (!desc) return null;
  const hit = desc.match(/Compendium\.pf2e\.spell-effects\.Item\.[A-Za-z0-9]+/g) ?? [];
  const \u53BB\u91CD = [...new Set(hit)];
  return \u53BB\u91CD.length === 1 ? \u53BB\u91CD[0] : null;
}
__name(spellEffectUuidOf, "spellEffectUuidOf");
function effectApplyOf(spell) {
  const slug = String(spell?.system?.slug ?? "");
  if (!slug) return null;
  const applyTo = SPELL_EFFECT_APPLY[slug];
  if (!applyTo) return null;
  const effectUuid = spellEffectUuidOf(spell);
  if (!effectUuid) return null;
  return { effectUuid, applyTo };
}
__name(effectApplyOf, "effectApplyOf");
function areaBuffOf(spell) {
  const r = effectApplyOf(spell);
  if (r?.applyTo !== "allies" && r?.applyTo !== "enemies") return null;
  return { effectUuid: r.effectUuid, side: r.applyTo };
}
__name(areaBuffOf, "areaBuffOf");

// src/spell-cast.ts
var CHAT_GAP_MS = 1e3;
function maxTargetsOf(targetText) {
  const t = String(targetText ?? "");
  if (!t.trim()) return null;
  const \u6570 = (t.match(/\d+/g) ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!\u6570.length) return null;
  return Math.max(...\u6570);
}
__name(maxTargetsOf, "maxTargetsOf");
function actionRangeOf(timeValue) {
  const m = String(timeValue ?? "").trim().match(/^(\d+)\s+to\s+(\d+)$/);
  if (!m) return null;
  const min = Number(m[1]), max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) return null;
  return { min, max };
}
__name(actionRangeOf, "actionRangeOf");
function castKindOf(input) {
  if (actionRangeOf(input.timeValue)) return "multi-action";
  if (input.effectApplyTo === "allies" || input.effectApplyTo === "enemies") return "area-buff";
  if (input.isAttack) return "attack";
  if (input.saveStatistic && input.targeting === "pick") return "save";
  if (input.effectApplyTo === "targets" || input.effectApplyTo === "self") return "effect";
  return "default";
}
__name(castKindOf, "castKindOf");
function planCast(input) {
  const steps = [
    { kind: "cast", emitsMessage: true, targetIndex: null }
  ];
  if (input.isAttack) {
    for (let i = 0; i < input.targetCount; i++) {
      steps.push({ kind: "attack", emitsMessage: true, targetIndex: i });
    }
  } else if (input.hasSave) {
    for (let i = 0; i < input.targetCount; i++) {
      steps.push({ kind: "save", emitsMessage: true, targetIndex: i });
    }
  }
  if (input.hasDamage) {
    const n = Math.max(1, Math.floor(Number(input.damageCount ?? 1)) || 1);
    for (let i = 0; i < n; i++) {
      steps.push({ kind: "damage", emitsMessage: true, targetIndex: null });
    }
  }
  if (input.hasEffect) {
    steps.push({ kind: "effect", emitsMessage: false, targetIndex: null });
  }
  return steps;
}
__name(planCast, "planCast");
function gapBefore(steps, i, gapMs = CHAT_GAP_MS) {
  if (i <= 0 || i >= steps.length) return 0;
  if (!steps[i].emitsMessage) return 0;
  for (let j = i - 1; j >= 0; j--) {
    if (steps[j].emitsMessage) return gapMs;
  }
  return 0;
}
__name(gapBefore, "gapBefore");

// src/marks.ts
function linkedEffectUuid(descriptionHtml) {
  const links = [...String(descriptionHtml ?? "").matchAll(/@UUID\[([^\]]+)\]\{([^}]*)\}/g)];
  const hit = links.find(([, , label]) => /^\s*Effect:/i.test(label));
  return hit?.[1] ?? null;
}
__name(linkedEffectUuid, "linkedEffectUuid");
function buildMarkEffect(effectSource, origin) {
  const data = foundry.utils.deepClone(effectSource);
  foundry.utils.setProperty(data, "flags.pf2e.origin", {
    actor: origin.actorUuid,
    item: origin.itemUuid,
    token: origin.tokenUuid ?? null
  });
  foundry.utils.setProperty(data, "flags.player-action-ui-hub.autoApplied", true);
  return data;
}
__name(buildMarkEffect, "buildMarkEffect");
async function applyMark(target, effectSource, origin) {
  const targetName = String(target?.name ?? "?");
  try {
    if (!target?.canUserModify?.(globalThis.game?.user, "update")) {
      return { applied: false, targetName, reason: "You don't have permission to modify that creature \u2014 the GM has to apply it." };
    }
    const slug = String(effectSource?.system?.slug ?? effectSource?.name ?? "");
    const \u65E7 = (target.itemTypes?.effect ?? []).filter((e) => (e?.slug === slug || e?.name === effectSource?.name) && e?.flags?.["player-action-ui-hub"]?.autoApplied && e?.flags?.pf2e?.origin?.actor === origin.actorUuid);
    if (\u65E7.length) await target.deleteEmbeddedDocuments("Item", \u65E7.map((e) => e.id));
    await target.createEmbeddedDocuments("Item", [buildMarkEffect(effectSource, origin)]);
    return { applied: true, targetName, reason: null };
  } catch (err) {
    console.error("player-action-ui-hub | applyMark \u5931\u8D25", err);
    return { applied: false, targetName, reason: "Something went wrong \u2014 see the console." };
  }
}
__name(applyMark, "applyMark");
async function clearMarks(tokens, effectName, actorUuid, exceptActorId) {
  let n = 0;
  for (const t of tokens) {
    const a = t?.actor;
    if (!a || a.id === exceptActorId) continue;
    if (!a.canUserModify?.(globalThis.game?.user, "update")) continue;
    const \u65E7 = (a.itemTypes?.effect ?? []).filter((e) => e?.name === effectName && e?.flags?.["player-action-ui-hub"]?.autoApplied && e?.flags?.pf2e?.origin?.actor === actorUuid);
    if (!\u65E7.length) continue;
    await a.deleteEmbeddedDocuments("Item", \u65E7.map((e) => e.id));
    n += \u65E7.length;
  }
  return n;
}
__name(clearMarks, "clearMarks");

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
function macroFor(slug) {
  if (!slug) return null;
  return MACROS.find((m) => m.slug === slug) ?? null;
}
__name(macroFor, "macroFor");
function macroForItem(item) {
  if (!item) return null;
  const \u6309slug = macroFor(item.slug ?? null);
  if (\u6309slug) return \u6309slug;
  const traits = item.traits ?? [];
  return MACROS.find((m) => m.trait && traits.includes(m.trait)) ?? null;
}
__name(macroForItem, "macroForItem");
var TARGET_PREFIX = "tgt:";
function targetOptions(actor, side = "any", multi = false, includeSelf = false) {
  try {
    const \u753B\u5E03 = canvas;
    const \u5168\u90E8 = \u753B\u5E03?.tokens?.placeables ?? [];
    const \u6211 = \u5168\u90E8.find((t) => t?.actor?.id === actor?.id);
    const \u6709\u7F51\u683C = Number(\u753B\u5E03?.scene?.grid?.type ?? 0) > 0;
    const \u5DF2\u9009 = game?.user?.targets ?? /* @__PURE__ */ new Set();
    return \u5168\u90E8.filter((t) => t?.actor && t.isVisible !== false && (includeSelf || t.actor.id !== actor?.id)).filter((t) => {
      if (side === "any") return true;
      const \u654C = actor?.isEnemyOf?.(t.actor) === true;
      return side === "enemies" ? \u654C : !\u654C;
    }).map((t) => {
      const d = \u6709\u7F51\u683C && \u6211?.distanceTo ? Math.round(\u6211.distanceTo(t)) : null;
      const \u654C = actor?.isEnemyOf?.(t.actor) === true;
      return {
        id: `${TARGET_PREFIX}${t.id}`,
        label: String(t.name ?? "?"),
        img: t.document?.texture?.src ?? void 0,
        cost: null,
        /*
         * ★★ **敌我要进毂**（Nous 2026-08-08 实测报的："还可以电疗友军"）。
         *   目标格有 token 图 ⇒ 扇区上只画图标、不画字，于是这一格**长得都一样** ——
         *   谁是敌谁是友完全看不出来，误选一个友军的代价是一发法术。
         * ⛔ 原来这份信息写在 `detail` 里，而说明区 2026-08-08 整块拿掉之后
         *   `detail` **根本不画** —— 信息还在数据里，屏幕上却没有。
         *   ★ 那是最难发现的一种坏法：写的人以为给了，用的人从没见过。
         * ⚠ 距离只在算得准（有网格）时给；敌我一律给 —— 那是规则判断，无网格也成立。
         */
        hubNotes: [[\u654C ? "\u2694 Enemy" : "\u271A Ally", d !== null ? `${d} ft` : null].filter(Boolean).join("  \xB7  ")],
        // ★ 已经选中的标出来 —— 多数时候玩家早就选好了，一眼确认比重选快
        badge: \u5DF2\u9009.has(t) ? "\u25CE" : void 0,
        state: "normal"
      };
    }).concat(multi ? [\u5B8C\u6210\u683C()] : []);
  } catch (err) {
    console.error("player-action-ui-hub | targetOptions \u5931\u8D25", err);
    return [];
  }
}
__name(targetOptions, "targetOptions");
function \u5B8C\u6210\u683C() {
  const n = targetCount();
  return {
    id: TARGET_DONE,
    label: "Done",
    cost: null,
    detail: n === 1 ? "1 target selected" : `${n} targets selected`,
    badge: n > 0 ? String(n) : void 0,
    state: n > 0 ? "normal" : "gated",
    reason: n > 0 ? void 0 : "Pick at least one target first."
  };
}
__name(\u5B8C\u6210\u683C, "\u5B8C\u6210\u683C");
var TARGET_DONE = `${TARGET_PREFIX}__done`;
function applyTargetPick(sectorId, multi = false) {
  if (!sectorId.startsWith(TARGET_PREFIX) || sectorId === TARGET_DONE) return false;
  const id = sectorId.slice(TARGET_PREFIX.length);
  const t = (canvas?.tokens?.placeables ?? []).find((x) => x?.id === id);
  if (!t) return false;
  if (!multi) {
    t.setTarget(true, { releaseOthers: true });
    return true;
  }
  const \u5DF2\u9009 = (game?.user?.targets ?? /* @__PURE__ */ new Set()).has(t);
  t.setTarget(!\u5DF2\u9009, { releaseOthers: false });
  return true;
}
__name(applyTargetPick, "applyTargetPick");
function targetCount() {
  return (game?.user?.targets ?? /* @__PURE__ */ new Set()).size ?? 0;
}
__name(targetCount, "targetCount");
function spellstrikeSpells(actor) {
  const out = [];
  for (const entry of actor?.spellcasting?.contents ?? []) {
    if (!entry?.statistic) continue;
    for (const spell of entry.spells?.contents ?? []) {
      const time = String(spell?.system?.time?.value ?? "");
      if (time !== "1" && time !== "2") continue;
      const \u8981\u653B\u51FB = spell?.isAttack === true;
      const \u8981\u8C41\u514D = !!spell?.system?.defense?.save?.statistic;
      if (!\u8981\u653B\u51FB && !\u8981\u8C41\u514D) continue;
      out.push({ entry, spell, id: `ss:${entry.id}:${spell.id}` });
    }
  }
  return out;
}
__name(spellstrikeSpells, "spellstrikeSpells");
function meleeStrikes(actor) {
  return strikesOf(actor).map((s, i) => ({ strike: s, id: strikeSectorId(s, i) })).filter((x) => x.strike?.item?.isMelee === true);
}
__name(meleeStrikes, "meleeStrikes");
var DEGREE = ["criticalFailure", "failure", "success", "criticalSuccess"];
var SPELLSTRIKE = {
  slug: "spellstrike",
  // 规则：Spellstrike 算作两次攻击。它自己只掷一次武器攻击，所以补一次
  extraAttacks: 1,
  name: "Spellstrike",
  steps: [
    {
      /*
       * ★ **先问打谁**（Nous 2026-08-05："轮盘 ui 应该会询问玩家要用那个"）。
       *   在这之前 Spellstrike 依赖玩家事先手动选好目标 —— 没选就读不出成功度，
       *   等于把一步隐含要求留在轮盘外面。
       * ⚠ 已经选中的那个带 ◎ 记号：多数时候玩家早就选好了，一眼确认比重选快。
       */
      title: /* @__PURE__ */ __name(() => "Spellstrike \xB7 Target", "title"),
      options: /* @__PURE__ */ __name((actor) => targetOptions(actor, "enemies"), "options")
    },
    {
      title: /* @__PURE__ */ __name(() => "Spellstrike \xB7 Spell", "title"),
      options: /* @__PURE__ */ __name((actor) => spellstrikeSpells(actor).map(({ spell, id }) => ({
        id,
        label: spell.name,
        img: spell.img,
        cost: String(spell?.system?.time?.value ?? "1"),
        // 让玩家一眼看出这条走哪个分支 —— 两条分支的结算完全不同
        detail: spell.isAttack ? "Uses the Strike's roll" : `Target saves (${spell?.system?.defense?.save?.statistic})`,
        state: "normal"
      })), "options")
    },
    {
      title: /* @__PURE__ */ __name(() => "Spellstrike \xB7 Strike", "title"),
      options: /* @__PURE__ */ __name((actor) => meleeStrikes(actor).map(({ strike, id }) => ({
        id,
        label: String(strike.label ?? "?"),
        img: strike.item?.img,
        cost: null,
        // 消耗记在 Spellstrike 活动上（2 个动作），不是这一击
        state: strike.ready === false ? "gated" : "normal",
        reason: strike.ready === false ? "Not drawn." : void 0,
        variantLabels: (strike.variants ?? []).map((v) => v.label)
      })), "options"),
      // 翻选条放在打击这一步：选的是这一击用第几档
      variantLabels: /* @__PURE__ */ __name((actor) => meleeStrikes(actor)[0]?.strike?.variants?.map((v) => v.label), "variantLabels")
    }
  ],
  async run(actor, ctx, ev) {
    const \u6CD5 = spellstrikeSpells(actor).find((x) => x.id === ctx.picks[1]);
    const \u51FB = meleeStrikes(actor).find((x) => x.id === ctx.picks[2]);
    if (!\u6CD5 || !\u51FB) {
      ui.notifications.warn("That spell or strike is no longer available \u2014 reopen the wheel.");
      return;
    }
    const { rollStrike: rollStrike2, rollStrikeDamage: rollStrikeDamage2 } = await Promise.resolve().then(() => (init_executor(), executor_exports));
    const \u63D0\u793A = [];
    await \u6CD5.entry.cast(\u6CD5.spell, { rank: \u6CD5.spell.rank });
    const idx = Math.max(0, Math.min(ctx.variantIndex, (\u51FB.strike.variants?.length ?? 1) - 1));
    const \u7ED3\u679C = await rollStrike2(actor, ctx.picks[2], idx, ev);
    const degree = DEGREE[\u7ED3\u679C?.degreeOfSuccess ?? -1] ?? null;
    if (!degree) {
      \u63D0\u793A.push("No target was selected, so the Strike's degree of success is unknown \u2014 resolve the spell manually.");
    } else if (degree === "success" || degree === "criticalSuccess") {
      const \u51FA\u4E86 = await rollStrikeDamage2(
        actor,
        ctx.picks[2],
        idx,
        ev,
        degree === "criticalSuccess"
      );
      if (!\u51FA\u4E86) \u63D0\u793A.push("Roll the weapon damage from your sheet \u2014 this strike didn't expose a damage roll.");
    }
    if (!degree) {
    } else if (\u6CD5.spell.isAttack) {
      if (degree === "success" || degree === "criticalSuccess") {
        await rollSpellDamage2(\u6CD5.spell);
        if (degree === "criticalSuccess") {
          \u63D0\u793A.push("Critical hit \u2014 double the spell's damage when applying it.");
        }
      } else {
        \u63D0\u793A.push(degree === "criticalFailure" ? "The Strike critically failed, so the spell has no effect." : "The Strike missed, so the spell has no effect.");
      }
    } else {
      \u63D0\u793A.push(degree === "criticalFailure" ? "The Strike critically failed, so the spell is lost." : "The target rolls its saving throw normally \u2014 the Strike's result does not change it.");
    }
    \u63D0\u793A.push("This counted as two attacks for your multiple attack penalty, applied from now on.");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>Spellstrike</strong> \u2014 ${\u6CD5.spell.name}</p><p>${\u63D0\u793A.join("<br>")}</p>`
    });
  }
};
async function rollSpellDamage2(spell) {
  try {
    const skipDefault = !game.user?.settings?.showCheckDialogs;
    const ev = new PointerEvent("click", { shiftKey: !skipDefault, ctrlKey: false, metaKey: false });
    Object.defineProperty(ev, "target", { value: document.body });
    await spell.rollDamage(ev);
  } catch (err) {
    console.error("player-action-ui-hub | \u63B7\u6CD5\u672F\u4F24\u5BB3\u5931\u8D25", err);
  }
}
__name(rollSpellDamage2, "rollSpellDamage");
var COMMANDER_TACTIC = {
  trait: "tactic",
  name: "Tactic",
  steps: [
    {
      title: /* @__PURE__ */ __name(() => "Signal squadmates", "title"),
      // 盟友，多选 —— 规则允许几个由玩家按规则自己掌握
      options: /* @__PURE__ */ __name((actor) => targetOptions(actor, "allies", true), "options"),
      multiTarget: true
    }
  ],
  async run(actor, ctx) {
    const item = actor?.items?.get?.(ctx.itemId ?? "");
    const \u540D = item?.name ?? "Tactic";
    const ids = String(ctx.picks[0] ?? "").split(",").filter(Boolean);
    const \u540D\u5355 = ids.map((id) => (canvas?.tokens?.placeables ?? []).find((t) => t?.id === id)?.name).filter(Boolean);
    try {
      await game.pf2e.rollItemMacro(item?.uuid);
    } catch {
    }
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><strong>${\u540D}</strong></p>` + (\u540D\u5355.length ? `<p>Signalled: ${\u540D\u5355.join(", ")}.</p><p>Each signalled squadmate acts on their own turn or reaction \u2014 this card is the signal, not their roll.</p>` : `<p>No squadmate was signalled.</p>`)
    });
  }
};
function \u6307\u540D\u4E00\u4E2A\u654C\u4EBA(name) {
  return async (actor, ctx) => {
    const itemId = ctx.itemId;
    const item = itemId ? actor.items?.get(itemId) : null;
    const uuid = linkedEffectUuid(item?.system?.description?.value);
    if (!uuid) {
      ui.notifications.warn(`${name}: this action doesn't link an effect, so there's nothing to apply.`);
      return;
    }
    const \u76EE\u6807token = \u4EE4\u724C(ctx.picks[0]);
    if (!\u76EE\u6807token?.actor) {
      ui.notifications.warn(`${name}: that creature is no longer on the scene.`);
      return;
    }
    const src = await fromUuid(uuid);
    if (!src) {
      ui.notifications.warn(`${name}: the linked effect could not be loaded.`);
      return;
    }
    const \u6211token = canvas?.tokens?.placeables?.find((t) => t?.actor?.id === actor.id);
    const origin = {
      actorUuid: String(actor.uuid),
      itemUuid: String(item?.uuid ?? ""),
      tokenUuid: \u6211token?.document?.uuid ?? null
    };
    await clearMarks(
      canvas?.tokens?.placeables ?? [],
      src.name,
      origin.actorUuid,
      \u76EE\u6807token.actor.id
    );
    const \u7ED3\u679C = await applyMark(\u76EE\u6807token.actor, src.toObject(), origin);
    await \u62A5\u544A(actor, name, \u7ED3\u679C);
  };
}
__name(\u6307\u540D\u4E00\u4E2A\u654C\u4EBA, "\u6307\u540D\u4E00\u4E2A\u654C\u4EBA");
function \u4EE4\u724C(pick) {
  if (!pick?.startsWith(TARGET_PREFIX)) return null;
  const id = pick.slice(TARGET_PREFIX.length);
  return canvas?.tokens?.placeables?.find((t) => t?.id === id) ?? null;
}
__name(\u4EE4\u724C, "\u4EE4\u724C");
async function \u62A5\u544A(actor, name, r) {
  const \u884C = r.applied ? `<p><strong>${name}</strong> \u2014 ${r.targetName} is now marked.</p>` : `<p><strong>${name}</strong> \u2014 could not mark ${r.targetName}: ${r.reason}</p>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: \u884C
  });
}
__name(\u62A5\u544A, "\u62A5\u544A");
var TAUNT = {
  slug: "taunt",
  name: "Taunt",
  steps: [{ title: /* @__PURE__ */ __name(() => "Taunt \xB7 Target", "title"), options: /* @__PURE__ */ __name((actor) => targetOptions(actor, "enemies"), "options") }],
  run: \u6307\u540D\u4E00\u4E2A\u654C\u4EBA("Taunt")
};
var EXPLOIT_VULNERABILITY = {
  slug: "exploit-vulnerability",
  name: "Exploit Vulnerability",
  steps: [{ title: /* @__PURE__ */ __name(() => "Exploit Vulnerability \xB7 Target", "title"), options: /* @__PURE__ */ __name((actor) => targetOptions(actor, "enemies"), "options") }],
  run: \u6307\u540D\u4E00\u4E2A\u654C\u4EBA("Exploit Vulnerability")
};
var MACROS = [FLURRY_OF_BLOWS, SPELLSTRIKE, COMMANDER_TACTIC, TAUNT, EXPLOIT_VULNERABILITY];
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

// src/companions.ts
var HINT_TRAITS = ["eidolon", "minion", "animal", "construct"];
function pickBodies(bodies, currentId) {
  const \u5206 = /* @__PURE__ */ __name((b) => {
    if (b.masterId && b.masterId === currentId) return 0;
    if ((b.traits ?? []).some((t) => HINT_TRAITS.includes(t))) return 1;
    return 2;
  }, "\u5206");
  return bodies.filter((b) => b.ownedByMe && b.hasPlayerOwner === true && b.id !== currentId && specOf({ type: b.type }).usable).sort((a, b) => \u5206(a) - \u5206(b) || a.name.localeCompare(b.name));
}
__name(pickBodies, "pickBodies");
var BODY_PREFIX = "body:";
function readBody(a, sceneTokens, myUserId) {
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
    hasToken: sceneTokens.has(a?.id)
  };
}
__name(readBody, "readBody");
function collectBodies(current) {
  try {
    const currentId = current?.id ?? "";
    const \u573A\u4E0A = new Set(
      (globalThis.canvas?.tokens?.placeables ?? []).map((t) => t?.actor?.id).filter(Boolean)
    );
    const myUserId = String(globalThis.game?.user?.id ?? "");
    const all = (globalThis.game?.actors?.contents ?? []).map((a) => readBody(a, \u573A\u4E0A, myUserId));
    return pickBodies(all, currentId).map((b) => ({
      id: `${BODY_PREFIX}${b.id}`,
      label: b.name,
      img: b.img,
      cost: null,
      // ⚠ 记号说的是"**它在不在场上**"，不是"能不能点" —— 两件事别混
      badge: b.hasToken ? void 0 : "\u25C7",
      detail: b.hasToken ? `Drive ${b.name} with the wheel.` : `${b.name} has no token on this scene \u2014 place one to act with it.`,
      state: "normal"
    }));
  } catch (err) {
    console.error("player-action-ui-hub | collectBodies \u5931\u8D25", err);
    return [];
  }
}
__name(collectBodies, "collectBodies");

// src/conditions.ts
var TURN_HINTS = {
  frightened: "Rules: reduce by 1 at the end of each of your turns.",
  stunned: "Rules: reduce by the number of actions you lose to it."
};
function baseName(name) {
  return String(name).replace(/\s+\d+$/, "");
}
__name(baseName, "baseName");
var CONDITION_PREFIX = "cond:";
function pickConditions(conditions) {
  return conditions.filter((c) => typeof c.value === "number" && c.value > 0).sort((a, b) => {
    const \u524D = /* @__PURE__ */ __name((c) => TURN_HINTS[c.slug] ? 0 : 1, "\u524D");
    return \u524D(a) - \u524D(b) || a.name.localeCompare(b.name);
  });
}
__name(pickConditions, "pickConditions");
function collectConditions(actor) {
  try {
    const list = (actor?.conditions?.active ?? []).map((c) => ({
      slug: String(c?.slug ?? ""),
      name: String(c?.name ?? c?.slug ?? ""),
      img: c?.img,
      value: typeof c?.value === "number" ? c.value : null
    }));
    return pickConditions(list).map((c) => {
      const \u540D = baseName(c.name);
      return {
        id: `${CONDITION_PREFIX}${c.slug}`,
        label: \u540D,
        img: c.img,
        cost: null,
        // 层数直接印在扇区上：它是"不看就得记"的那类信息
        badge: String(c.value),
        detail: TURN_HINTS[c.slug] ? `${TURN_HINTS[c.slug]} Click to reduce to ${(c.value ?? 1) - 1}.` : `Click to reduce ${\u540D} to ${(c.value ?? 1) - 1}.`,
        state: "normal"
      };
    });
  } catch (err) {
    console.error("player-action-ui-hub | collectConditions \u5931\u8D25", err);
    return [];
  }
}
__name(collectConditions, "collectConditions");

// src/reaction-watch.ts
var TRIGGER_PATTERNS = {
  allyDamaged: /(damages?|deals?\s+damage\s+to|harms?)[^.]{0,45}\byour\s+(ally|allies|eidolon|companion|minion)\b|\b(ally|allies|eidolon)\b[^.]{0,70}\btakes?\b[^.]{0,25}damage/i,
  meHit: /(hits?\s+you\b(?!r)|hit\s+(with|by)\s+(a|an)\b|Strikes?\s+you\b(?!r)|Strike\s+(hits|against)\s+you\b(?!r)|targeted\s+by\s+a\s+Strike)/i,
  meDamaged: /(damages?|deals?\s+damage\s+to)\s+you\b(?!r)|\byou\s+(take|takes|would\s+take|are\s+dealt)\b[^.]{0,45}damage|reduced\s+to\s+0\s+Hit\s+Points/i,
  spellCast: /Casts?\s+a\s+Spell|Activates?\s+an\s+Item/i,
  myCheckFailed: /\byou\s+(fail|critically\s+fail)[^.]{0,60}(saving\s+throw|check|save)\b/i,
  myAttackMissed: /\byou\s+(miss|critically\s+fail)[^.]{0,40}(Strike|attack)\b/i,
  foeAttackFailed: /(critically\s+fails?|misses)[^.]{0,60}(Strike|attack)\b/i
};
function kindsForTrigger(trigger) {
  const t = String(trigger ?? "");
  if (!t) return [];
  return Object.keys(TRIGGER_PATTERNS).filter((k) => TRIGGER_PATTERNS[k].test(t));
}
__name(kindsForTrigger, "kindsForTrigger");
function classify(facts, ctx) {
  const \u51FA = [];
  const \u6211\u63B7\u7684 = facts.rollerId != null && facts.rollerId === ctx.meId;
  const \u6253\u6211 = facts.targetId != null && facts.targetId === ctx.meId;
  const \u6253\u76DF\u53CB = facts.targetId != null && facts.targetId !== ctx.meId && ctx.isAlly(facts.targetId);
  const \u547D\u4E2D = facts.outcome === "success" || facts.outcome === "criticalSuccess";
  const \u843D\u7A7A = facts.outcome === "failure" || facts.outcome === "criticalFailure";
  if (facts.type === "attack-roll") {
    if (!\u6211\u63B7\u7684 && \u6253\u6211 && \u547D\u4E2D) \u51FA.push("meHit");
    if (!\u6211\u63B7\u7684 && \u843D\u7A7A) \u51FA.push("foeAttackFailed");
    if (\u6211\u63B7\u7684 && \u843D\u7A7A) \u51FA.push("myAttackMissed");
  }
  if (facts.type === "damage-roll") {
    if (!\u6211\u63B7\u7684 && \u6253\u6211) \u51FA.push("meDamaged", "meHit");
    if (!\u6211\u63B7\u7684 && \u6253\u76DF\u53CB) \u51FA.push("allyDamaged");
  }
  if (facts.type === "spell-cast" && !\u6211\u63B7\u7684) \u51FA.push("spellCast");
  if ((facts.type === "saving-throw" || facts.type === "skill-check") && \u6211\u63B7\u7684 && \u843D\u7A7A) {
    \u51FA.push("myCheckFailed");
  }
  return [...new Set(\u51FA)];
}
__name(classify, "classify");
function matchReactions(reactions, kinds) {
  if (!kinds.length) return [];
  const \u8981 = new Set(kinds);
  return reactions.filter((r) => kindsForTrigger(r.trigger).some((k) => \u8981.has(k)));
}
__name(matchReactions, "matchReactions");

// src/attacks.ts
function readAttack(message) {
  const ctx = message?.flags?.pf2e?.context;
  if (!ctx || ctx.type !== "attack-roll") return null;
  if (ctx.isReroll) return null;
  const actorId = ctx.actor ?? message?.speaker?.actor;
  if (!actorId) return null;
  const n = Number(ctx.mapIncreases);
  return { actorId: String(actorId), mapIncreases: Number.isFinite(n) ? n : 0 };
}
__name(readAttack, "readAttack");
var MAP_TIERS = 3;
function nextMapIndex(count) {
  return Math.min(Math.max(0, Math.floor(count)), MAP_TIERS - 1);
}
__name(nextMapIndex, "nextMapIndex");

// src/self-effect.ts
function selfEffectUuid2(item) {
  const u = item?.system?.selfEffect?.uuid;
  return typeof u === "string" && u ? u : null;
}
__name(selfEffectUuid2, "selfEffectUuid");
function damageTypesOf(spell) {
  const dmg = spell?.system?.damage;
  if (!dmg) return [];
  return Object.values(dmg).map((d) => d?.type ?? d?.damageType ?? null).filter((t) => typeof t === "string" && !!t);
}
__name(damageTypesOf, "damageTypesOf");
function answerChoices(rules, \u5019\u9009) {
  let \u7528\u8FC7 = false;
  return (rules ?? []).map((r) => {
    if (\u7528\u8FC7 || r?.key !== "ChoiceSet" || r?.selection !== void 0) return r;
    const \u9009\u9879 = Array.isArray(r?.choices) ? r.choices.map((c) => String(c?.value ?? c)).filter(Boolean) : [];
    const \u7B54 = \u5019\u9009.find((x) => \u9009\u9879.includes(x));
    if (!\u7B54) return r;
    \u7528\u8FC7 = true;
    return { ...r, selection: \u7B54 };
  });
}
__name(answerChoices, "answerChoices");
function buildSelfEffect(effectSource, origin, traits, \u5019\u9009\u7B54\u6848 = []) {
  const src = foundry.utils.deepClone(effectSource);
  src._id = null;
  src.system = src.system ?? {};
  src.system.rules = answerChoices(src.system.rules ?? [], \u5019\u9009\u7B54\u6848);
  src.system.context = {
    origin: {
      actor: origin.actorUuid,
      token: origin.tokenUuid,
      item: origin.itemUuid,
      spellcasting: null,
      rollOptions: origin.rollOptions
    },
    // 自我效果的目标就是自己 —— 与来源同一个 actor
    target: { actor: origin.actorUuid, token: origin.tokenUuid },
    roll: null
  };
  src.system.traits = { ...src.system.traits ?? {}, value: traits };
  return src;
}
__name(buildSelfEffect, "buildSelfEffect");
function \u6709\u6548\u7279\u6027(traits) {
  const valid = globalThis.CONFIG?.PF2E?.effectTraits ?? {};
  return traits.filter((t) => t in valid);
}
__name(\u6709\u6548\u7279\u6027, "\u6709\u6548\u7279\u6027");
async function applySelfEffect(actor, item, \u5019\u9009\u7B54\u6848 = []) {
  const uuid = selfEffectUuid2(item);
  if (!uuid) return false;
  try {
    const eff = await globalThis.fromUuid(uuid);
    if (!eff?.toObject) return false;
    const a = actor;
    const token = a.getActiveTokens?.(true, true)?.[0] ?? null;
    const \u7279\u6027 = \u6709\u6548\u7279\u6027((item?.system?.traits?.value ?? []).map(String));
    const src = buildSelfEffect(
      eff.toObject(),
      {
        actorUuid: a.uuid,
        tokenUuid: token?.uuid ?? null,
        itemUuid: item.uuid,
        rollOptions: item.getOriginData?.()?.rollOptions ?? []
      },
      \u7279\u6027,
      \u5019\u9009\u7B54\u6848
    );
    await a.createEmbeddedDocuments("Item", [src]);
    return true;
  } catch (err) {
    console.error("player-action-ui-hub | applySelfEffect \u5931\u8D25", err);
    return false;
  }
}
__name(applySelfEffect, "applySelfEffect");

// src/last-spell.ts
var \u88682 = /* @__PURE__ */ new Map();
function noteSpell(actorId, round, types) {
  if (!actorId || !Number.isFinite(round)) return;
  \u88682.set(actorId, { round, types: [...types] });
}
__name(noteSpell, "noteSpell");
function spellTypesThisTurn(actorId, round) {
  if (round === null) return [];
  const r = \u88682.get(actorId);
  return r && r.round === round ? [...r.types] : [];
}
__name(spellTypesThisTurn, "spellTypesThisTurn");
function clearSpells() {
  \u88682.clear();
}
__name(clearSpells, "clearSpells");

// src/refocus.ts
var REFOCUS_UUID = "Compendium.pf2e.actionspf2e.Item.OSefkMgojBLqmRDh";
var REFOCUS_ID = "refocus";
function focusMissing(pool) {
  const max = Number(pool?.max ?? 0);
  if (!Number.isFinite(max) || max <= 0) return 0;
  const val = Number(pool?.value ?? 0);
  return Math.max(0, max - (Number.isFinite(val) ? val : 0));
}
__name(focusMissing, "focusMissing");
function refocusSector(pool, label = { name: "Refocus" }) {
  const \u7F3A = focusMissing(pool);
  if (\u7F3A <= 0) return null;
  return {
    id: REFOCUS_ID,
    label: label.name,
    img: label.img,
    // ⚠ **不画动作记号**：Refocus 是 10 分钟的探索活动，不花遭遇战动作点。
    //   画一个 ◆ 会让它看起来能在战斗轮里点一下就好。
    cost: null,
    state: "normal",
    detail: `10 minutes of exploration. Restores 1 Focus Point (${Number(pool?.value ?? 0)}/${Number(pool?.max ?? 0)} now).`
  };
}
__name(refocusSector, "refocusSector");
function refocusedValue(pool) {
  const max = Number(pool?.max ?? 0);
  const val = Number(pool?.value ?? 0);
  return Math.min(max, (Number.isFinite(val) ? val : 0) + 1);
}
__name(refocusedValue, "refocusedValue");

// src/spellstrike-charge.ts
var MODULE_ID2 = "player-action-ui-hub";
var SPENT_FLAG = "spellstrikeSpent";
var RECHARGE_ID = "recharge-spellstrike";
function spellstrikeItemOf(actor) {
  const items = actor?.items?.contents ?? [];
  const hit = items.find((i) => i?.slug === "spellstrike" && i?.type === "action");
  return hit ? { id: hit.id, uuid: hit.uuid } : null;
}
__name(spellstrikeItemOf, "spellstrikeItemOf");
function isSpent(actor) {
  if (!spellstrikeItemOf(actor)) return false;
  return actor?.getFlag?.(MODULE_ID2, SPENT_FLAG) === true;
}
__name(isSpent, "isSpent");
async function markSpent(actor) {
  if (!spellstrikeItemOf(actor)) return;
  try {
    await actor.setFlag?.(MODULE_ID2, SPENT_FLAG, true);
  } catch (err) {
    console.error("player-action-ui-hub | \u8BB0 Spellstrike \u7528\u6389\u5931\u8D25", err);
  }
}
__name(markSpent, "markSpent");
async function recharge(actor) {
  try {
    await actor.setFlag?.(MODULE_ID2, SPENT_FLAG, false);
  } catch (err) {
    console.error("player-action-ui-hub | Spellstrike \u5145\u80FD\u5931\u8D25", err);
  }
}
__name(recharge, "recharge");
function spentNote(actor) {
  if (!isSpent(actor)) return null;
  return {
    state: "gated",
    /*
     * ⚠ 这句话**只说事实，不说来源**（Nous 2026-08-07 拍板去掉那半句
     *   "Tracked by this module — pf2e records nothing here."）。
     *
     * ★ 与上一轮那个错误的分界要说清楚，别下次又把它加回来：
     *   上一轮的病是**编了一个假来源**（"卡上说这条不可用"，而卡从来没说过）。
     *   病根是"说了一个不成立的出处"，不是"没说出处"。
     *   ⇒ **不许编来源**仍然成立；**必须报出处**不成立 ——
     *     玩家要的是"我现在能不能点"，不是我们的实现细节。
     */
    reason: "Used. Recharge it (\u25C6) before the next one."
  };
}
__name(spentNote, "spentNote");
function rechargeSector(actor, img) {
  if (!isSpent(actor)) return null;
  return {
    id: RECHARGE_ID,
    label: "Recharge",
    img,
    // 规则原文："recharge your Spellstrike as a single action, which has the concentrate trait"
    cost: "1",
    state: "normal",
    detail: "Single action, concentrate. Makes Spellstrike available again."
  };
}
__name(rechargeSector, "rechargeSector");

// src/main.ts
init_strike_damage();
init_strikes();
var MODULE_ID3 = "player-action-ui-hub";
var REACTION_PROMPT_SETTING = "reactionPrompts";
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
var \u9009\u76EE\u6807\u5C42 = false;
function \u6E05\u6389\u9884\u9009\u76EE\u6807() {
  if (!\u9009\u76EE\u6807\u5C42) return;
  \u9009\u76EE\u6807\u5C42 = false;
  game.user?.updateTokenTargets?.([]);
}
__name(\u6E05\u6389\u9884\u9009\u76EE\u6807, "\u6E05\u6389\u9884\u9009\u76EE\u6807");
function \u627E\u6253\u51FB(actor, key) {
  const all = (actor?.system?.actions ?? []).filter((x) => x?.type === "strike");
  return all.find((x, i) => strikeSectorId(x, i) === key) ?? null;
}
__name(\u627E\u6253\u51FB, "\u627E\u6253\u51FB");
function costOfReload(strike) {
  const n = Number(strike?.ammunition?.reloadGlyph);
  return Number.isFinite(n) && n > 0 ? String(n) : "1";
}
__name(costOfReload, "costOfReload");
async function \u88C5\u586B(actor, strike, ammoId, cost, ev) {
  const weapon = strike?.item;
  const \u7A7A\u4F4D = Number(strike?.ammunition?.remaining ?? 0);
  const ammo = ammoId ? actor.inventory?.get?.(ammoId) ?? actor.items?.get?.(ammoId) : null;
  let \u88C5\u4E0A\u4E86 = false;
  try {
    if (ammo && \u7A7A\u4F4D > 0 && typeof weapon?.attach === "function") {
      await weapon.attach(ammo, { quantity: 1, stack: true });
      \u88C5\u4E0A\u4E86 = !!weapon.ammo;
      if (!\u88C5\u4E0A\u4E86) {
        ui.notifications.warn(
          `${ammo.name} did not load into ${weapon.name}.`
        );
      }
    } else if (ammo && \u7A7A\u4F4D <= 0) {
      ui.notifications.info(`${weapon?.name ?? "This weapon"} is already loaded.`);
    }
  } catch (err) {
    console.error("player-action-ui-hub | \u88C5\u586B\u5931\u8D25", err);
  }
  const round = currentRound(actor);
  if (round !== null) spend(actor.id, round, costToPoints(cost));
  if (\u88C5\u4E0A\u4E86) {
    const \u53E5 = game.i18n.format("PF2E.Actions.Interact.Reload.Description", {
      actor: (weapon?.actor ?? actor)?.name,
      weapon: weapon?.name,
      ammo: ammo?.name
    });
    if (game.combat) await sendReloadMessage(actor, weapon, ammo);
    else ui.notifications.info(\u53E5);
  } else {
    await useAction(actor, "interact", ev);
  }
  \u56DE\u5230\u6253\u51FB\u5C42(actor);
}
__name(\u88C5\u586B, "\u88C5\u586B");
function \u56DE\u5230\u6253\u51FB\u5C42(actor) {
  if (!openWheel?.rendered) return;
  const lv = buildStrikeLevel(actor);
  if (!lv) {
    openWheel.close();
    return;
  }
  openWheel.rebuild = () => buildStrikeLevel(actor);
  void openWheel.setLevel(lv);
}
__name(\u56DE\u5230\u6253\u51FB\u5C42, "\u56DE\u5230\u6253\u51FB\u5C42");
function \u8865\u8BB0\u989D\u5916\u653B\u51FB(actor, macro) {
  const n = macro.extraAttacks ?? 0;
  if (n <= 0) return;
  const round = currentRound(actor);
  if (round !== null) noteAttack(actor.id, round, n);
}
__name(\u8865\u8BB0\u989D\u5916\u653B\u51FB, "\u8865\u8BB0\u989D\u5916\u653B\u51FB");
async function \u8BB0\u8D26(actor, macro) {
  if (macro.slug === "spellstrike") await markSpent(actor);
}
__name(\u8BB0\u8D26, "\u8BB0\u8D26");
function \u63A8\u8FDB\u7F16\u6392(actor, s, ev) {
  const \u72B6\u6001 = \u6D3B\u8DC3\u7F16\u6392;
  if (!\u72B6\u6001) return;
  if (s.id === "__back") {
    \u72B6\u6001.ctx.picks.pop();
    \u72B6\u6001.step -= 1;
    if (\u72B6\u6001.step < 0) {
      \u6D3B\u8DC3\u7F16\u6392 = null;
      const sectors = \u804C\u4E1A\u5C42\u6761\u76EE(actor);
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
  const \u672C\u6B65 = \u72B6\u6001.macro.steps[\u72B6\u6001.step];
  if (\u672C\u6B65?.multiTarget && s.id !== TARGET_DONE) {
    if (applyTargetPick(s.id, true)) {
      const \u91CD\u753B = levelForStep(actor, \u72B6\u6001.macro, \u72B6\u6001.step, \u72B6\u6001.ctx);
      if (\u91CD\u753B) void openWheel.setLevel(\u91CD\u753B);
    }
    return;
  }
  if (s.id === TARGET_DONE && \u72B6\u6001.ctx.picks.length === \u72B6\u6001.step) {
    \u72B6\u6001.ctx.picks.push([...game?.user?.targets ?? []].map((t) => t.id).join(","));
    \u72B6\u6001.step += 1;
    const \u4E0B = levelForStep(actor, \u72B6\u6001.macro, \u72B6\u6001.step, \u72B6\u6001.ctx);
    if (\u4E0B) {
      void openWheel.setLevel(\u4E0B);
      return;
    }
    const \u8DD12 = \u72B6\u6001.macro.run(actor, \u72B6\u6001.ctx, ev);
    \u8865\u8BB0\u989D\u5916\u653B\u51FB(actor, \u72B6\u6001.macro);
    void \u8BB0\u8D26(actor, \u72B6\u6001.macro);
    \u6D3B\u8DC3\u7F16\u6392 = null;
    void \u8DD12.then(() => openWheel?.close());
    return;
  }
  \u72B6\u6001.ctx.picks.push(s.id);
  applyTargetPick(s.id);
  \u72B6\u6001.step += 1;
  const \u4E0B\u4E00\u5C42 = levelForStep(actor, \u72B6\u6001.macro, \u72B6\u6001.step, \u72B6\u6001.ctx);
  if (\u4E0B\u4E00\u5C42) {
    void openWheel.setLevel(\u4E0B\u4E00\u5C42);
    return;
  }
  const \u8DD1 = \u72B6\u6001.macro.run(actor, \u72B6\u6001.ctx, ev);
  \u8865\u8BB0\u989D\u5916\u653B\u51FB(actor, \u72B6\u6001.macro);
  void \u8BB0\u8D26(actor, \u72B6\u6001.macro);
  \u6D3B\u8DC3\u7F16\u6392 = null;
  void \u8DD1.then(() => openWheel?.close());
}
__name(\u63A8\u8FDB\u7F16\u6392, "\u63A8\u8FDB\u7F16\u6392");
var openWheelActor = null;
var lastOpen = { x: 0, y: 0 };
function buildStrikeLevel(actor) {
  const strikes = collectStrikes(actor);
  if (!strikes.length) return null;
  const sectors = [...strikes, ...collectStrikeAuxiliaries(actor)];
  const labels = strikes[0]?.variantLabels ?? [];
  const round = currentRound(actor);
  const \u8D77\u59CB\u6863 = round === null ? 0 : nextMapIndex(attacksThisTurn(actor.id, round));
  return {
    title: "Strikes",
    canGoBack: true,
    variant: labels.length ? { index: \u8D77\u59CB\u6863, labels } : void 0,
    // 武器多了之后一圈放不下，照动作层那样分页
    // ⚠ 阈值跟着 PAGE_SIZE 走，别再写死一个数 —— 改了一处忘了另一处，
    //    表现是"第 9 把武器凭空消失"，而且不报错
    paging: sectors.length > PAGE_SIZE ? { page: 0 } : void 0,
    sectors
  };
}
__name(buildStrikeLevel, "buildStrikeLevel");
function \u804C\u4E1A\u5C42\u6761\u76EE(actor) {
  const \u6253\u51FB = spellstrikeItemOf(actor);
  const \u6CE8 = spentNote(actor);
  const sectors = collectClassAbilities(actor).map((s) => (
    // Spellstrike 那一格用掉之后灰显 + 说明白是**我们**在记账
    \u6CE8 && \u6253\u51FB && s.id === `class:${\u6253\u51FB.id}` ? { ...s, ...\u6CE8 } : s
  ));
  const \u51FA = [...sectors];
  const \u5145 = rechargeSector(actor, actor?.items?.get?.(\u6253\u51FB?.id ?? "")?.img);
  if (\u5145) \u51FA.push(\u5145);
  const \u7126 = refocusSector(
    actor?.system?.resources?.focus,
    // ⚠ 名字与图标照纲要取，不自己写死一个 —— 换语言、换版本都跟着走
    globalThis.fromUuidSync?.(REFOCUS_UUID) ?? { name: "Refocus" }
  );
  if (\u7126) \u51FA.push(\u7126);
  return \u51FA;
}
__name(\u804C\u4E1A\u5C42\u6761\u76EE, "\u804C\u4E1A\u5C42\u6761\u76EE");
function \u5206\u7C7B\u5C42(actor) {
  const counts = {
    strikes: collectStrikes(actor).length,
    actions: collectActions(actor).length,
    skills: collectSkills(actor).length,
    class: \u804C\u4E1A\u5C42\u6761\u76EE(actor).length,
    spells: collectSpellEntries(actor).length,
    // ★ 反应是**横切镜头**：这里数出来的条目同时还留在职业层/动作层里。
    //   重复是特性不是 bug —— 见 collectors/reactions.ts 顶部。
    reactions: collectReactions(actor).length,
    // G8 · 我控制的其他单位（幻灵/爪牙/魔宠/同伴）。判据是**归属**不是标签。
    bodies: collectBodies(actor).length,
    // G11 · 带层数、可以减一层的条件。pf2e 一条都不自动减（实测）。
    conditions: collectConditions(actor).length,
    /*
     * ★ 卡上的「Free Actions」那一节（Nous 2026-08-07：
     *   "玩家表格上还有 free action，这个要是表格上没有我们就不显示目录"）。
     * ⚠ 与 Bodies / Conditions 同一条规矩：**空的就不画这一格**。
     *   自由动作是少数角色才有的东西（实测 5 级 Magus 一条都没有），
     *   常驻会让绝大多数人多背一个永远灰着的格子。
     */
    free: collectFreeActions(actor).length,
    /*
     * ★ **法术那一格的替补**（Nous 2026-08-07：
     *   "要是这个 class 没有 spell，就看看有没有 activation（卷轴）"）。
     *   卷轴、魔杖、药水、炼金药剂 —— 对没有法术的职业，
     *   "点一下放个效果"这件事就发生在背包里。
     */
    activations: collectActivations(actor).length
  };
  const cat = /* @__PURE__ */ __name((id, label) => ({
    id,
    label,
    // 分类层用单色 SVG，与内容层的彩色贴图区分开 —— 一眼看出这是导航层
    img: CATEGORY_ICONS[id],
    /*
     * ★ 计数移到 detail：印在扇区上会挤（`Actions (25)` 比图标宽得多），
     *   而它是"想知道才看"的参考数，悬停时在毂里给就够了。
     *
     * ⚠ **空的时候只说一句**（Nous 2026-08-07）：原来同时画
     *   "0 available" 和 "Nothing available in this category right now."，
     *   **同一件事说了两遍**，而且第二遍还更长。
     *   零本来就是"没有"，再补一句解释是话多，不是清楚。
     */
    detail: counts[id] > 0 ? `${counts[id]} available` : void 0,
    cost: null,
    state: counts[id] > 0 ? "normal" : "gated",
    reason: counts[id] > 0 ? void 0 : "Nothing here."
  }), "cat");
  return {
    title: actor.name,
    canGoBack: false,
    sectors: [
      /*
       * ★★ **空的分类一律不画**（Nous 2026-08-07：先是 Bodies/Free/Conditions，
       *   然后 "如果都没有，就不要显示 spell 栏了"、"reaction 也是一样的道理"）。
       *
       *   原来是"灰显但仍可点，点了给一句说明"—— 那条守则针对的是
       *   **我们算不准的判断**（够不够近、满不满足要求）。
       *   而"这个角色有没有反应"是**数出来的事实**，零就是零；
       *   摆一个永远点不出东西的格子，只是让每个人都多背一格。
       */
      ...counts.strikes > 0 ? [cat("strikes", "Strikes")] : [],
      ...counts.actions > 0 ? [cat("actions", "Actions")] : [],
      ...counts.skills > 0 ? [cat("skills", "Skills")] : [],
      ...counts.class > 0 ? [cat("class", "Class")] : [],
      /*
       * ★ 法术与激活**各是各的一格**（Nous 2026-08-07：
       *   "有卷轴和魔杖等物品的有的话也开一个"）。
       *
       *   我先做成了"二选一"——有法术就不看背包。那是错的：
       *   法师身上那张卷轴和那根魔杖**照样要点**，
       *   而按二选一的话它们只能回角色卡去找。
       *   ★ 判据回到最简单的那条：**每一格各问各的，非空就画。**
       */
      ...counts.spells > 0 ? [cat("spells", "Spells")] : [],
      ...counts.activations > 0 ? [cat("activations", "Items")] : [],
      ...counts.reactions > 0 ? [cat("reactions", "Reactions")] : [],
      // ★ 卡上有自由动作才出现（见上面 counts.free 那段）
      ...counts.free > 0 ? [cat("free", "Free")] : [],
      /*
       * ★ **只有真有其他身体时才出现这一格**（G8）。
       *   前六格是"我能做什么"，这一格问的是"**谁在做**" —— 不同的轴。
       *   常驻会让绝大多数角色多背一个永远灰着的格子，
       *   而它灰着的时候不传达任何信息（"你没有同伴"没人需要被告知）。
       *
       * ⚠ 于是分类层的**格数会变**。凡是写死"六格"的地方都会漏 ——
       *   e2e 那两条断言已经改成跟着常量走，别再写死回去。
       */
      ...counts.bodies > 0 ? [cat("bodies", "Bodies")] : [],
      /*
       * ★ **有得减才出现**（同 Bodies 那一格的道理）：
       *   身上一个带层数的条件都没有时，这一格灰着也不传达任何信息。
       */
      ...counts.conditions > 0 ? [cat("conditions", "Conditions")] : []
    ]
  };
}
__name(\u5206\u7C7B\u5C42, "\u5206\u7C7B\u5C42");
function openAt(x, y, \u6362\u6210) {
  lastOpen = { x, y };
  const actor = \u6362\u6210 ?? resolveActor();
  if (!actor) {
    ui.notifications.warn("Player Action UI Hub: no character to act with \u2014 select your token first.");
    return;
  }
  void Promise.all([primeSheetActions(actor), primeSpellGroups(actor), primeStrikeDamage(actor)]).then(() => {
    if (!openWheel?.rendered || openWheelActor?.id !== actor.id) return;
    if (openWheel.atRoot) void openWheel.setLevel(\u5206\u7C7B\u5C42(actor));
    else void openWheel.refresh();
  });
  openWheel?.close();
  openWheelActor = actor;
  const level = \u5206\u7C7B\u5C42(actor);
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
        // ⚠ 精简之后绝大多数角色一页就装下了 —— 装得下就**不画**翻页条
        //   （画一条永远两头都灰的翻页条，等于告诉玩家"这里还有别的"，而并没有）
        paging: sectors.length > PAGE_SIZE ? { page: 0 } : void 0,
        sectors
      });
      return;
    }
    if (s.id === "activations") {
      const sectors = collectActivations(actor);
      if (!sectors.length) {
        ui.notifications.info("Nothing in your pack to activate.");
        return;
      }
      openWheel.rebuild = () => {
        const \u65B0 = collectActivations(actor);
        return \u65B0.length ? {
          title: "Items",
          canGoBack: true,
          paging: \u65B0.length > PAGE_SIZE ? { page: 0 } : void 0,
          sectors: \u65B0
        } : null;
      };
      void openWheel.setLevel({
        title: "Items",
        canGoBack: true,
        paging: sectors.length > PAGE_SIZE ? { page: 0 } : void 0,
        sectors
      });
      return;
    }
    if (s.id.startsWith("activate:")) {
      const item = actor.items.get(s.id.slice("activate:".length));
      if (!item) {
        ui.notifications.warn("That item is no longer in your pack \u2014 reopen the wheel.");
        return;
      }
      const round = currentRound(actor);
      if (round !== null) spend(actor.id, round, costToPoints(s.cost));
      const \u8DD1 = typeof item.consume === "function" ? item.consume() : game.pf2e.rollItemMacro(item.uuid);
      void Promise.resolve(\u8DD1).then(() => openWheel?.close());
      return;
    }
    if (s.id === "free") {
      const sectors = collectFreeActions(actor);
      if (!sectors.length) {
        ui.notifications.info("This character has no free actions.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({
        title: "Free Actions",
        canGoBack: true,
        paging: sectors.length > PAGE_SIZE ? { page: 0 } : void 0,
        sectors
      });
      return;
    }
    if (s.id === RECHARGE_ID) {
      const round = currentRound(actor);
      if (round !== null) spend(actor.id, round, costToPoints(s.cost));
      void recharge(actor);
      return;
    }
    if (s.id === REFOCUS_ID) {
      const pool = actor?.system?.resources?.focus;
      void (async () => {
        try {
          const TE = foundry.applications.ux.TextEditor.implementation ?? foundry.applications.ux.TextEditor;
          await ChatMessage.create({
            content: await TE.enrichHTML(`@Embed[${REFOCUS_UUID}]`),
            speaker: ChatMessage.getSpeaker({ actor })
          });
        } catch (err) {
          console.error("player-action-ui-hub | \u8D34 Refocus \u5361\u7247\u5931\u8D25", err);
        }
        await actor.update?.({ "system.resources.focus.value": refocusedValue(pool) });
        openWheel?.close();
      })();
      return;
    }
    if (s.id === SHEET_HINT_ID) {
      void actor.sheet?.render?.(true);
      openWheel?.close();
      return;
    }
    if (s.id === "class") {
      const sectors = \u804C\u4E1A\u5C42\u6761\u76EE(actor);
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
    if (s.id === "reactions") {
      const sectors = collectReactions(actor);
      if (!sectors.length) {
        ui.notifications.info("This character has no reactions.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({
        title: "Reactions",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id === "bodies") {
      const sectors = collectBodies(actor);
      if (!sectors.length) {
        ui.notifications.info("You don't control any other creature.");
        return;
      }
      openWheel.rebuild = void 0;
      void openWheel.setLevel({
        title: "Bodies",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id.startsWith(BODY_PREFIX)) {
      const \u76EE\u6807 = game.actors?.get(s.id.slice(BODY_PREFIX.length));
      if (!\u76EE\u6807) {
        ui.notifications.warn("That creature is no longer available \u2014 reopen the wheel.");
        return;
      }
      openAt(lastOpen.x, lastOpen.y, \u76EE\u6807);
      return;
    }
    if (s.id === "conditions") {
      const sectors = collectConditions(actor);
      if (!sectors.length) {
        ui.notifications.info("Nothing on you has a counter to reduce.");
        return;
      }
      openWheel.rebuild = () => {
        const \u65B0 = collectConditions(actor);
        return \u65B0.length ? { title: "Conditions", canGoBack: true, paging: { page: 0 }, sectors: \u65B0 } : null;
      };
      void openWheel.setLevel({
        title: "Conditions",
        canGoBack: true,
        paging: { page: 0 },
        sectors
      });
      return;
    }
    if (s.id.startsWith(CONDITION_PREFIX)) {
      const slug = s.id.slice(CONDITION_PREFIX.length);
      void actor.decreaseCondition?.(slug);
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
      const \u5EFA\u6CD5\u672F\u5C42 = /* @__PURE__ */ __name(() => {
        const d = collectSpells(actor, entryId);
        if (!d.sectors.length) return null;
        return {
          title: s.label,
          canGoBack: true,
          // ★ 有分组就按环分页（毂里画点阵，当前那一列高亮）；
          //   退化路径没有分组，退回按 PAGE_SIZE 切
          paging: d.groups.length ? { page: 0, groups: d.groups } : d.sectors.length > PAGE_SIZE ? { page: 0 } : void 0,
          sectors: d.sectors,
          // ⚠ `current` 由 wheel-app 按当前页的组标签现算 —— 这里只给列
          ...d.columns.length ? { slots: { columns: d.columns, current: -1 } } : {}
        };
      }, "\u5EFA\u6CD5\u672F\u5C42");
      const level2 = \u5EFA\u6CD5\u672F\u5C42();
      if (!level2) {
        ui.notifications.info("That spellcasting entry has no spells.");
        return;
      }
      openWheel.rebuild = \u5EFA\u6CD5\u672F\u5C42;
      void openWheel.setLevel(level2);
      return;
    }
    if (s.id === "__back") {
      \u6E05\u6389\u9884\u9009\u76EE\u6807();
      openWheel.rebuild = void 0;
      void openWheel.setLevel(level);
      return;
    }
    if (s.id.startsWith("aux:")) {
      const [, ...rest] = s.id.split(":");
      const auxIndex = Number(rest.pop());
      const strikeId = rest.join(":");
      const round = currentRound(actor);
      if (round !== null) spend(actor.id, round, costToPoints(s.cost));
      void execAuxiliary(actor, strikeId, auxIndex);
      return;
    }
    if (s.id.startsWith("reload:")) {
      const strike = \u627E\u6253\u51FB(actor, s.id.slice("reload:".length));
      const \u5019\u9009 = strike?.ammunition?.compatible ?? [];
      if (\u5019\u9009.length > 0) {
        const \u7A7A\u4F4D = Number(strike?.ammunition?.remaining ?? 0);
        openWheel.rebuild = void 0;
        void openWheel.setLevel({
          title: `${s.label.replace(/ · Reload$/, "")} \xB7 Load`,
          canGoBack: true,
          paging: \u5019\u9009.length > PAGE_SIZE ? { page: 0 } : void 0,
          sectors: \u5019\u9009.map((c) => ({
            // ★ 编码走同一对函数，别在这里手拼（见 ammoSectorId 的注释）
            id: ammoSectorId(s.id.slice("reload:".length), String(c.id)),
            // ★ label 直接用系统给的，它自带背包里还有多少（"Arrows (20)"）——
            //   而"还剩几发"正是选装哪一发时要看的数，不用我们再拼一个
            label: String(c.label ?? "?"),
            img: actor.items?.get(c.id)?.img,
            cost: null,
            state: \u7A7A\u4F4D > 0 ? "normal" : "gated",
            reason: \u7A7A\u4F4D > 0 ? void 0 : "Already loaded."
          }))
        });
        return;
      }
      ui.notifications.info(game.i18n.localize("PF2E.Item.Weapon.Reloader.EmptyMessage"));
      void \u88C5\u586B(actor, strike, null, s.cost, ev);
      return;
    }
    if (s.id.startsWith("ammo:")) {
      const \u89E3 = parseAmmoSectorId(s.id);
      if (!\u89E3) return;
      const { strikeKey, ammoId } = \u89E3;
      const strike = \u627E\u6253\u51FB(actor, strikeKey);
      const cost = costOfReload(strike);
      void \u88C5\u586B(actor, strike, ammoId, cost, ev);
      return;
    }
    if (s.id.startsWith("strike:")) {
      if (s.state === "gated") {
        void execAuxiliary(actor, s.id, 0);
      } else {
        const map = openWheel.currentVariantIndex();
        const round = currentRound(actor);
        const \u70B9\u6570 = costToPoints(s.cost);
        if (round !== null) spend(actor.id, round, \u70B9\u6570);
        void rollStrike(actor, s.id, map, ev).then((\u63B7\u4E86) => {
          if (\u63B7\u4E86) {
            openWheel?.close();
            return;
          }
          if (round !== null) refund(actor.id, round, \u70B9\u6570);
          void openWheel?.refresh();
        });
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
    if (s.id.startsWith("class:") || s.id.startsWith("reaction:")) {
      const itemId = s.id.slice(s.id.indexOf(":") + 1);
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
      const macro = macroForItem({ slug: item.slug, traits: item.system?.traits?.value ?? [] });
      if (macro) {
        const \u8D77\u59CB\u4E0A\u4E0B\u6587 = { picks: [], variantIndex: 0, itemId: item.id };
        const \u8D77\u6B65 = levelForStep(actor, macro, 0, \u8D77\u59CB\u4E0A\u4E0B\u6587);
        if (!\u8D77\u6B65) {
          ui.notifications.info("Nothing available to use with that ability right now.");
          return;
        }
        \u6D3B\u8DC3\u7F16\u6392 = { macro, step: 0, ctx: \u8D77\u59CB\u4E0A\u4E0B\u6587 };
        openWheel.rebuild = void 0;
        void openWheel.setLevel(\u8D77\u6B65);
        return;
      }
      const \u5019\u9009\u7B54\u6848 = [...spellTypesThisTurn(actor.id, round), "weapon-damage"];
      void game.pf2e.rollItemMacro(item.uuid).then(() => applySelfEffect(actor, item, \u5019\u9009\u7B54\u6848)).then(() => openWheel?.close());
      return;
    }
    if (s.id.startsWith(TARGET_PREFIX) && s.id !== TARGET_DONE) {
      applyTargetPick(s.id, true);
      void openWheel?.refresh();
      return;
    }
    let \u6295\u5165\u52A8\u4F5C = null;
    if (s.id.startsWith(ACTS_PREFIX)) {
      const \u89E3 = parseActsSectorId(s.id);
      if (!\u89E3) return;
      \u6295\u5165\u52A8\u4F5C = \u89E3.n;
      s = { ...s, id: \u89E3.spellSectorId, cost: String(\u89E3.n) };
    }
    let \u5DF2\u786E\u8BA4\u76EE\u6807 = false;
    if (s.id.startsWith(CAST_PREFIX)) {
      const \u56DE = spellSectorIdOf(s.id);
      if (!\u56DE) return;
      s = { ...s, id: \u56DE };
      \u5DF2\u786E\u8BA4\u76EE\u6807 = true;
      \u9009\u76EE\u6807\u5C42 = false;
    }
    if (s.id.startsWith("spell:")) {
      const [, entryId, spellId, rankStr, slotStr] = s.id.split(":");
      const \u6CD5\u672F = actor.items?.get?.(spellId);
      const \u5DF2\u7528\u6389 = s.state === "gated";
      const \u7C7B\u578B = castKindOf({
        isAttack: \u6CD5\u672F?.isAttack === true,
        saveStatistic: \u6CD5\u672F?.system?.defense?.save?.statistic ?? null,
        timeValue: \u6CD5\u672F?.system?.time?.value ?? null,
        effectApplyTo: effectApplyOf(\u6CD5\u672F)?.applyTo ?? null,
        targeting: targetingOf(\u6CD5\u672F)
      });
      const \u52A8\u4F5C\u8303\u56F4 = !\u5DF2\u7528\u6389 && \u6295\u5165\u52A8\u4F5C === null && \u7C7B\u578B === "multi-action" ? actionRangeOf(\u6CD5\u672F?.system?.time?.value) : null;
      if (\u52A8\u4F5C\u8303\u56F4) {
        openWheel.rebuild = void 0;
        void openWheel.setLevel({
          title: `${String(\u6CD5\u672F?.name ?? "Spell")} \xB7 Actions`,
          canGoBack: true,
          sectors: Array.from(
            { length: \u52A8\u4F5C\u8303\u56F4.max - \u52A8\u4F5C\u8303\u56F4.min + 1 },
            (_, k) => {
              const n = \u52A8\u4F5C\u8303\u56F4.min + k;
              return {
                id: actsSectorId(n, s.id),
                // 环上只放数字，句子在毂里（一格宽放不下一句话）
                label: "\u25C6".repeat(n),
                hubLabel: n === 1 ? "1 action" : `${n} actions`,
                cost: String(n),
                state: "normal",
                tone: "confirm",
                hubNotes: [`Spend ${n} \u2014 ${n} shard${n > 1 ? "s" : ""}`]
              };
            }
          )
        });
        return;
      }
      const \u8303\u56F4buff = \u5DF2\u7528\u6389 || \u5DF2\u786E\u8BA4\u76EE\u6807 || \u7C7B\u578B !== "area-buff" ? null : areaBuffOf(\u6CD5\u672F);
      if (\u8303\u56F4buff) {
        const \u533A = \u6CD5\u672F?.system?.area ?? null;
        const \u6709\u7F51\u683C = Number(canvas?.scene?.grid?.type ?? 0) > 0;
        const \u6A21\u5F0F = areaPickMode(\u533A, \u6709\u7F51\u683C);
        const \u534A\u5F84 = Number(\u533A?.value ?? 0);
        const \u6211 = (canvas?.tokens?.placeables ?? []).find((t) => t?.actor?.id === actor.id);
        game.user?.updateTokenTargets?.([]);
        if (\u6A21\u5F0F === "auto" && \u6211?.distanceTo) {
          const \u4E2D = (canvas?.tokens?.placeables ?? []).filter((t) => {
            if (!t?.actor || t.isVisible === false) return false;
            const \u662F\u6211 = t.actor.id === actor.id;
            if (\u662F\u6211 && \u8303\u56F4buff.side !== "allies") return false;
            const \u654C = actor?.isEnemyOf?.(t.actor) === true;
            if (!\u662F\u6211 && (\u8303\u56F4buff.side === "allies" ? \u654C : !\u654C)) return false;
            return Math.round(\u6211.distanceTo(t)) <= \u534A\u5F84;
          });
          for (const t of \u4E2D) t.setTarget(true, { releaseOthers: false });
        }
        const \u4FA7 = \u8303\u56F4buff.side === "allies" ? "allies" : "enemies";
        const \u5EFA\u8303\u56F4\u5C42 = /* @__PURE__ */ __name(() => ({
          title: `${String(\u6CD5\u672F?.name ?? "Spell")} \xB7 ${\u533A?.label ?? "Area"}`,
          canGoBack: true,
          sectors: [
            /*
             * ★ 增益类**把自己也列进来**：Bless / Anthem 的目标原文是
             *   "you and allies"，而预选按距离算时自己恒为 0 ft、必然入选 ——
             *   名单里不列自己就会出现"界面上看不到、却真被贴上效果"的人。
             * ⚠ 减益类不列自己：Bane 是 "enemies in the area"，自己不该在内。
             */
            ...targetOptions(actor, \u4FA7, true, \u8303\u56F4buff.side === "allies"),
            {
              id: castSectorId(s.id),
              // ⚠ 扇区上只放**一个记号**，句子在毂里（见下面 hubLabel）
              label: "\u21B5",
              hubLabel: "Apply to selected",
              cost: s.cost,
              state: "normal",
              tone: "confirm",
              hubNotes: [
                `${targetCount()} will get the effect`,
                \u6A21\u5F0F === "auto" ? `Auto-picked within ${\u534A\u5F84} ft` : "No grid \u2014 pick them yourself"
              ]
            }
          ]
        }), "\u5EFA\u8303\u56F4\u5C42");
        \u9009\u76EE\u6807\u5C42 = true;
        openWheel.rebuild = \u5EFA\u8303\u56F4\u5C42;
        void openWheel.setLevel(\u5EFA\u8303\u56F4\u5C42());
        return;
      }
      const \u8981\u9009\u76EE\u6807 = !\u5DF2\u7528\u6389 && (\u7C7B\u578B === "attack" || \u7C7B\u578B === "save" || \u7C7B\u578B === "effect");
      if (!\u5DF2\u786E\u8BA4\u76EE\u6807 && \u8981\u9009\u76EE\u6807 && targetingOf(\u6CD5\u672F) === "pick") {
        game.user?.updateTokenTargets?.([]);
        const \u4E0A\u9650 = maxTargetsOf(\u6CD5\u672F?.system?.target?.value);
        const \u5EFA\u76EE\u6807\u5C42 = /* @__PURE__ */ __name(() => ({
          title: `${String(\u6CD5\u672F?.name ?? "Spell")} \xB7 Target`,
          canGoBack: true,
          sectors: [
            ...targetOptions(actor, "any", false),
            {
              /*
               * ⛔ **扇区上一个记号，句子在毂里**（Nous 2026-08-08 实机截图：
               *   "Cast without target" 横着冲出轮盘）。
               *   病因是我给这一格设了 `tone: "link"` —— 而
               *   `.pauih-label.tone-link` 的字号是 **20.5px**，
               *   那是为**画一个 `+` 号**定的（"边盘上面就只放一个蓝色的加号，
               *   本来就没地方放"）。我拿它去写一句 19 个字符的话。
               * ★ 一格宽 46.6 单位：8.5px 的常规标签也只放得下 ~11 个字符，
               *   所以句子**本来就不该上扇区** —— 用 `hubLabel` 放毂里。
               */
              id: castSectorId(s.id),
              label: "\u21B5",
              hubLabel: targetCount() > 0 ? "Cast at selected" : "Cast without target",
              cost: s.cost,
              // ★ 超过上限只**变色提示**，照旧可点（提示不是锁）
              state: \u4E0A\u9650 !== null && targetCount() > \u4E0A\u9650 ? "risky" : "normal",
              tone: "confirm",
              hubNotes: [
                \u4E0A\u9650 !== null ? `${targetCount()} / ${\u4E0A\u9650} targets` : targetCount() === 1 ? "1 target selected" : `${targetCount()} targets selected`,
                \u4E0A\u9650 !== null && targetCount() > \u4E0A\u9650 ? `\u26A0 This spell targets up to ${\u4E0A\u9650}` : ""
              ].filter(Boolean)
            }
          ]
        }), "\u5EFA\u76EE\u6807\u5C42");
        \u9009\u76EE\u6807\u5C42 = true;
        openWheel.rebuild = \u5EFA\u76EE\u6807\u5C42;
        void openWheel.setLevel(\u5EFA\u76EE\u6807\u5C42());
        return;
      }
      const rank = Number(rankStr);
      const slot = Number(slotStr);
      const round = currentRound(actor);
      if (round !== null) {
        if (s.cost === "reaction") spendReaction(actor.id, round);
        else spend(actor.id, round, costToPoints(s.cost));
      }
      const \u5F85\u8D34 = (() => {
        const r = effectApplyOf(\u6CD5\u672F);
        if (!r) return null;
        if (r.applyTo === "self") return r;
        return \u5DF2\u786E\u8BA4\u76EE\u6807 ? r : null;
      })();
      void castSpell(
        actor,
        entryId,
        spellId,
        Number.isFinite(rank) ? rank : void 0,
        Number.isFinite(slot) ? slot : void 0
      ).then(async () => {
        const \u76EE\u6807\u4EEC = [...game.user?.targets ?? []];
        const \u6709\u8C41\u514D = !!\u6CD5\u672F?.system?.defense?.save?.statistic;
        const \u662F\u653B\u51FB = \u6CD5\u672F?.isAttack === true;
        const \u6709\u4F24\u5BB3 = await spellHasDamage(\u6CD5\u672F);
        const \u8BA1\u5212 = planCast({
          targetCount: \u76EE\u6807\u4EEC.length,
          hasSave: \u6709\u8C41\u514D,
          isAttack: \u662F\u653B\u51FB,
          hasDamage: \u6709\u4F24\u5BB3,
          // ★ 只有玩家显式选过动作数才多掷（见 CastPlanInput.damageCount）
          damageCount: \u6295\u5165\u52A8\u4F5C ?? 1,
          hasEffect: !!\u5F85\u8D34
        });
        for (let i = 0; i < \u8BA1\u5212.length; i++) {
          const \u6B65 = \u8BA1\u5212[i];
          const \u7B49 = gapBefore(\u8BA1\u5212, i);
          if (\u7B49 > 0) await new Promise((r) => setTimeout(r, \u7B49));
          if (\u6B65.kind === "cast") continue;
          if (\u6B65.kind === "save") {
            const t = \u76EE\u6807\u4EEC[\u6B65.targetIndex ?? 0];
            if (t) await rollSpellSave(t?.actor ?? t, \u6CD5\u672F, actor);
          } else if (\u6B65.kind === "attack") {
            await rollSpellAttack(\u6CD5\u672F, ev);
          } else if (\u6B65.kind === "damage") {
            await rollSpellDamage(\u6CD5\u672F, ev);
          } else if (\u6B65.kind === "effect" && \u5F85\u8D34) {
            const \u65362 = \u5F85\u8D34.applyTo === "self" ? [actor] : \u76EE\u6807\u4EEC;
            const r = await applyEffectTo(\u65362, \u5F85\u8D34.effectUuid, { actor });
            if (r.total) {
              ui.notifications.info(
                `${String(\u6CD5\u672F?.name ?? "Spell")}: applied to ${r.ok}/${r.total}.`
              );
            }
          }
        }
      }).then(() => openWheel?.close());
      return;
    }
    ui.notifications.info(`"${s.label}" is not implemented yet.`);
  });
  openWheel.economy = () => {
    const round = currentRound(actor);
    if (round === null) return null;
    const cond = turnConditions(actor);
    return {
      remaining: remaining(actor.id, round, cond),
      total: actionsThisTurn(cond),
      notes: cond.notes,
      canUndo: canUndo(actor.id, round),
      reactionsLeft: reactionsLeft(actor.id, round)
    };
  };
  openWheel.classState = () => classStateLines(readClassState(actor));
  openWheel.onClosed = () => \u6E05\u6389\u9884\u9009\u76EE\u6807();
  openWheel.onInfo = (uuid) => {
    void (async () => {
      try {
        const doc = await globalThis.fromUuid(uuid);
        if (doc?.actor && typeof doc.toMessage === "function") {
          await doc.toMessage();
          return;
        }
        const TE = foundry.applications.ux.TextEditor.implementation ?? foundry.applications.ux.TextEditor;
        await ChatMessage.create({
          content: await TE.enrichHTML(`@Embed[${uuid}]`),
          speaker: ChatMessage.getSpeaker({ actor })
        });
      } catch (err) {
        console.error("player-action-ui-hub | \u53D1\u8BF4\u660E\u5230\u804A\u5929\u680F\u5931\u8D25", err);
      }
    })();
  };
  openWheel.onUndo = () => {
    const round = currentRound(actor);
    if (round !== null) undoLast(actor.id, round);
  };
  void openWheel.openAt(x, y);
}
__name(openAt, "openAt");
Hooks.once("init", () => {
  console.log(`${MODULE_ID3} | init`);
  registerUsageSetting();
  game.settings.register(MODULE_ID3, REACTION_PROMPT_SETTING, {
    name: "Offer reactions when something happens",
    hint: "When a roll in chat matches one of your reactions' trigger text, pop the wheel with just those reactions. It never judges distance or line of sight \u2014 you do.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.keybindings.register(MODULE_ID3, "openWheel", {
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
  const mod = game.modules.get(MODULE_ID3);
  console.log(
    `%c${MODULE_ID3} | ready | v${mod?.version ?? "?"}`,
    "color:#c9a959;font-weight:bold"
  );
  void primeActionUuids();
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
      classStateLines,
      collectStrikeAuxiliaries,
      collectClassAbilities,
      className,
      collectActions,
      triggerOf,
      requirementOf,
      targetOptions,
      applyTargetPick,
      TARGET_DONE,
      macroForItem,
      collectReactions,
      collectBodies,
      readAttack,
      nextMapIndex,
      attacksThisTurn,
      noteAttack,
      collectConditions,
      restrictionFor,
      restrictionStateOf,
      \u63D0\u793A\u53CD\u5E94,
      classify,
      matchReactions,
      primeSheetActions,
      sheetActionsOf,
      resourceLines,
      primeSpellGroups,
      spellGroupsOf,
      slotMatrix,
      collectSpells
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
      clearSheetActions();
      clearSpellGroups();
      clearStrikeDamage();
      if (!openWheel?.rendered || !openWheelActor) return;
      const changed = doc?.documentName === "Actor" ? doc : doc?.actor ?? doc?.parent;
      if (!changed?.id || changed.id !== openWheelActor.id) return;
      void Promise.all([primeSpellGroups(openWheelActor), primeStrikeDamage(openWheelActor)]).then(() => openWheel?.refresh());
    });
  }
  Hooks.on("createChatMessage", (message) => {
    try {
      const origin = message?.flags?.pf2e?.origin;
      if (origin?.type !== "spell" || typeof origin?.uuid !== "string") return;
      const spell = globalThis.fromUuidSync?.(origin.uuid);
      const actorId = message?.speaker?.actor;
      const round = currentRound(game.actors?.get(actorId) ?? null);
      if (!actorId || round === null) return;
      noteSpell(String(actorId), round, damageTypesOf(spell));
    } catch (err) {
      console.error("player-action-ui-hub | \u8BB0\u6CD5\u672F\u4F24\u5BB3\u7C7B\u578B\u5931\u8D25", err);
    }
  });
  Hooks.on("createChatMessage", (message) => {
    const \u89C2\u6D4B = readAttack(message);
    if (!\u89C2\u6D4B) return;
    const actor = game.actors?.get(\u89C2\u6D4B.actorId);
    const round = currentRound(actor ?? null);
    if (round === null) return;
    noteAttack(\u89C2\u6D4B.actorId, round);
    if (openWheel?.rendered && openWheelActor?.id === \u89C2\u6D4B.actorId) void openWheel.refresh();
  });
  Hooks.on("pf2e.startTurn", (combatant, encounter) => {
    const actorId = combatant?.actor?.id;
    const round = Number(encounter?.round ?? game.combat?.round);
    if (!actorId || !Number.isFinite(round)) return;
    resetTurn(actorId, round);
    if (openWheel?.rendered && openWheelActor?.id === actorId) void openWheel.refresh();
  });
  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled || !openWheel?.rendered) return;
    const \u65B0 = token?.actor;
    if (!\u65B0?.id || \u65B0.id === openWheelActor?.id) return;
    openAt(lastOpen.x, lastOpen.y, \u65B0);
  });
  for (const h of ["combatStart", "deleteCombat"]) {
    Hooks.on(h, () => {
      clearAll();
      clearSpells();
    });
  }
  Hooks.on("createChatMessage", (message) => {
    try {
      \u63D0\u793A\u53CD\u5E94(message);
    } catch (err) {
      console.error("player-action-ui-hub | \u53CD\u5E94\u63D0\u793A\u5931\u8D25", err);
    }
  });
});
function \u63D0\u793A\u53CD\u5E94(message) {
  if (!game.settings.get(MODULE_ID3, REACTION_PROMPT_SETTING)) return;
  if (openWheel?.rendered) return;
  const me = resolveActor();
  if (!me) return;
  const ctx = message?.flags?.pf2e?.context;
  if (!ctx) return;
  const \u76EE\u6807 = \u89E3\u6790\u76EE\u6807(ctx.target);
  const facts = {
    type: ctx.type ?? null,
    rollerId: ctx.actor ?? message?.speaker?.actor ?? null,
    targetId: \u76EE\u6807?.id ?? null,
    outcome: ctx.outcome ?? null
  };
  const \u654C\u6211 = /* @__PURE__ */ __name((actorId) => !!\u76EE\u6807 && actorId === \u76EE\u6807.id && me.isEnemyOf?.(\u76EE\u6807) !== true, "\u654C\u6211");
  const kinds = classify(facts, { meId: me.id, isAlly: \u654C\u6211 });
  if (!kinds.length) return;
  const round = currentRound(me);
  if (round !== null && reactionsLeft(me.id, round) <= 0) return;
  const \u5019\u9009 = matchReactions(
    collectReactions(me).map((s) => ({ ...s, trigger: s.detail ?? null })),
    kinds
  );
  if (!\u5019\u9009.length) return;
  openAt(lastMouse.x, lastMouse.y);
  if (!openWheel) return;
  openWheel.rebuild = void 0;
  void openWheel.setLevel({
    title: "Reaction?",
    canGoBack: true,
    paging: \u5019\u9009.length > PAGE_SIZE ? { page: 0 } : void 0,
    sectors: \u5019\u9009.map(({ trigger, ...s }) => s)
  });
}
__name(\u63D0\u793A\u53CD\u5E94, "\u63D0\u793A\u53CD\u5E94");
function \u89E3\u6790\u76EE\u6807(target) {
  const t = target;
  const uuid = t?.actor ?? t?.token ?? null;
  if (typeof uuid !== "string" || !uuid) return null;
  try {
    const doc = globalThis.fromUuidSync?.(uuid);
    return doc?.actor ?? doc ?? null;
  } catch {
    return null;
  }
}
__name(\u89E3\u6790\u76EE\u6807, "\u89E3\u6790\u76EE\u6807");
//# sourceMappingURL=main.js.map
