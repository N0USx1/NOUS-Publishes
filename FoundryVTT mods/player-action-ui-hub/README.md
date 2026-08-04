# Player Action UI Hub

A player-side radial action hub for **Pathfinder 2e** on Foundry VTT.

> **Status: design stage. Version 0.0.0 — manifest only, no code yet.**
> This folder is published early so the research behind it is readable. It is not
> installable in any useful sense until v0.1.

## What it does

Hold Ctrl and click to summon a wheel at your cursor. Drill from a category
(Strikes / Actions / Class / Spells) into the actual entry, click it, and the
module calls the pf2e system's own roll and cast functions. Esc dismisses it.

It serves **players operating their own character**. It is not a GM tool, and it
does not try to replace the character sheet.

## Why a wheel, and why it is not just "faster buttons"

Reading all 29 classes as the pf2e system actually implements them (see `../docs/`),
the thing that stalls a player mid-turn is usually **not** that a button was hard
to find. It is that **nothing shows the state you are in** — whether you have
panache, which ikon your divine spark sits on, how many cursebound levels you are
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
| Build step | none — plain ES modules, HTML and CSS |

## Deliberate limits

Two things this module will **not** attempt, because the system has no data to
stand on (both documented with evidence in `../docs/`):

- **Runesmith** — the pf2e system contains no rune entries at all. Supporting it
  would mean shipping our own rune dataset plus tracking who is marked with what.
- **Summoner across two actors** — there is no API that answers "which actor is
  this summoner's eidolon". The native model keeps the eidolon as a feat on the
  summoner's own sheet. The hub follows whichever actor you control.

## Background reading

- [PF2e Class Mechanics Overview](../docs/2026-08-04-pf2e-class-mechanics-overview.md)
  — full dossier on all 29 classes: implementation shape, callable infrastructure,
  and two mis-filed entries in the system's own packs.
- [PF2e Class Signature Operations Inventory](../docs/2026-08-04-pf2e-class-inventory.md)
  — the condensed pain-point table and the three categories of gaps.

## License

Source-available, personal use only. See the [LICENSE](../../LICENSE) at the
repository root.
