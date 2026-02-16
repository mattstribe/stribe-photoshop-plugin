const { storage } = require("uxp");

async function loadTemplate(fileName) {
  const fs = storage.localFileSystem;
  const pluginFolder = await fs.getPluginFolder();
  const file = await pluginFolder.getEntry(fileName);
  return file.read();
}

async function show(rootNode) {
  if (!rootNode) return;

  try {
    const html = await loadTemplate("merch.html");
    rootNode.innerHTML = html;
  } catch (error) {
    rootNode.innerHTML = `
      <div style="padding:12px;color:#f3f3f3;background:#2c2c2c;font-family:Arial,sans-serif;">
        Merch panel failed to load template.
      </div>
    `;
    console.log("Failed to load merch.html:", error);
    return;
  }

  const loadedAt = rootNode.querySelector("#loadedAt");
  if (loadedAt) {
    loadedAt.textContent = `Loaded at ${new Date().toLocaleTimeString()}`;
  }
}

module.exports = { show };
