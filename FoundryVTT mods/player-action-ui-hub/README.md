# Player Action UI Hub

A player-side radial action hub for **Pathfinder 2e** on Foundry VTT.

## Install

In Foundry, go to **Add-on Modules → Install Module** and paste this manifest URL:

```
https://raw.githubusercontent.com/N0USx1/NOUS-Publishes/main/FoundryVTT%20mods/player-action-ui-hub/module.json
```

Then enable it in your world. Updates arrive through the same URL.

## What it does

Hold Ctrl and click on the canvas to summon a wheel at your cursor. Drill from a
category (Strikes / Actions / Class / Spells) into the actual entry, click it, and
the module calls the pf2e system's own roll and cast functions — it does not
re-implement any of the maths. Esc dismisses it.

If Ctrl+click is awkward on your setup (browser or Mac), there is a rebindable
key for the same thing, bound to **R** by default.

Two things it does on its own:

- **Actions you use often move to the front** of the Actions wheel and stay put.
- **Reactions get offered when something happens** — when a roll in chat matches
  one of your reactions' trigger text, the wheel pops with just those reactions.
  It never judges distance or line of sight; you do. This one interrupts other
  people's turns, so it has an off switch in module settings.

It serves **players operating their own character**. It is not a GM tool, and it
does not try to replace the character sheet.

## Why a wheel, and why it is not just "faster buttons"

Reading all 29 classes as the pf2e system actually implements them, the thing
that stalls a player mid-turn is usually **not** that a button was hard to find.
It is that **nothing shows the state you are in** — whether you have panache,
which ikon your divine spark sits on, how many cursebound levels you are
carrying, who your hunted prey is, what your current multiple attack penalty is.

In the system these are either a single roll-option suboption or they have no
entry to hang on at all. **A list-shaped HUD structurally cannot show them**,
because a list can only list items, and these are not items.

The hub of a wheel is, by its geometry, a status display. **That is the real
differentiator here. The circle is only the shell.**

## Requirements

| | |
|---|---|
| Foundry VTT | v14 (verified 14.365) |
| Game system | pf2e 8.0.0+ (verified 8.4.0) |
| To install | nothing else — the release ships the built script |
| To build from source | Node + `npm install`, then `npm run build` (TypeScript via esbuild) |

## Deliberate limits

Two things this module will **not** attempt, because the system has no data to
stand on:

- **Runesmith** — the pf2e system contains no rune entries at all. Supporting it
  would mean shipping our own rune dataset plus tracking who is marked with what.
- **Summoner across two actors** — there is no API that answers "which actor is
  this summoner's eidolon". The native model keeps the eidolon as a feat on the
  summoner's own sheet. The hub follows whichever actor you control.

## Something broken or annoying?

Tell me and I'll fix it — [open an issue](https://github.com/N0USx1/NOUS-Publishes/issues).
Bug reports and "this is awkward to use" are equally welcome; the second kind is
harder to notice from the inside.

---

Do u like stuff i made? Help me go further with Ko-fi!

[![Support me on Ko-fi](https://raw.githubusercontent.com/N0USx1/NOUS-Publishes/main/assets/kofi-support.png)](https://ko-fi.com/nnnous)

## License

Source-available, personal use only. See the [LICENSE](../../LICENSE) at the
repository root.
