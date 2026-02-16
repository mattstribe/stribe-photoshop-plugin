try {
  const { entrypoints } = require("uxp");
  const merchPanel = require("./merch.js");

  if (entrypoints && typeof entrypoints.setup === "function") {
    entrypoints.setup({
      panels: {
        vanilla: {
          show() {
            // Weekly panel is already defined by index.html + main.js.
          }
        },
        merch: {
          async show(rootNode) {
            await merchPanel.show(rootNode);
          }
        }
      }
    });
  }
} catch (error) {
  // Keep weekly panel working even if entrypoints setup fails.
  console.log("entrypoints setup error:", error);
}
