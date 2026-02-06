// divPreviews.js - Division Preview automation
const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const imageHandler = require("./imageHandler.js");
const exportHandler = require("./exportHandler.js");
const bracketHandler = require("./bracket.js");
const fs = require("uxp").storage.localFileSystem;

// Small delay helper (used when closing previous doc)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Document identifiers for this script
const DOC_ID = 'DIV-PREVIEWS';       // folder + template basename (e.g., STANDINGS/STANDINGS.psd)
const DOC_EXPORT = 'Div-Preview';    // export folder + filename prefix

async function handleDivPreviewsUpdate(baseFolder) {
  const statusEl = document.getElementById("status");

  // Read cloud export checkbox state BEFORE entering executeAsModal
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {

    /////INITIALIZE ALL INFORMATION/////

    // Clear cached URLs/branding for this league so each run sees fresh sheet data
    await leagueConfig.invalidateLeagueCache(baseFolder);

    // Load league config, structured standings objects, and schedule data
    const [leagueData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder)
    ]);

    const { divs, confs, teams } = leagueData;

    // Get user division input from UI (converts abbreviations automatically)
    const userDiv = leagueConfig.getUserDivision(divs);
    console.log(`Selected division for DIV PREVIEW: ${userDiv}`);

    // Build active divisions from input only (no schedule/week filter)
    // Supports: ALL, a division abb (e.g. MET), or a conference abb (e.g. CEN → all divisions in that conference)
    const activeDivs = [];
    if (userDiv === "ALL") {
      for (let m = 0; m < divs.length; m++) {
        activeDivs.push(divs[m]);
      }
    } else {
      // Try single division first (userDiv is full "Conf Div" when they typed a division abb)
      for (let m = 0; m < divs.length; m++) {
        const confDiv = divs[m].conf + " " + divs[m].div;
        if (confDiv === userDiv) {
          activeDivs.push(divs[m]);
          break;
        }
      }
      // If no division matched, treat input as conference abb → run all divisions in that conference
      if (activeDivs.length === 0 && confs && confs.length > 0) {
        for (let m = 0; m < divs.length; m++) {
          if ((divs[m].conf.toUpperCase()) === userDiv) {
            activeDivs.push(divs[m]);
          } 
        }
      }
    }
    if (activeDivs.length === 0) {
      statusEl.innerHTML = "No division selected or division/conference not found. Use the Division Selector (division abb, conference abb, or ALL).";
      return;
    }

    //alert(activeDivs.length)
    //alert(activeDivs[0].div)

    ///// SEPARATE INFORMATION INTO DIVISIONS /////

    // Track previously opened doc id so we can close it after the next opens (when running ALL)
    let previousDocId = null;

    // Run for each active division
    for (let d = 0; d < activeDivs.length; d++) {
      //define division info
      const conf = activeDivs[d].conf
      const division = activeDivs[d].div
      const confDiv = conf + ' ' + division
      const divAbb = activeDivs[d].abb
      const divColorHex = String(activeDivs[d].color1)

      //Build teams for division
      const divTeams = [];

      for (let i = 0; i < teams.length; i++){
        if (teams[i].conf + ' ' + teams[i].div === confDiv)
          divTeams.push(teams[i]);
      }
      if (divTeams.length === 0) continue;

      // Navigate folders: Gameday Graphics inside league, or user selected Gameday Graphics directly
      let gamedayFolder;
      try {
        gamedayFolder = await baseFolder.getEntry('Gameday Graphics');
      } catch {
        gamedayFolder = baseFolder;
      }
      const templateFolder = await gamedayFolder.getEntry(DOC_ID);

      // Template and working save file, search for division-specific file first
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

      // Show which division is updating and how many teams it has
      statusEl.innerHTML = `Updating ${divAbb} (${divTeams.length} teams)...`;

      await core.executeAsModal(async () => {
        await app.open(templateFile);

        // If running ALL, close the previous document after opening this one
        if (previousDocId) {
          const prev = app.documents.find(docItem => docItem._id === previousDocId);
          if (prev) { 
            await delay(1000); 
            await prev.close(); 
          }
          previousDocId = null;
        }

        //Define document and header
        const doc = app.activeDocument;
        // Save As immediately to avoid editing/saving the template
        if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
        const header = getByName(doc, 'HEADER');
        const teams = getByName(doc, 'TEAMS');

        // Header updates
        const divisionText = getByName(header, 'DIVISION');
        const emblem = getByName(header, 'EMBLEM');
        const tierFolder = getByName(header, 'TIER');

        divisionText.textItem.contents = division.toUpperCase()
        //tier visibility
        for (let i = 0; i < tierFolder.layers.length; i++) {
          tierFolder.layers[i].visible = (tierFolder.layers[i].name === conf);
        }
        
        // Division emblem: replace EMBLEM layer
        await imageHandler.replaceLayerWithImage(emblem, `LOGOS/Division Emblems/${divAbb}_emblem.png`, baseFolder);
      
      
      
      
      
      
      
      })
    }
  } catch (err) {
    console.error("Division Preview error:", err);
    if (statusEl) statusEl.innerHTML = `❌ ${err.message}`;
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
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay([
    { _obj: "select", _target: [{ _ref: "layer", _id: layer._id }], makeVisible: false, selectionModifier: { _enum: "selectionModifierType", _value: "replaceSelection" }, _isCommand: true }
  ], { synchronousExecution: true });
  await app.batchPlay([
    { _obj: "set", _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: r, green: g, blue: b } } }
  ], { synchronousExecution: true });
}

