# FoundryVTT mods

Foundry Virtual Tabletop (Foundry VTT) modules made by NOUS. Finished mods go
in this folder, one subfolder per mod.

For licensing, see the [LICENSE](../LICENSE) at the repository root:
source-available — you may use and modify it for yourself, but you may not
redistribute, use commercially, or publish derivative works without permission.

## What a Foundry mod looks like

- A module is a single folder whose core is a `module.json` manifest
  (id / title / version / esmodules / styles / compatibility, etc.).
- The code is ES module JavaScript, hooked into the game lifecycle via
  `Hooks.on(...)`.
- Plain JS + HTML + CSS — no build step required.
- To install, drop the module folder into `Data/modules/` in the Foundry user
  data directory.

## Notes on Foundry itself (for developers)

- Foundry VTT ships as an Electron package: an Electron shell wrapping a Node
  server (default port 30000) plus a Chromium client; you can also connect from
  a regular browser.
- The client source is plain `.mjs`, not packed into an asar archive. The
  `client/` `common/` `public/` `templates/` folders under `resources/app/` can
  be read directly, which makes it easy to check how the internal API is
  implemented.

## Mods in this folder

| Mod | System | Status |
|---|---|---|
| [Player Action UI Hub](./player-action-ui-hub/) | Pathfinder 2e | Design stage, v0.0.0 (manifest only, no code yet) |

## Research notes

The [`docs/`](./docs/) folder holds system research that outlives any single mod:

| Document | Contents |
|---|---|
| [PF2e Class Mechanics Overview](./docs/2026-08-04-pf2e-class-mechanics-overview.md) | Full dossier on all 29 classes — how each signature mechanic is actually implemented in the pf2e system, a table of callable infrastructure, and two mis-filed entries found in the system's own packs |
| [PF2e Class Signature Operations Inventory](./docs/2026-08-04-pf2e-class-inventory.md) | The condensed pain-point table and three categories of gaps |
