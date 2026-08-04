const MODULE_ID = "player-action-ui-hub";

Hooks.once("init", () => {
    console.log(`${MODULE_ID} | init`);
});

Hooks.once("ready", () => {
    const mod = (game as any).modules.get(MODULE_ID);
    console.log(`%c${MODULE_ID} | ready | v${mod?.version ?? "?"}`,
                "color:#c9a959;font-weight:bold");
});