async function translate(layer, deltaX, deltaY) {
  const dx = Math.round(deltaX);
  const dy = Math.round(deltaY);
  await app.batchPlay([
    {
      _obj: "select",
      _target: [{ _ref: "layer", _id: layer._id }],
      makeVisible: true
    },
    {
      _obj: "transform",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      offset: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: dx },
        vertical: { _unit: "pixelsUnit", _value: dy }
      }
    }
  ], { synchronousExecution: true });
}

async function scaleLayer(layer, percent) {
  const value = Number(percent);
  if (!isFinite(value) || value <= 0) return;
  await app.batchPlay([
    {
      _obj: "select",
      _target: [{ _ref: "layer", _id: layer._id }],
      makeVisible: true
    },
    {
      _obj: "transform",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      width: { _unit: "percentUnit", _value: value },
      height: { _unit: "percentUnit", _value: value }
    }
  ], { synchronousExecution: true });
}

const getByName = (parent, name) => {
  const layers = parent.layers || parent;
  return layers.find(l => l.name === name);
};

const setTextColor = (layer, backgroundColor) => {
  const color = new app.SolidColor();
  if (backgroundColor === 'ffffff') 
    color.rgb.hexValue = '252525';
  else color.rgb.hexValue = 'ffffff';
  layer.textItem.color = color;
};
async function duplicate(group, newName, deltaX = 0, deltaY = 0) {
      // 1) Select source group
    await app.batchPlay(
      [{
        _obj: "select",
        _target: [{ _ref: "layer", _id: group._id }],
        makeVisible: false
      }],
      { synchronousExecution: true }
    );

    // 2) Duplicate (new group becomes active)
    await app.batchPlay(
        [{ _obj: "duplicate", _target: [{ _ref: "layer", _id: group._id }] }],
        { synchronousExecution: true }
      );

      const dup = app.activeDocument.activeLayers[0];

      // 3) Rename duplicated group
      try { dup.name = newName; } catch {}

      // 4) Recursively strip " copy" suffixes from dup and all descendants
      const stripSuffix = n => n.replace(/\s+copy(?:\s*\d+)?$/i, "");
      const scrubNamesRecursively = (layerLike) => {
        try {
          if (layerLike.name) {
            const cleaned = stripSuffix(layerLike.name);
            if (cleaned !== layerLike.name) layerLike.name = cleaned;
          }
        } catch {}
        // Recurse into children if it's a group
        if (layerLike.layers && layerLike.layers.length) {
          for (const child of layerLike.layers) scrubNamesRecursively(child);
        }
      };
      scrubNamesRecursively(dup);

      // 5) Translate/move the duplicated group if requested
      if (deltaX !== 0 || deltaY !== 0) {
        await app.batchPlay(
          [{
            _obj: "transform",
            _target: [{ _ref: "layer", _id: dup._id }],
            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
            offset: {
              _obj: "offset",
              horizontal: { _unit: "pixelsUnit", _value: deltaX },
              vertical:   { _unit: "pixelsUnit", _value: deltaY }
            }
          }],
          { synchronousExecution: true }
        );
      }

      return dup;
    }


// Ensure folder path under a root FolderEntry; returns the deepest folder
async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (const segment of segments) {
    try { current = await current.getEntry(segment); }
    catch { current = await current.createFolder(segment); }
  }
  return current;
}
async function prepareDivPreviewExport(gamedayFolder, week, divAbb, chunkIndex) {
  const weekFolderName = `Week ${week}`;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, DOC_EXPORT]);
  const suffix = (typeof chunkIndex === 'number') ? `_${chunkIndex + 1}` : '';
  const exportFileName = `${divAbb}_${DOC_EXPORT}${suffix}.png`;
  return await exportFolder.createFile(exportFileName, { overwrite: true });
}


module.exports = {
  handleDivPreviewsUpdate
};
