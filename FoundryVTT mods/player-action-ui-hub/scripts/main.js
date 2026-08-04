// src/main.ts
var MODULE_ID = "player-action-ui-hub";
Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});
Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  console.log(
    `%c${MODULE_ID} | ready | v${mod?.version ?? "?"}`,
    "color:#c9a959;font-weight:bold"
  );
});
//# sourceMappingURL=main.js.map
