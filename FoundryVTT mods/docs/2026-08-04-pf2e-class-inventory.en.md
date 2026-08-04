# PF2e Class Signature Action Inventory (Upward View)

> Appendix; read together with the [Design Freeze](./2026-08-04-pf2e-action-wheel-design.md).
> Data source: foundryvtt/pf2e @ `v14-dev` (commit d895642, 2026-08-03), all 29 classes read one by one against
> `packs/pf2e/actions/class/`, `packs/pf2e/class-features/`, plus a full-text search of `src/`.
> **Why this document exists**: deriving "what APIs exist" from the system source code alone (the downward view) treats
> "whatever the developers happened to write code for" as what matters. This document supplies the upward view — what a
> class is actually doing at the table each round.
> Direction proposed by Nous, 2026-08-04.

## Conclusion in one sentence

**The entire system contains exactly one class-specific code class** (`src/module/system/action-macros/class/inventor/tamper.ts`),
confirmed independently across three shards. Every other class's "support" comes from generic infrastructure (rule elements, spellcasting entries, the condition system).
Entry count and depth of support are **inversely correlated**: the Commander's 37 tactics cards and the Exemplar's 43 transcendence cards are, on sampling, all blank `rules: []` cards.

## Support level legend

- **★** Has dedicated infrastructure/classes callable from outside
- **◐** Has selfEffect or rule-element automation, but no dedicated API
- **○** Cards only; the rules are entirely up to the player

## Inventory

| Class | Signature action | Support | The real per-round pain point |
|---|---|---|---|
| Alchemist | Quick Alchemy | ★ | The real workflow lives on the character sheet's crafting tab; clicking the action card does nothing |
| Animist | Apparition attunement (spell side) | ○ | Which spells did today's attuned apparitions unlock — requires filtering a subset of spells |
| Barbarian | Rage | ◐ | Entering Rage is easy; what is hard is that actions forbidden while raging give no warning |
| Bard | Courageous Anthem and other composition **spells** | ○ | A fixed opener that re-casts the anthem, but it lives on the spells tab, not the actions tab |
| Champion | Champion's Reaction (1 of 7) | ○ | Timing (the moment an enemy hits an ally) plus computing resistance for the ally |
| Cleric | Heal (**spell**) | ◐→○ | Which of the 1/2/3-action variants, who to heal, who is inside the AoE circle |
| Commander | tactics (37 cards) | ○ | Inherently dual-target (me + ally), while every existing tool is a single-actor list |
| Druid | Untamed Form (**spell**) | ◐ | After transforming, the whole attack/speed/senses package is swapped out; needs a form context switch |
| Exemplar | Shift Immanence + transcendence actions (43 cards) | ◐ | Which ikon currently holds the divine spark → which transcendence is available this round |
| Fighter | **Identity is not an action** (high proficiency + Reactive Strike) | ○ | Whether MAP is currently 0/−5/−10 + Reactive Strike timing |
| Guardian | Taunt | ◐ | The effect card's rules are thick (13 entries) yet are not applied automatically; you have to click the UUID link by hand |
| Gunslinger | Reload + way reload deed | ★ | Reloading is handled by the system; the other half of the deed (hiding, etc.) is handled by no one |
| Inventor | Overdrive | ◐ | Roll the check → look up the matching effect for one of four result tiers and drag it onto yourself |
| Investigator | Devise a Stratagem | ◐ | The automation chain is fully laid out, but the entry points are scattered across three pieces of UI |
| Kineticist | Elemental Blast | ★ | The Blast itself has no pain point; the pain is remembering impulse and element combinations |
| Magus | **Spellstrike** | ○ | Pick a spell → spend the resource → roll the weapon → resolve the spell → remember to recharge, all by hand |
| Monk | **Flurry of Blows** | ○ | Zero code in the system: click Strike twice yourself and remember mentally that the second strike does not take the MAP increment |
| Necromancer | Commanding thralls | ○ | Acting on behalf of another unit, and Strike/Escape have to be tallied into your own MAP manually |
| Oracle | **cursebound condition management** (not an action) | ◐ | Add a stage manually after casting, read the description for that stage's penalty, remember to clear it after combat |
| Psychic | Unleash Psyche + Amp toggle | ◐ | The two toggles sit in two different UIs: the effects bar and the spellcasting panel |
| Ranger | Hunt Prey | ◐ | Who is currently marked, and whether switching targets costs an action to re-mark |
| Rogue | Sneak attack (**off-guard via flanking**) | ★ | The determination is automated; the pain is choosing which free-action debilitation to apply after a hit |
| Runesmith | Trace Rune → Invoke Rune | ○ | **There is no rune data in the system at all** (zero hits for Atryl across the whole repo) |
| Sorcerer | Spontaneous casting + signature heightening | ★/○ | Dozens of spells × heightenable ranks — this is exactly where a list-type HUD shines |
| Summoner | Act Together / manifest eidolon | ○ | **3 actions split across two bodies, sharing one pool** |
| Swashbuckler | panache → finisher | ◐ | Do I have panache right now, should I spend it, how do I earn it back |
| Thaumaturge | Exploit Vulnerability | ○ | Re-run the whole procedure for each new enemy, and there is nowhere to hang "whose vulnerability is open" |
| Witch | Hex focus spells + Cackle sustain | ★/○ | Which hex am I sustaining this round — the system's Sustain does not know what you are sustaining |
| Wizard | Casting + Drain Bonded Item | ★/○ | Drain is a once-per-day resource with no counter and no condition; it is entirely up to memory |

