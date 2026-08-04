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

(to be added)
