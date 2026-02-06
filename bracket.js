const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const exportHandler = require("./exportHandler.js");
const fs = require("uxp").storage.localFileSystem;

// Small delay helper (used when closing previous doc)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Document identifiers for this script
const DOC_ID = 'BRACKET';       // folder + template basename (e.g., STANDINGS/BRACKET.psd)
const DOC_EXPORT = 'Bracket';    // export folder + filename prefix

// Function to handle BRACKET Update
async function handleBracketUpdate(baseFolder, divisionData) {
  const statusEl = document.getElementById("status");

  try {
    // Extract division data passed from standings.js (includes pre-computed folders and logo config)
    const {
      confDiv,
      division,
      divTeams,
      divAbb,
      conf,
      confLocation,
      divColorHex,
      schedule,
      week,
      divs,
      confs,
      teams,
      previousDocId,
      userDiv,
      cloudExportEnabled,
      gamedayFolder,
      templateFolder
    } = divisionData;

    // Template file - try division-specific bracket first, then default bracket
    let templateFile;
    try {
      templateFile = await templateFolder.getEntry(`${divAbb}_${DOC_ID}.psd`);
    } catch {
      templateFile = await templateFolder.getEntry(`${DOC_ID}.psd`);
    }
    
    // Create working files folder if it doesn't exist (BEFORE executeAsModal)
    let workingFolder;
    try { 
      workingFolder = await templateFolder.getEntry('Working Files'); 
    } catch { 
      workingFolder = await templateFolder.createFolder('Working Files'); 
    }

    // Create the save file entry
    const workingFileName = `${divAbb}_${DOC_ID}_working.psd`;
    const saveFile = await workingFolder.createFile(workingFileName, { overwrite: true });

    ///// PHOTOSHOP AUTOMATION /////

    // Show which division is updating
    statusEl.innerHTML = `Updating ${divAbb} Bracket...`;

    let newDocId = null;
    await core.executeAsModal(async () => {
      await app.open(templateFile);

      // If running ALL, close the previous document after opening this one
      if (userDiv === 'ALL' && previousDocId) {
        const prev = app.documents.find(docItem => docItem._id === previousDocId);
        if (prev) { 
          await delay(1000); 
          await prev.close(); 
        }
      }

      //Define document and header
      const doc = app.activeDocument;
      newDocId = doc._id; // Save doc id for return
      // Save As immediately to avoid editing/saving the template
      if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
      
      // Update header (optional - won't fail if layers don't exist)
      try {
        const header = getByName(doc, 'HEADER');
        if (header) {
          const divisionText = getByName(header, 'DIVISION');
          const locationText = getByName(header, 'LOCATION');
          const divisionColorLayer = getByName(header, 'HEADER COLOR');

          if (divisionText) divisionText.textItem.contents = division.toUpperCase();
          if (locationText) locationText.textItem.contents = confLocation.toUpperCase();
          if (divisionColorLayer) await fillColor(divisionColorLayer, divColorHex);
        }
      } catch (err) {
        console.log('Header update failed, continuing with export:', err);
      }

      // TODO: Add bracket-specific logic here (teams, matchups, etc.)

      // Always export PNG to Exports/Week {week}/Bracket (even if no updates made)
      // This allows you to see which divisions triggered the bracket
      const exportFile = await prepareBracketExport(gamedayFolder, week, divAbb);
      const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, exportFile.name);
      await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);

      await doc.save();
    }, { commandName: "Update BRACKET" });

    return newDocId; // Return doc id for closing in standings.js if needed
  } catch (err) {
    statusEl.textContent = "⚠️ Error updating BRACKET";
    console.error("Error:", err);
    throw err;
  }
}

// ===== Helpers =====

function hexToRgb(hex) {
  const h = (hex || '').replace(/^#/, "").trim();
  const r = parseInt(h.slice(0, 2) || '00', 16);
  const g = parseInt(h.slice(2, 4) || '00', 16);
  const b = parseInt(h.slice(4, 6) || '00', 16);
  return { r, g, b };
}

async function fillColor(layer, hex) {
  if (!layer) return;
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay([
    { _obj: "select", _target: [{ _ref: "layer", _id: layer._id }], makeVisible: false, selectionModifier: { _enum: "selectionModifierType", _value: "replaceSelection" }, _isCommand: true }
  ], { synchronousExecution: true });
  await app.batchPlay([
    { _obj: "set", _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: r, green: g, blue: b } } }
  ], { synchronousExecution: true });
}

const getByName = (parent, name) => {
  const layers = parent.layers || parent;
  return layers.find(l => l.name === name);
};

// Ensure folder path under a root FolderEntry; returns the deepest folder
async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (const segment of segments) {
    try { current = await current.getEntry(segment); }
    catch { current = await current.createFolder(segment); }
  }
  return current;
}

// Prepare and return a FileEntry for Bracket PNG export
async function prepareBracketExport(gamedayFolder, week, divAbb) {
  const weekFolderName = `Week ${week}`;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, DOC_EXPORT]);
  const exportFileName = `${divAbb}_${DOC_EXPORT}.png`;
  return await exportFolder.createFile(exportFileName, { overwrite: true });
}

// Export the functions
module.exports = {
  handleBracketUpdate
};