## Three categories of gaps (ordered by feasibility)

### Category A · Stateful resources (broadest reach, highest value)

**Common trait**: not solvable by "one more button"; the question is "what is the current state, and what should be displayed accordingly."
In the system, these states are either just a roll-option sub-option or have no entry to hang on at all.

The list: the Swashbuckler's panache, the Exemplar's divine spark location, the Oracle's cursebound condition, the Ranger's marked target,
whose vulnerability the Thaumaturge has opened, the hex the Witch is sustaining, whether the Wizard has Drained today,
the Necromancer's thrall count, and the current MAP shared by every class.

**No existing tool addresses this category at all** — a list-type HUD can only list items, and these are not items.

### Category B · One action expanding into multiple checks (small implementation footprint, very high payoff)

**Common trait**: the rule-element model inherently cannot express "multiple checks," so the official content leaves all of this blank; it is a capability boundary, not an oversight.

The list: Monk Flurry of Blows (two strikes sharing MAP), Magus Spellstrike (attack + spell fused),
Necromancer commanding thralls (acting on behalf of another unit), Summoner Act Together (two bodies each doing one thing).

**Flurry of Blows has the best cost/benefit ratio**: the implementation footprint is tiny, and the system does not have a single line of related code.

### Category C · Requires selecting a target/ally (structural difficulty)

The list: Commander tactics (dual target, me + ally), Champion's Reaction (cross-actor timing),
Cleric mass healing (who is inside the AoE circle), Guardian Taunt (pick an enemy + clear the previous one).

The difficulty is that the wheel is "my interface," while half of these operations happen on someone else.

## Hard boundaries (explicitly unsupported in the first version, stated honestly here)

1. **Runesmith**: there is no rune dataset in the system, so no tool can solve this. Supporting it would require shipping our own data plus building our own "who has what stuck on them" tracking — outside the scope of the wheel.
2. **Summoner's two-actor shared pool**: the system **has no API that can answer "which actor is this summoner's eidolon"** (`flags.system.eidolon` is only read and written by pack JSON; zero hits in src). The native model is even single-actor (the eidolon is a feat on the summoner's sheet); the two-actor setup is a hook left for the Companion Compendia module, and v14's dual-token support is **not yet implemented** (`token-document/data.ts:10` comment "in the future eidolons"). The first version goes single-actor: display whoever is being controlled.
3. **Repository filing errors**: `actions/class/commander/shift-immanence.json` is in fact an Exemplar action (its traits include `exemplar`). **Any approach that infers class ownership from folder path will hit this** — we read items on the actor, not pack directories, so we sidestep it naturally, but keep it in mind when presetting directories. A second error of the same kind is `actions/class/inventor/pursue-a-lead.json` (in fact an Investigator action).

## Three impacts on the design

1. **The "class abilities" sector cannot be defined as "the set of class actions."** The class identity of the Bard, Cleric, Druid, Sorcerer, Wizard, Witch, and Animist lives in **spells**; that of the Oracle and Exemplar lives in **states**. Under the original definition, players of these classes would open the class sector and find it empty. See the main document for the new definition.
2. **The central hub should be a class state display area, not just an action-point counter** (this is where the Category A gaps land).
3. **High support level ≠ high wheel value**. The Alchemist is ★ tier, but what the wheel gets from Quick Alchemy is a card that does nothing when clicked — the real workflow is on the character sheet's crafting tab. The value criterion is "is the pain point somewhere the wheel can reach," not "did the system provide an API."
