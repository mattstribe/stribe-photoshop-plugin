// storage.js
// Handles persistent storage of the user-selected league base folder for the plugin.
// The saved folder name is also used as the league key when looking up Google Sheets URLs.
const fs = require("uxp").storage.localFileSystem;

async function loadSavedBaseFolder() {
  const dataFolder = await fs.getDataFolder();
  try {
    const jsonFile = await dataFolder.getEntry("folder-path.json");
    const jsonData = JSON.parse(await jsonFile.read());
    return await fs.getEntryForPersistentToken(jsonData.folderToken);
  } catch {
    console.log("No saved folder found.");
    return null;
  }
}

async function selectAndSaveBaseFolder() {
  const baseFolder = await fs.getFolder({ prompt: "Select your League Package base folder" });
  const token = await fs.createPersistentToken(baseFolder);
  const dataFolder = await fs.getDataFolder();
  const jsonFile = await dataFolder.createFile("folder-path.json", { overwrite: true });
  await jsonFile.write(JSON.stringify({ folderToken: token }, null, 2));
  console.log("✅ Base folder saved.");
  return baseFolder;
}

async function confirmCsvExistsOrRePrompt(baseFolder) {
  // Local CSVs are no longer required; configuration comes from Google Sheets.
  // We simply confirm that a folder was selected and keep using its name as the league key.
  if (!baseFolder) {
    console.warn("⚠️ No base folder selected.");
    return null;
  }
  console.log("✅ Base folder confirmed (using Google Sheets for CSV data).");
  return baseFolder;
}

async function getBaseFolder() {
  let baseFolder = await loadSavedBaseFolder();
  if (baseFolder) baseFolder = await confirmCsvExistsOrRePrompt(baseFolder);
  return baseFolder;
}

module.exports = {
    loadSavedBaseFolder,
    selectAndSaveBaseFolder,
    confirmCsvExistsOrRePrompt,
    getBaseFolder
};
  