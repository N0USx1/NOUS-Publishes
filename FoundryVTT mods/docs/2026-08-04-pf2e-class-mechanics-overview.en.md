# PF2e Class Mechanics Overview · Full Dossier on All 29 Classes

> **What this is**: For the foundryvtt/pf2e system `v14-dev` branch (commit d895642, 2026-08-03),
> **the real implementation shape of each class's signature operation inside the system**, derived by
> actually reading `packs/pf2e/actions/class/`, `packs/pf2e/class-features/`, and `src/` one by one.
> Merged from three rounds of researcher sharding (A–F / G–P / Q–Z).
>
> **Why this document exists**: Reasoning backwards only from "what APIs the system provides" (downward)
> makes you treat whatever the developers happened to write code for as the important thing.
> This document supplies the "upward" view — what the class is actually doing at the table every round,
> and how much of that the system actually handles. Direction proposed by Nous on 2026-08-04.
>
> **Relationship to the other two documents**: This one = the full factual dossier (a reusable asset);
> [Class Signature Operations Inventory](./2026-08-04-pf2e-class-inventory.md) = the compressed version aimed at wheel design (pain points + three categories of gaps);
> [Design Lock-In](./2026-08-04-pf2e-action-wheel-design.md) = the module design proper.
>
> **Shelf-life reminder**: the pf2e system iterates fast; entries get added and removed.
> This is a 2026-08-04 snapshot — verify against the current version before citing it.

---

## 1. Four System-Level Facts That Sit Above Everything

These four were verified across all 29 classes and matter more than any individual class's details.

**1. The entire system contains exactly one class-specific code class.**
Under `src/module/system/action-macros/class/` there is only one subdirectory, `inventor/` (`tamper.ts`).
Confirmed independently by all three shards. Every other class's "support" comes from generic
infrastructure (rule elements, spellcasting entries, the condition system) — none of it written for
any particular class.

**2. Number of entries is inversely proportional to depth of support.**
Commander has 38 action entries and Exemplar 43 — the two classes with the most entries in the whole
system — and spot checks show they are all `rules: []` pure-text blank cards. Meanwhile Monk and Ranger,
with just 1 action entry each, are the ones whose mechanics are most strained.
**"Where the system wrote code" and "where the player clicks each round" barely overlap.**

**3. Official content is not even self-consistent about how things get triggered.**
Guardian's Taunt effect item has 13 rules and Inventor's Overdrive has 8 — quite complete work —
but **neither action entry has `selfEffect`**; the player must manually click the `@UUID` link in the
description and drag it onto the target. Meanwhile Investigator, Psychic, and Magus stances, and
Kineticist's aura, **all have `selfEffect`** and attach automatically.
Same official content, half automatic, half manual.

**4. The rule element model cannot express "one action expanding into multiple resolutions."**
Monk's Flurry of Blows (two Strikes sharing a MAP), Magus's Spellstrike (attack and spell fused),
Necromancer's Command a Thrall (acting on behalf of another unit), Summoner's Act Together (two bodies
each doing something) — all four are `rules: []` blank cards.
**This is not developer oversight; it is the capability boundary of the RE model.**

---

## 2. Legend

| Mark | Meaning |
|---|---|
| **★** | Has dedicated infrastructure/classes callable from outside (`game.pf2e.*` or a dedicated TS class) |
| **◐** | Has `selfEffect` or rule-element automation, but no dedicated API |
| **○** | Pure card-dealing; the rules are entirely the player's problem |
| `rules: []` | The entry's rules array is empty — clicking it just pops a block of description text and produces no mechanical effect |
| `selfEffect` | Using the action automatically applies the corresponding effect to yourself (PF2e's automation switch) |
| zero hits in src | Full-text search of the mechanic's keyword across all of `src/` returns no runtime code |

---

## 3. The At-a-Glance Table

| Class | Action entries | Signature operation | Support | What type the signature operation is |
|---|---|---|---|---|
| Alchemist | 3 | Quick Alchemy | ★ | Action (the real flow lives on the character sheet's crafting tab) |
| Animist | **0** | Apparition attunement | ○ | **Spell side** |
| Barbarian | 3 | Rage | ◐ | Action |
| Bard | **0** | Courageous Anthem and other compositions | ○ | **Spell** |
| Champion | 7 | Champion's Reaction (1 of 7) | ○ | Reaction |
| Cleric | **0** | Divine Font Heal/Harm | ◐→○ | **Spell** |
| Commander | 38 | Tactic cards | ○ | Action (two targets) |
| Druid | 3 | Untamed Form | ◐ | **Spell** |
| Exemplar | 43 | Shift Immanence + transcendence | ◐ | Action + **condition** |
| Fighter | **0** (1 shared) | High proficiency + Reactive Strike | ○ | **Not an action** |
| Guardian | 2 | Taunt | ◐ | Action |
| Gunslinger | 21 | Reload + way deeds | ★ | Action |
| Inventor | 4 | Overdrive | ◐ | Action |
| Investigator | 5 | Devise a Stratagem | ◐ | Action |
| Kineticist | 5 | Elemental Blast | ★ | Action |
| Magus | 4 | **Spellstrike** | ○ | Action (multiple resolutions) |
| Monk | **1** | **Flurry of Blows** | ○ | Action (multiple resolutions) |
| Necromancer | 3 | Command a Thrall | ○ | Action (multiple resolutions) |
| Oracle | 1 (passive) | **Cursebound condition level management** | ◐ | **Condition** |
| Psychic | 5 | Unleash Psyche + Amp | ◐ | Action + toggle |
| Ranger | **1** | Hunt Prey | ◐ | Action |
| Rogue | 3 | Sneak Attack (via flanking) | ★ | **Passive + positioning** |
| Runesmith | 2 | Trace Rune → Invoke Rune | ○ | Action (**the data doesn't exist**) |
| Sorcerer | **0** | Spontaneous casting + heightening | ★/○ | **Spell** |
| Summoner | 25 | Act Together | ○/◐ | Action (**two actors**) |
| Swashbuckler | 2 | panache → finisher | ◐ | Action + **condition** |
| Thaumaturge | 9 | Exploit Vulnerability | ○ | Action + **condition** |
| Witch | 4 | Hex + Cackle Sustain | ★/○ | **Spell** |
| Wizard | **1** | Casting + Drain Bonded Item | ★/○ | **Spell** + daily resource |

**How to read this table**: the rightmost column is the key one — **for 11 classes the signature
operation is not an "action" at all** (it lives in spells, conditions, or positioning).
Any tool that "scans class action entries" will hand in a blank sheet for those 11 classes.

---

## 4. Per-Class Dossiers (alphabetical by English name)

### Alchemist — ★

- **Action entries** (3): `fire-in-the-hole`, `mutagenic-flashback`, `quick-alchemy`
- **Signature operation**: Quick Alchemy. Rationale: of the other two, one is a reaction and one is a
  once-per-day free action; only this one is a 1-action, `manipulate`-tagged resource conversion
  usable repeatedly each round.
- **Implementation**: `quick-alchemy.json` = `actionType: action`, `actions.value: 1`,
  1 rule `CraftingAbility` (`resource: "versatile-vials"`), no `selfEffect`.
- **System infrastructure**: `src/module/rules/rule-element/crafting-ability.ts` (the RE itself),
  `src/module/actor/character/crafting/ability.ts` + `crafting.ts` (the `CraftingAbility` class,
  `actor.crafting.abilities`), the `quickAlchemy` flag at `data.ts:57`,
  `sheet.ts:497` `hasQuickAlchemy`, `sheet.ts:1064` deducting a vial and calling `craftItem(...)`,
  `special-resource.ts` + `actor.getResource()` (the versatile vials pool).
- **Pain point**: the whole "pick a formula → deduct a vial → generate a temporary item" flow
  **exists only inside the character sheet's crafting tab**.
  The 1-action card an external tool gets hold of does nothing when clicked.
  **This is the textbook counterexample of "★-level support ≠ a tool can help."**

### Animist — ○

- **Action entries**: **no `actions/class/animist/` folder at all**.
  The class features sit flat in `class-features/`: `animist-apparition-spellcasting`, `animistic-practice`,
  `apparition-attunement`, `third-apparition`, `fourth-apparition`.
- **Signature operation**: **not an action** — the daily/on-the-spot apparition attunement, and the
  apparition spells it unlocks. Rationale: `apparition` is a **trait**, not an action, at
  `src/scripts/config/traits.ts:768`; the system contains no "Animist action" entry whatsoever.
- **Implementation**: `apparition-attunement.json` has an empty rules array and no `selfEffect`.
  Searching src for `animist` yields zero hits; `apparition` appears only in the traits tag table.
- **Pain point**: which apparition is attuned today, and which spells that opened up for me —
  this is **a subset of spells filtered by current state**, and list-type tools can only list the full set.

### Barbarian — ◐

- **Action entries** (3): `rage`, `mighty-rage`, `quick-tempered`
- **Signature operation**: Rage. Rationale: the only 1-action active entry of the three (the other two
  are free actions), and the entire content of `class-features/rage.json` is a `GrantItem` pointing at it;
  `instinct.json`, `mighty-rage.json`, etc. all take `self:effect:rage` as a prerequisite.
- **Implementation**: `rage.json` = 1 action, 2 rules (`FlatModifier` +2 Strike damage with a
  `self:effect:rage` predicate; `AdjustModifier` halving it for agile weapons),
  **has `selfEffect`** → `Effect: Rage`.
- **Supporting pieces**: `class-features/mighty-rage.json` (RollOption + AdjustModifier×2),
  `instinct.json` (ChoiceSet + GrantItem + `flags.system.ragingResistance`),
  `feat-effects/effect-rage.json`.
- **src**: zero hits for `barbarian`; `rage` only hits the traits config and a single comment at
  `item/effect/document.ts:81`.
- **Pain point**: entering rage is a one-click affair; what nobody handles is **the behaviors forbidden
  while raging** (concentrate actions, casting) — tools still put unusable things right in front of you.

### Bard — ○

- **Action entries**: **no folder**. Class features: `composition-spells`, `muses`, `polymath`,
  `maestro`, `enigma`, `warrior`, `bard-weapon-expertise`.
- **Signature operation**: **Courageous Anthem and other composition spells** (not actions). Rationale:
  `composition` is a **spell trait**, and the entry entity lives at
  `packs/pf2e/spells/focus/courageous-anthem.json` (1 action, traits include
  `bard/cantrip/composition/concentrate/emotion/mental`); the same directory also has `rallying-anthem`,
  `counter-performance`, `lingering-composition`, `dirge-of-doom`, `fortissimo-composition`.
  **The Bard's "first action every round" is modeled in the system as a casting**, and will never
  appear in any action pack.
- **Implementation**: `courageous-anthem.json` has empty rules and no `selfEffect` (the bonus relies on
  manually applying effect items like `feat-effects/effect-vigorous-anthem.json`); `composition-spells.json`
  also has empty rules. Zero hits in src for `bard`.
- **Pain point**: the fixed opening of "re-cast an anthem + maintain Focus Points," and it hides on the
  spells tab, not the actions tab.

### Champion — ○

- **Action entries** (7): `destructive-vengeance`, `flash-of-grandeur`, `glimpse-of-redemption`,
  `iron-command`, `liberating-step`, `retributive-strike`, `selfish-shield`
- **Signature operation**: the Champion's Reaction family — specifically the one matching the cause you
  chose. Rationale: these 7 files correspond one-to-one with the 7 causes, and **the entire rules content**
  of `class-features/justice.json` and `liberation.json` is a `GrantItem` pointing at the corresponding
  reaction; `champions-reaction.json` itself has empty rules.
- **Implementation**: `retributive-strike.json` = reaction, exactly 1 rule `RollOption` (predicate limited
  to a few feats), no `selfEffect`; `glimpse-of-redemption.json` and `liberating-step.json` have
  **entirely empty rules**.
  Effect items exist but do not attach automatically: `effect-champions-resistance.json`,
  `effect-champions-extra-damage.json`.
  Zero hits in src for `champion` (only the class-name enum at `item/class/values.ts:10` and traits tags).
- **Pain point**: **the moment "an enemy hit my ally" — do I spend the reaction**, and what resistance
  gets applied to the ally afterward. This is a cross-character timing problem, and no "my own interface"
  can catch the trigger moment.

### Cleric — ◐→○

- **Action entries**: **no folder**. Class features: `cleric-spellcasting`, `divine-font`, `doctrine`,
  `anathema-cleric`, `deity-cleric`, `cloistered-cleric`, `warpriest`, and doctrines at each level.
- **Signature operation**: Divine Font Heal/Harm (not an action — extra daily spell slots plus a casting).
  Rationale: the only rule in `divine-font.json` is a `ChoiceSet` with options `heal`/`harm`,
  predicate `deity:primary:font:heal|harm`, writing out `rollOption: "divine-font"`;
  the Cleric **has no 1-action class action entry at all**.
- **Implementation**: `divine-font.json` has 1 rule (a pure ChoiceSet) and no `selfEffect`.
  The only hit in src is the `divineFont` field in `item/deity/sheet.ts` — that is **a data field on the
  deity item**, not a Cleric runtime mechanic. The Heal spell itself lives in `spells/spells/`.
- **Pain point**: **which of Heal's 1-action / 2-action / 3-action variants to pick, who to heal, who is
  inside the burst** — the highest-frequency multi-branch decision in PF2e, and in the system it is just
  a spell card.

### Commander — ○

- **Action entries** (38, including 1 misfiled): `alley-oop`, `bloody-guillotine`, `buckle-cut-blitz`,
  `coordinating-maneuvers`, `corpse-crenellation`, `cry-havoc`, `defensive-retreat`,
  `demoralizing-charge`, `double-team`, `end-it`, `executioners-volley`,
  `for-talmandor-for-freedom`, `gather-to-me`, `insta-ballista`, `mirrored-wall`,
  `mountaineering-training`, `naval-training`, `passage-of-lines`, `pincer-attack`,
  `piranha-assault`, `pop-drop-and-lock`, `protective-screen`, `ready-aim-fire`, `reload`,
  `roaring-charge`, `sanguine-revitalization`, `seek-and-destroy`, `shadows-in-the-moonlight`,
  `shields-up`, ~~`shift-immanence`~~ (**misfiled — actually an Exemplar action**), `slip-and-sizzle`,
  `strike-hard`, `stupefying-raid`, `tactical-takedown`, `take-the-high-ground`,
  `the-bigger-they-are`, `valkyries-charge`, `wait-for-it`
- **Signature operation**: tactic cards (representatives: `strike-hard`, `coordinating-maneuvers`,
  `gather-to-me`). Rationale: `class-features/tactics.json` has 10 rules, all
  `ChoiceSet` (filter = `item:trait:tactic`) + `GrantItem` —
  **the Commander's entire class identity is "pick a hand from the tactics pool and play cards each round."**
- **Implementation**: `strike-hard.json` = 2 actions, traits `[brandish, commander, tactic]`,
  **empty rules**, no `selfEffect`; `coordinating-maneuvers` and `gather-to-me` likewise have empty rules.
  The only things with rules are the distribution layer (`tactics.json`, `expert-tactician.json`) and
  the banner aura (the `Aura` RE in `commanders-banner.json`).
  Zero hits in src for `commander`; searching `tactic` only hits Kingmaker's army system, unrelated to
  the Commander.
- **Pain point**: **which ally this card designates, whether he currently meets the conditions, and who
  gets what after it's played** — a tactic is inherently a two-target "me + one ally" operation, while
  every existing tool is a single-character single-list structure.

### Druid — actions ○ / Untamed Form ◐

- **Action entries** (3): `primal-howl`, `true-shapeshift`, `verdant-rest` —
  **all three have empty rules and no `selfEffect`**, and all are high-level/situational entries.
- **Signature operation**: **not those three** — it's the shapeshifting focus spells
  `spells/focus/untamed-form.json` (2 actions, traits include `polymorph`) and
  `untamed-shift.json` (1 or 2 actions, `morph`), plus the order focus spells.
  Rationale: the rule in `class-features/untamed-order.json` is a `GrantItem` → Untamed Form.
- **Implementation**: both shapeshifting spells themselves also have **empty rules arrays**; but the real
  shapeshifting automation lives in generic REs —
  `src/module/rules/rule-element/battle-form/rule-element.ts` (**558 lines**) + `values.ts`,
  attached to the shapeshift effect item rather than the spell. Zero hits in src for both `druid` and
  `untamed`.
- **Pain point**: shapeshifting **swaps the entire attack/speed/senses package**. The good news is that
  the BattleForm RE really does replace the data on the actor, so following the actor's strike list will
  switch automatically; the bad news is that nobody built an explicit expression for the context
  "I am currently in a shapeshifted form."

### Exemplar — ◐

- **Action entries** (43 + `shift-immanence` misfiled into the Commander folder):
  `a-challenge-for-heroes`, `a-moment-unending`, `arrow-splits-arrow`, `bear-allies-burdens`,
  `blinding-of-the-needle`, `brandish-the-gorgons-gaze`, `break-free`, `break-the-suns-legs`,
  `burn-out-of-time`, `captivating-charm`, `coiling-serpents`, `crash-against-me`,
  `drink-of-my-foes`, `embrace-of-destiny`, `feed-the-masses`, `feral-swing`,
  `fleeting-arc-through-heaven-and-earth`, `flowing-spirit-strike`, `fracture-mountains`,
  `giant-felling-comet`, `heaven-rains-an-ending`, `heavy-is-the-crown`, `liars-hidden-blade`,
  `marathon-dash`, `mark-the-center`, `no-scar-but-this`, `one-moment-till-glory`,
  `only-you-and-i`, `plant-thirty-barbs`, `race-the-skies`, `raise-the-walls`, `reap-the-field`,
  `rejoin-in-flight`, `ringing-challenge`, `sever-four-dragonfly-wings`, `shed-the-mortal-skin`,
  `skirt-the-underworld`, `spasm-of-the-berserker`, `strike-breathe-rend`, `survive-the-wilds`,
  `tangle-in-riddle`, `topple-the-pillar-of-heaven`, `unravel-the-future`
- **Signature operation**: Shift Immanence + some transcendence action. Rationale: the vast majority of
  the 43 actions carry the `transcendence` trait, and a transcendence action's prerequisite is
  "the divine spark is on that ikon right now";
  the first rule in `class-features/divine-spark-and-ikons.json` is a `GrantItem` → Shift Immanence.
- **How "where the divine spark is" gets expressed**: `RollOption { option: "divine-spark", mergeable: true,
  toggleable: true, suboptions: [...] }` (see the 1st rule of `class-features/gleaming-blade.json`).
- **Implementation**: `shift-immanence.json` = 1 action, exactly 1 rule `Note`, no `selfEffect`;
  `one-moment-till-glory` and `embrace-of-destiny` have **empty rules**;
  `flowing-spirit-strike.json` has 5 rules (RollOption with first/subsequent-strike suboptions +
  `disabledIf: not divine-spark:gleaming-blade` + several DamageAlterations).
  The ikons themselves are rules-heavy: `gleaming-blade.json` has **16 rules**.
  `exemplar`, `immanence`, and `divine-spark` **all get zero hits in src**;
  the path `flags.system.exemplar.ikons` is **written entirely by rule elements, with no TS type or
  reading code anywhere**.
- **Pain point**: the three-step judgment **"which ikon holds the divine spark right now → which
  transcendence can I use this round → should I spend 1 action shifting first"** — and that state is
  nothing but a pile of mergeable roll option suboptions in the system,
  **which no list-type tool displays at all**.

### Fighter — ○

- **Action entries**: **no folder**. The only class reaction sits at
  `actions/class/shared/reactive-strike.json` (that shared folder contains **only this one file**;
  it is the multi-class Reactive Strike).
- **Signature operation**: **the identity is not any single action** — the highest weapon proficiency in
  the game + Reactive Strike (formerly Attack of Opportunity) + daily feat selection via Combat Flexibility.
- **Implementation**: `shared/reactive-strike.json` = reaction, **empty traits array**, **empty rules**,
  no `selfEffect`; the only rule in `class-features/reactive-strike.json` is a `GrantItem`;
  `combat-flexibility.json` has an **empty rules array** (daily feat selection is entirely unautomated).
  All the remaining class features are passive numbers. `fighter`, `flexibility`, and `reactive-strike`
  **all get zero hits in src**.
- **Pain point**: every round is Strike ×2–3 plus a MAP judgment; the most annoying parts are
  **whether to spend the Reactive Strike when an enemy moves** (a timing problem) and
  **whether MAP is currently 0/−5/−10** (a status display, and belonging to no class entry at all).

### Guardian — ◐

- **Action entries** (2): `intercept-attack`, `taunt`
- **Signature operation**: Taunt. Rationale: the Guardian's only active 1-action, `category: offensive`,
  and `class-features/taunt.json` hands it out directly via `GrantItem`; Intercept Attack is a triggered
  reaction and doesn't consume turn actions.
- **Implementation**: `taunt.json` = 1 action, **empty rules**, **no `selfEffect`**.
  All the automation lives in `feat-effects/effect-taunt.json`: **13 rules**
  (RollOption×3, FlatModifier×2, Note, AdjustModifier, ItemAlteration×6),
  applying a −1 circumstance penalty to attack rolls / class DC / spell DC.
- **The critical broken link**: **the Taunt action does not apply this effect automatically**.
  In the entire repository there are only two references to `Effect: Taunt` — the effect itself, and one
  `@UUID` link in taunt.json's description text.
  Zero hits in src for `taunt` and `intercept`.
- **Pain point**: every round you must "pick an enemy → click the UUID link in the description → drag the
  effect onto that enemy → manually clear the old target at the start of your next turn (the rules allow
  only one at a time)."

### Gunslinger — ★

- **Action entries** (21): `break-them-down`, `clear-a-path`, `covered-reload`, `drifters-wake`,
  `finish-the-job`, `ghost-shot`, `grim-swagger`, `into-the-fray`, `living-fortification`,
  `one-shot-one-kill`, `pistoleros-retort`, `raconteurs-reload`, `reloading-strike`,
  `siegebreaker`, `spinning-crush`, `spring-the-trap`, `ten-paces`, `thoughtful-reload`,
  `touch-and-go`, `vital-shot`, `wind-them-up`
- **Signature operation**: reloading + each way's reload-flavored deed. **The evidence is hard**: reading
  the GrantItems of all 6 `class-features/way-of-the-*.json` files one by one shows **every way's initial
  deed contains exactly one reload action** (Way of the Drifter → Reloading Strike, Way of the Pistolero →
  Raconteur's Reload, Way of the Sniper → Covered Reload, Way of the Spellshot → Thoughtful Reload,
  Way of the Triggerbrand → Touch and Go / Spring the Trap, Way of the Vanguard → Clear a Path).
  **The system designers encoded "reloading" directly as the class identity.**
- **Implementation**: the action entries themselves are blank cards (`covered-reload.json` has empty rules
  and no `selfEffect`), but the mechanical side has full infrastructure:
  `src/module/item/weapon/apps/weapon-reloader/` (ApplicationV2 + Svelte dialog),
  `sheet.ts:944` registering `handlers["reload"]`,
  `document.ts:1266/1465` populating `ammunition: getAttackAmmo(...)`,
  `helpers.ts:326-345` computing `reloadGlyph`/`requiresReload` (repeating weapons counted as 3 actions).
- **Pain point**: the system handles the reloading step, but **the way deeds themselves are still blank
  cards** — Covered Reload wants "reload + Hide or Take Cover," and the system only deducts your ammo;
  nobody handles the hiding half.

### Inventor — ◐

- **Action entries** (4, including 1 misfiled): `command-a-construct`, `explode`, `overdrive`,
  ~~`pursue-a-lead`~~ (**misfiled — actually an Investigator action**)
- **Signature operation**: Overdrive. Rationale: `class-features/overdrive.json` is a core class feature
  and hands out this card directly via `GrantItem`; it's 1 action, `category: offensive`, and requires a
  Crafting check each combat to apply a damage bonus to yourself — an unambiguous "must do on round one."
- **Implementation**: `overdrive.json` = 1 action, **4 rules, all `Note`** (pasting the four degrees of
  success onto the crafting selector), **no `selfEffect`**. The resulting effect lives in
  `feat-effects/effect-overdrive.json`: **8 rules** (`ChoiceSet` reading
  `parent:context:check:outcome` to infer the degree of success + ActiveEffectLike×2 + FlatModifier×2 +
  RollOption×3) — quite thorough work, **but again you have to add the effect by hand**.
  `explode.json` = 2 actions, empty rules. For `overdrive`, **the only hit in src is a historical data
  migration script**.
- **The one exception**: `src/module/system/action-macros/class/inventor/tamper.ts` is
  **the only class-specific macro in the entire action-macros tree** (the `class/` directory contains
  only the one `inventor/` subdirectory).
  In other words the system did write a dedicated macro for the Inventor — but it wrote Tamper, not
  Overdrive.
- **Pain point**: "roll Crafting → look up which of four degrees → find the matching effect and drag it
  on → remember you can't retry on a failure."
  And the ChoiceSet in the effect item can already read the check result — **all that's missing is a
  caller that attaches it automatically after the roll**.

### Investigator — ◐ (the most complete automation among non-★ classes)

- **Action entries** (5 + `pursue-a-lead` misfiled into the Inventor folder): `clue-in`, `devise-a-stratagem`,
  `expeditious-inspection`, `pointed-question`, `quick-tincture`
- **Signature operation**: Devise a Stratagem. Rationale: 1 action, `category: offensive`, and
  **one of the few offensive actions that ships with `selfEffect`** — every Investigator attack must be
  preceded by this step, or you can't attack with your Intelligence modifier.
- **Implementation**: 2 rules (`RollOption` establishing `target:mark:devise-a-stratagem`;
  `FlatModifier` swapping Intelligence into `strike-attack-roll`),
  **has `selfEffect`** → `Effect: Devise a Stratagem`.
  That effect has **8 rules**: `TokenMark` (marking the target token),
  `RollOption` (attack/skill/defensive suboptions), `AdjustStrike` (adding the fortune trait),
  **`SubstituteRoll` ×2**, FlatModifier×2, AdjustModifier.
- **`SubstituteRoll` is a real rule element**: `src/module/rules/rule-element/substitute-roll.ts`,
  and `src/module/system/check/check.ts:96-137` has full substitution-selection logic consuming it —
  **the system genuinely does implement "a pre-rolled die replacing the actual attack roll"**, it just
  goes through the generic RE channel, with no class-specific API.
  For `investigator` and `devise`, src only has migration scripts.
- **Pain point**: the automation chain is fully laid out, but **the entry points are scattered across
  three places**: the action card, the effect item's toggles, and the attack dialog.

### Kineticist — ★ (the best-supported class mechanic in the whole system)

- **Action entries** (5): `base-kinesis`, `channel-elements`, `elemental-blast`, `extract-element`,
  `pacifying-infusion`
- **Signature operation**: Elemental Blast; runner-up is Channel Elements (the aura you must open with).
- **Implementation**: `src/module/actor/character/elemental-blast.ts` is a **complete class** (600+ lines),
  with `getStatistic("impulse")` and dedicated damage domains
  `["damage","attack-damage","impulse-damage",...]`.
  **Globally exposed**: registered as `game.pf2e.ElementalBlast` at `set-game-pf2e.ts:83`,
  typed at `global.ts:194`. Consumers span the character sheet, the attack popup, chat-card listeners,
  and hotbar macros — **it is the only class mechanic in the system with a macro-level interface**.
- **Call form**: `new game.pf2e.ElementalBlast(actor)` → `.configs` for per-element configuration →
  `.attack({element, damageType, melee, mapIncreases, event})` / `.damage({outcome, ...})`.
  Official hotbar path: `game.pf2e.rollActionMacro({actorUUID, type: "blast", elementTrait})`.
  Precondition check: requires `self:effect:kinetic-aura` to exist, otherwise it throws "No kinetic gate."
- **Channel Elements**: 1 action, **has `selfEffect`** → `Effect: Kinetic Aura`,
  and that effect has 3 rules (ChoiceSet for the aura radius 5/10/…/30 feet + Aura + ActiveEffectLike).
- **Pain point**: the Blast itself has no pain point. What's actually annoying is **infusions and element
  switching** (`pacifying-infusion` is a blank card), plus Channel Elements popping a radius picker every
  single time.

### Magus — ○ (the most impoverished signature mechanic)

- **Action entries** (4): `arcane-cascade`, `double-spellstrike`, `reloading-cascade`, `spellstrike`
- **Signature operation**: Spellstrike; runner-up Arcane Cascade (the stance you must follow a Spellstrike
  with, forming the Magus's two-round cadence).
- **Spellstrike implementation**: `actionType: action`, 2 actions,
  **exactly 1 rule, an `ItemAlteration`** (pasting a "charged" hint line into qualifying spell descriptions),
  **no `selfEffect`**. **It will not pick a spell for you and will not merge the attack and spell resolutions.**
  `double-spellstrike.json` has empty rules.
  **Full-text search of src for `spellstrike` and `arcane-cascade`/`arcaneCascade` yields zero hits.**
- **Arcane Cascade implementation (◐)**: 1 action, `stance` trait, **has `selfEffect`** →
  `Stance: Arcane Cascade`; that stance has **11 rules** (ChoiceSet over 15 damage types +
  AdjustStrike + FlatModifier + DamageAlteration + AdjustModifier×2 + ActiveEffectLike +
  Resistance×3 + TempHP) — thick automation.
- **What it actually is in the data**: two pack entries — the action item
  `packs/pf2e/actions/class/magus/spellstrike.json`,
  and the class feature `packs/pf2e/class-features/magus/spellstrike.json` (a single `GrantItem`).
  All a third party can do is `game.pf2e.rollItemMacro(uuid)` to post the card to chat.
- **Pain point**: "pick a spell → manually deduct the spell slot/Focus Point → roll the weapon attack →
  manually resolve the spell effect → remember to recharge." **Zero lines of dedicated code, and the one
  rule only pastes text.**

### Monk — ○ (a textbook-grade gap)

- **Action entries**: **exactly 1** — `flurry-of-blows.json`
- **Signature operation**: Flurry of Blows. Rationale: the Monk's only class action entry;
  `class-features/flurry-of-blows.json` also makes it a 1-action class feature (two copies of the same name).
- **Implementation**: **both the action and the class feature are 1 action, `rules: []`, no `selfEffect`**.
  src search: `flurry` only hits weapon runes (the `flurrying` rune at `item/physical/runes.ts:1443`)
  and `item/weapon/values.ts:85` — **nothing to do with the Monk**; `monk` only hits trait/class-name enums.
  **There is no code anywhere that produces "two Strikes sharing the same multiple attack penalty."**
- **Pain point**: clicking that card pops a block of text, and then you go click Strike twice yourself in
  the attacks panel, **while remembering in your head that the second Strike doesn't increment MAP**
  (the two Strikes of a flurry count as the same attack action).
  This is the textbook case of "the player does it every round and no tool handles it," and
  **the implementation surface is tiny**.

### Necromancer — ○

- **Action entries** (3): `command-a-thrall`, `consume-thrall`, `inevitable-return`
- **Class features** (in the subfolder `class-features/necromancer/`, 20 of them): blood, bone, epitaph,
  expert-necromancy, fatal-method, flesh, grave-spells, grim-fascination, inevitable-return,
  legendary-necromancy, master-necromancy, mastery-of-life-and-death, mental-wards,
  necromancer-spellcasting, puppeteer, reaper, spirit, undead-lore, undying-resilience,
  unnatural-fortitude
- **Signature operation**: Command a Thrall. Rationale: 1 action, traits include the exclusive `thrall`;
  the description explicitly has a thrall Crawl/Drop Prone/Escape/Interact/Stand/Stride/**Strike**,
  with Escape using your spell attack modifier and **counting toward your multiple attack penalty** —
  the core loop repeated every round.
- **Implementation**: all three entries have **entirely empty rules and no `selfEffect`**.
  In src, `thrall` **only hits the trait tag**, with zero runtime code.
  Thrall differentiation rests entirely on description text: `class-features/necromancer/bone.json` says
  "your thralls gain a +5-foot Speed," with **empty rules, pure text**. The `system.rules` on
  `classes/necromancer.json` itself is also an **empty array**.
- **Pain point**: "count how many thralls are on the field → click Command a Thrall → decide in your head
  what this thrall does → if it's a Strike or Escape, manually track it into your own MAP."
  **The system doesn't even specify whether a thrall is an actor.**

### Oracle — ◐ (the mechanic lives in the condition system, not in actions)

- **Action entries**: **exactly 1** — `nudging-whisper.json`, and it's `passive`.
- **Signature operation**: **this class's identity is not an action** — it's casting revelation spells with
  the `cursebound` trait, thereby accumulating cursebound condition levels (1→2→3→4, worsening each step),
  with the core decision being "is it worth another level of curse this round."
- **Implementation**: `class-features/oracular-curse.json` has exactly 1 rule, an `ItemAlteration` —
  **pasting two blocks of hint text** into the descriptions of every `item:trait:cursebound` feature,
  with predicates reading `self:condition:cursebound:1..4`.
  **It only pastes text; it changes no numbers and adds no levels automatically.**
- **In src, cursebound is a first-class condition**: slug registered at `item/condition/values.ts:8`,
  localized at `scripts/config/index.ts:156`, and a dedicated getter `get cursebound()` at
  `actor/conditions.ts:33-35`. **But** reading the context (comment on line 28: *"Convenience getters for
  active badged conditions, especially for use by @actor resolvables in rule elements"*),
  that getter is **a generic convenience for rule element resolution**, sitting alongside clumsy/doomed
  and so on — **not an Oracle-specific API**.
- **Repository-wide search conclusion**: **nothing anywhere increments the level automatically when a
  cursebound spell is cast**. All 15 files in packs that reference cursebound are description text.
- **Pain point**: "click the spell → manually add a level of the curse in the conditions bar → read the
  description to see what new penalty this level triggers → remember to clear it after combat."
  A list-type tool shows a spell list and **shows nothing at all about "what level am I at now, and what
  does the next one do."**

### Psychic — ◐

- **Action entries** (5): `calculate-threats`, `fade-into-daydreams`, `recall-the-teachings`,
  `restore-the-mind`, `unleash-psyche`
- **Signature operation**: Unleash Psyche (a burst toggle) + Amp (a per-cast decision every time you cast
  a psi cantrip).
- **Implementation**: `unleash-psyche.json` = free action, empty rules, **has `selfEffect`** →
  `Effect: Unleash Psyche` (that effect has 2 rules: a RollOption placed into the spellcasting panel +
  a FlatModifier giving spell damage a `2*@spell.level` status bonus).
  `class-features/psi-cantrips-and-amps.json` has 5 rules: ActiveEffectLike (Focus cap +2),
  **RollOption (`amp-spell`, toggleable, `placement: "spellcasting"` putting it straight into the
  spellcasting panel)**,
  ItemAlteration×3 (applying the `psi-cantrip` tag; when amping, applying `amped` and setting the Focus
  cost to 1).
  **This is the most elegant ◐ on the whole table**: one toggle changes both the tag and the cost.
  In src, `psyche` only hits the trait tag; `amp` only hits migration scripts.
- **Pain point**: Unleash Psyche's duration is yours to count; before each cast you have to remember to
  tick Amp in the spellcasting panel, and getting it wrong wastes the Focus Point.
  **The two toggles sit in two different UI locations: the effects bar and the spellcasting panel.**

### Ranger — ◐

- **Action entries**: **exactly 1** — `hunt-prey.json`
- **Signature operation**: Hunt Prey. Rationale: the only class action entry the system gives the Ranger;
  and all three branches of `class-features/hunters-edge.json` (flurry/precision/outwit) have rules
  predicated on a marked target.
- **Implementation**: 1 action, 3 rules (two `FlatModifier`s giving +2 to Seek/Track, one `RollOption`
  ignoring the range penalty, **all predicated on `target:mark:hunted-prey`**),
  **has `selfEffect`** → `Effect: Hunt Prey`, and that effect has exactly one rule:
  `{"key": "TokenMark", "slug": "hunted-prey"}`.
  TokenMark is a system-level rule element (`src/module/rules/rule-element/token-mark/`)
  that marks the current target token, after which every bonus predicated on `target:mark:hunted-prey`
  applies automatically.
  `hunt-prey`/`hunted-prey` get **zero hits** in src.
  **Incidental finding**: `hunters-edge/flurry.json` uses a real rule element, `MultipleAttackPenalty` —
  **the MAP reduction is automatic** — which proves the system is capable of automating MAP; it just
  never did it for the Monk's flurry.
- **Pain point**: when the target changes you must re-mark, re-marking costs 1 action, and Hunter's Edge
  bonuses only apply to the marked target. A tool can list Hunt Prey, but can't answer
  **"who is marked right now, and should I re-mark."**

### Rogue — ★

- **Action entries** (3): `debilitating-strike`, `inspired-stratagem`, `master-strike`
- **Signature operation**: **none of those three** — it's Sneak Attack + creating off-guard (flanking).
  Rationale: all three entries in the action folder are free actions/reactions with empty rules — they're
  "toppings after the hit"; what defines the Rogue's turn is "how do I get the target off-guard and then Strike."
- **Implementation (unusually, real infrastructure exists)**: `class-features/sneak-attack.json` has 5 rules:
  ActiveEffectLike×2 storing the die count in `flags.system.sneakAttackDamage`,
  RollOption `target:condition:off-guard`, ItemAlteration tagging qualifying weapons with `sneak-attack`,
  and `DamageDice` (category `precision`, predicated on `item:tag:sneak-attack` + off-guard) — **fully automatic**.
  **Flanking has dedicated code**: `actor/helpers.ts:301` (whether off-guard due to flanking),
  `actor/roll-context/base.ts:246-250` (automatically applying the temporary off-guard condition),
  `canvas/token/object.ts` (flanking determination),
  `canvas/token/flanking-highlight/renderer.ts` (**canvas highlighting**).
  The `debilitating-strike` action entry has 0 rules, but the class feature of the same name has **17 rules**
  (GrantItem + RollOption + 15 Notes).
- **Pain point**: "does this hit count as off-guard" is already automated by the system;
  what's left is **which debilitation to pick with that free action after the hit** — an option list that
  pops on every hit.

### Runesmith — ○ (the most total data gap)

- **Action entries** (2): `invoke-rune`, `trace-rune`
- **Signature operation**: the two-step loop of Trace Rune → Invoke Rune. Rationale:
  `class-features/runesmith/runes.json` has exactly two rules, both `GrantItem`, handing out precisely
  those two actions.
- **Implementation**: both actions are 1 action, **`rules: []`**, no `selfEffect`.
- **🔴 Key finding**: **the repository contains no concrete rune entry whatsoever**.
  GitHub code search for `Atryl repo:foundryvtt/pf2e` → **zero hits**;
  `"Etched Rune" OR "Traced Rune"` → **zero hits**.
  `class-features/runesmith/runic-repertoire.json` has 0 rules, and its body is just a table of
  "how many runes you learn per level." In src, `runesmith` appears only in the class roster and trait tags.
- **Pain point**: every round the player is deciding "which rune to trace on whom, and which ones to invoke
  this round," while the system doesn't even have a rune list — **it all runs on handwritten notes**.
  **A list-type tool is structurally unable to help — there are no items to list.**
  Any tool that wants to support this must bring its own rune dataset plus its own tracking of
  "who has what applied."

### Sorcerer — ★ (generic casting) / ○ (bloodline)

- **Action entries**: **no folder**. Class features are flat: `bloodline.json` + 21 `bloodline-*.json` files,
  `bloodline-spells`, `sorcerer-spellcasting`, `sorcerous-potency`, `spell-repertoire`,
  `signature-spells`.
- **Signature operation**: **the identity is not an action** — spontaneous casting + heightening signature
  spells to any rank.
- **Implementation**: the casting infrastructure is complete — `src/module/item/spellcasting-entry/`
  (`collection.ts` / `document.ts` / `item-spellcasting.ts`),
  the focus pool at `actor/character/document.ts:369` (`resources.focus`) and
  `getResource("focus")` at `:1974`. On the data side: `spell-repertoire.json` has 2 rules (ItemAlteration),
  `signature-spells` / `bloodline-spells` have 0 rules, and `sorcerous-potency` has 2 rules.
  In src, `sorcerer` only appears in the class roster, one migration, and trait tags — **no dedicated code**.
- **Pain point**: picking one out of dozens of known spells × each one's available heightening ranks.
  ⚠ **This is precisely the one scenario list-type tools are genuinely good at** (a spellbook is inherently
  a list), and a wheel holds no advantage — unless it's built as "3–5 favorites + a ring of heightening ranks."

### Summoner — ○/◐ (the hardest constraints)

- **Action entries** (25): `act-together`, `beasts-charge`, `draconic-frenzy`, `dragon-breath-eidolon`,
  `drain-life`, `dutiful-retaliation`, `elemental-burst`, `elemental-maelstrom`, `empower-breath`,
  `field-of-roots`, `flowing-engulf`, `furious-strike`, `haunting-visage`, `manifest-eidolon`,
  `primal-roar`, `redistribute`, `seething-frenzy`, `sever-conduit`, `share-senses`,
  `sickening-assault`, `surprising-anatomy`, `swarming-assault`, `tendril-strike`,
  `visions-of-sin`, `whirlwind-maul`
  (of the 25, **16 have 0 rules**; the only ones with automation are dragon-breath-eidolon(8), empower-breath(3),
  furious-strike(3), sickening-assault(3), beasts-charge(2), swarming-assault(2),
  tendril-strike(2), manifest-eidolon(1), share-senses(1))
- **Signature operation**: Act Together (1 action, `tandem`, summoner and eidolon each doing one thing),
  Manifest Eidolon, Share Senses. Rationale: the GrantItems in `class-features/summoner/eidolon.json`
  **hand out only these three** (the latter two additionally carry `predicate: ["class:summoner"]`) —
  the core trio the system itself circled.
- **Implementation**: `act-together.json` = 1 action, `category: interaction`,
  traits `[summoner, tandem]`, **`rules: []`**, no `selfEffect` → **pure card-dealing**.
  `manifest-eidolon.json` = 3 actions, 1 rule (ItemAlteration, merely adding
  `{actor|flags.system.eidolon.tradition}` into traits).
  In src, `tandem` appears in only three places, all trait tags — **there is no code for shared action economy**.

**🔴 How the eidolon actor relationship is organized (three layers; a hard constraint for any tool)**:

1. **The system's native model is a single actor.** `class-features/summoner/eidolon.json` uses
   `ChoiceSet` (filter `item:tag:summoner-eidolon`) + `GrantItem` to install "eidolon type"
   **as a feat on the summoner's own character sheet**. Example: `beast-eidolon.json` is `type: "feat"`,
   and its rules are all ActiveEffectLike — raising Intimidation/Nature proficiency, and overriding
   `flags.system.eidolon.tradition = "primal"`. **It hands out no Strikes.**
   → Under the native model **the eidolon's attacks are simply not in the data**.
2. **The two-actor setup is a compatibility hook left for modules, not something the system built.**
   The comment at `src/module/actor/creature/document.ts:154` reads verbatim:
   *"Accomodate eidolon play with the **Companion Compendia module**"*.
   All the related code is exclusion/allowance keyed on the `eidolon` creature trait:
   - `encounter/document.ts:119-127` — actors with the eidolon trait are **barred from rolling initiative separately**
   - `encounter/combatant.ts:46` — eidolons are skipped when a party is bulk-added to combat
   - `canvas/token/object.ts:260-268` — comment `// Support for Eidolons`:
     when `canGangUp` includes `"eidolon"`, **an eidolon adjacent to its summoner counts as flanking**
     (the enum is at `actor/data/base.ts:150-151`)
   - `actor/base.ts:254-256` (undead/construct eidolons don't count as undead/constructs),
     `actor/sheet/popups/distribute-coins-dialog.ts:47` (excluded from coin splitting)
   - `scene/token-document/data.ts:10` comment *"used for troops and **in the future eidolons**"*
     → **dual-token support is not implemented yet**
3. **There is no actor pointer field from summoner → eidolon.**
   Searching src for `summoner` yields only 4 places (class roster/migration/trait tags);
   **`flags.system.eidolon` gets zero hits in src** — that flag is written only by pack JSON and read only
   by pack JSON.
   The two actors are associated **solely by party actor membership + the player's manual work**.

- **Conclusion**: **the system has no API that can answer "which actor is this summoner's eidolon."**
  Go native single-actor and the eidolon's attacks aren't in the data; go Companion Compendia two-actor
  and the tool has to solve the ownership problem of "two actors sharing one 3-slot action bar and one
  initiative" itself — the system only recognizes eidolons at two points: **initiative exclusion** and **flanking**.
- **Pain point**: 3 actions must be distributed across two bodies, and you must remember it's the same pool.
  **Existing tools are single-actor in perspective and structurally cannot express this.**

### Swashbuckler — ◐

- **Action entries** (2): `confident-finisher`, `opportune-riposte`
- **Signature operation**: the loop of gaining panache → spending it on a finisher.
- **Implementation**: `confident-finisher.json` = 1 action, traits `[finisher]`, 2 rules —
  one **toggleable RollOption with `disabledIf: [{"not": "self:effect:panache"}]`** plus the suboption `confident`,
  and one Note for the failure case. `opportune-riposte.json` = reaction, 3 rules
  (toggleable RollOption + RollOption + AdjustStrike adding the `bravado` trait to melee weapons).
  `class-features/panache.json` has 4 rules (two Notes about whether success/failure grants panache +
  ItemAlteration adding bravado to Tumble Through + RollOption);
  `precise-strike.json` has 3 rules (ActiveEffectLike + FlatModifier + DamageDice).
  The effect itself: `feat-effects/effect-panache.json`.
  In src, `panache`/`finisher` only hit the migration script `922-swashbuckler-finisher-suboptions.ts`
  and trait configuration.
- **Callable generic API**: `actor.toggleRollOption(domain, option, itemId, value, suboption)`.
- **Pain point**: **do I have panache right now, should I spend it this round (spending zeroes it out),
  and remember to earn it back with a bravado skill action**.
  panache is just an effect entry, so a list-type tool can at best show "you have this effect";
  it can't answer "which finishers can I use right now."

### Thaumaturge — ○

- **Action entries** (9): `amulets-abeyance`, `drink-from-the-chalice`, `exploit-vulnerability`,
  `fling-magic`, `glimpse-vulnerability`, `implements-interruption`, `intensify-vulnerability`,
  `mirrors-reflection`, `ring-bell`
- **Signature operation**: Exploit Vulnerability; plus the implement-held toggle of Implement's Empowerment (◐).
- **Implementation**: `exploit-vulnerability.json` = 1 action, `category: null`,
  **`rules: []`**, no `selfEffect`.
  In the same folder, `glimpse-vulnerability`, `intensify-vulnerability`, `mirrors-reflection`,
  `drink-from-the-chalice`, `ring-bell`, and `amulets-abeyance` **also all have 0 rules**;
  only `fling-magic`(3) and `implements-interruption`(1) have any.
  The class feature `class-features/exploit-vulnerability.json` has only a GrantItem,
  and **there isn't even a corresponding effect entry in feat-effects** (only `effect-glimpse-vulnerability`).
  `implements-empowerment.json` has 2 rules: a toggleable RollOption with
  `disabledIf: [{"not": "implement-held"}]` + a FlatModifier to Strike damage,
  valued `@weapon.system.damage.dice * 2`.
  Each implement (`bell.json`/`mirror.json`/`tome.json`) has 4 rules.
  `exploit-vulnerability` gets **zero hits** in src.
- **Pain point**: every new enemy means re-running the whole routine (Recall Knowledge → pick an esoterica →
  remember this monster's weakness value), and the system **has no entry to hang "whose vulnerability is
  currently exploited and what the value is" on**;
  additionally, which implement you're currently holding determines whether the damage doubling applies.
  **Entirely on the player's memory and pen and paper.**

### Witch — ★ (generic) / ○ (hexes)

- **Action entries** (4): `patrons-claim`, `patrons-presence`, `shed-spirit`, `stitching-strike` —
  **all four are 2 actions, empty rules, no `selfEffect`** (patrons-presence carries the `aura` trait);
  they are patron-granted actions, **not the core loop**.
- **Signature operation**: **not an action** — hex focus spells + free Sustain via Cackle + the familiar.
  Rationale: `class-features/hex-spells.json` has 0 rules, `witch-lessons.json` has 0 rules,
  `patron.json` has 2 (ChoiceSet+GrantItem), `familiar-witch.json` has 2.
  Cackle lives at `feats/class/witch/level-1/cackle.json`, with the corresponding spell at
  `spells/focus/cackle.json`.
- **Implementation**: the familiar has a **complete standalone actor type**:
  `src/module/actor/familiar/{document,data,sheet,index}.ts`.
  The focus pool goes through the generic `getResource("focus")`. But the hex itself is ○ —
  `hex-spells.json` has 0 rules, and in src `hex` only hits trait tags.
- **🔴 Sustain is just a shell**: reading `src/module/system/action-macros/specialty-basic/sustain.ts`
  in full shows **nothing but a `SimpleAction` with cost/name/slug/traits**, and it **does not track which
  spell you're sustaining**;
  on the spell side there's only `sustained: boolean` at `item/spell/data.ts:26` and
  a boolean of the same name at `item/effect/data.ts:66`.
- **Pain point**: which hex to Sustain this round + Cackle to Sustain a second one for free,
  while **the system's Sustain action has no idea what you're sustaining**.

### Wizard — ★ (casting) / ○ (Drain Bonded Item)

- **Action entries**: **exactly 1** — `drain-bonded-item.json`: free action,
  `category: interaction`, **`rules: []`**, no `selfEffect`.
- **Signature operation**: casting (prepared spell slots) + Drain Bonded Item (recovering one expended slot).
  Rationale: that's the only class action, and `class-features/arcane-bond.json` has 1 rule
  (a GrantItem, which hands out exactly that action).
- **Implementation**: casting infrastructure ★ (the full `spellcasting-entry` + the preparation UI);
  Drain Bonded Item ○ — `drain-bonded`/`bondedItem`/`drainBonded` get **zero hits** in src.
  `spell-substitution.json` and `staff-nexus.json` both have 0 rules;
  `arcane-school.json`/`arcane-thesis.json` are just ChoiceSet+GrantItem card-dealing.
- **Pain point**: the spell-selection part is already well served by list-type tools. What nobody handles
  is **the once-per-day resource "have I used Drain Bonded Item today"** —
  no counter, no selfEffect, no condition entry of any kind; it's all on your memory.

---

## 5. Appendix A · Cross-Class Generic Infrastructure Inventory (everything callable is here)

None of this was written for any particular class, but it is what a tool can actually call.

| Infrastructure | Location | What it can do |
|---|---|---|
| Strike objects | `actor.system.actions` (CharacterStrike[]) | `.variants[map].roll()`, `.damage()`, `.critical()` |
| Weapon auxiliary actions | `strike.auxiliaryActions` (`actor/character/auxiliary.ts:48`) | `.execute({selection})` — draw/sheathe/change grip/raise shield |
| Reloading | `strike.ammunition` + `item/weapon/apps/weapon-reloader/` | the official v14 reload dialog |
| Elemental Blast | `game.pf2e.ElementalBlast` (`character/elemental-blast.ts`) | `.attack()` / `.damage()` — **the only class-level API** |
| Generic action collection | `game.pf2e.actions` (`set-game-pf2e.ts`) | `.get(slug).use({actors, event})` — about a hundred system actions |
| Card-dealing | `game.pf2e.rollItemMacro(uuid)` (`scripts/macros/hotbar.ts:17-48`) | actions/feats go through `createUseActionMessage`, selfEffect is carried along automatically |
| Statistic checks | `actor.getStatistic(slug)` | `.roll({event})` — skills/Perception/saves |
| Rule toggles | `actor.synthetics.toggles` | `actor.toggleRollOption(domain, option, itemId, value, suboption)` |
| Casting | `actor.spellcasting` + `item/spellcasting-entry/` | `spell.spellcasting.cast(spell, {rank, slotId})` |
| Special resources | `actor.getResource(slug)` (`rules/rule-element/special-resource.ts`) | versatile vials, focus pool, etc. |
| Crafting | `actor.crafting.abilities` (`character/crafting/ability.ts`) | shared by Alchemist/Inventor |
| Familiars | `actor/familiar/`, a complete actor type | Witch/Sorcerer, etc. |
| Target marking | `rules/rule-element/token-mark/` | shared by Ranger's hunted prey and Investigator's Devise a Stratagem |
| Roll substitution | `rules/rule-element/substitute-roll.ts` + `system/check/check.ts:96-137` | the Investigator's pre-rolled die substitution |
| MAP adjustment | the `MultipleAttackPenalty` RE (used by Ranger flurry) | **the system is capable of automating MAP**, it just never gave it to the Monk |
| Battle form | `rules/rule-element/battle-form/rule-element.ts` (558 lines) | Druid shapeshifting etc., replacing the whole attack/speed/senses package |
| Flanking determination | `canvas/token/object.ts` + `flanking-highlight/renderer.ts` | prerequisite for Rogue Sneak Attack, with canvas highlighting |

## 6. Appendix B · Repository Filing Errors (recorded for future reference)

Under the `v14-dev` @ d895642 snapshot, two **action files were found placed in the wrong class folder**:

| File path | Actual owner | Evidence |
|---|---|---|
| `actions/class/commander/shift-immanence.json` | **Exemplar** | `name: "Shift Immanence"`, traits `["divine","exemplar"]`, referenced by the GrantItem in `class-features/divine-spark-and-ikons.json` |
| `actions/class/inventor/pursue-a-lead.json` | **Investigator** | `name: "Pursue a Lead"`, traits include `investigator` |

**⚠ Lesson: any approach that infers class ownership from the pack folder path will step on this.**
The correct approach is to go through trait and GrantItem relationships, or to read the items already on
the actor directly.

## 7. Sources

All relative to `github.com/foundryvtt/pf2e` @ branch `v14-dev`, commit `d895642` (2026-08-03):

- **Action entries**: `packs/pf2e/actions/class/<class>/` (25 actual folders + `shared/`)
- **Class features**: `packs/pf2e/class-features/` (magus / necromancer / summoner / runesmith
  are in subfolder form; the rest are flat)
- **Classes themselves**: `packs/pf2e/classes/`
- **Effect items**: `packs/pf2e/feat-effects/`
- **Focus spells**: `packs/pf2e/spells/focus/`
- **System code**: `src/module/actor/character/` (elemental-blast.ts, auxiliary.ts, crafting/,
  helpers.ts, document.ts, sheet.ts), `src/module/rules/rule-element/`,
  `src/module/system/action-macros/`, `src/module/item/`, `src/module/canvas/token/`,
  `src/scripts/set-game-pf2e.ts`, `src/scripts/config/traits.ts`

**Method**: `gh api` to fetch the full tree (44,658 entries) + pulling each JSON raw to read its fields;
`src/` grepped after landing a blobless sparse clone. Three shards (A–F / G–P / Q–Z) in parallel,
with known overlapping items cross-verified.
