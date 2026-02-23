// divPreviews.js - Division Preview automation
const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const imageHandler = require("./imageHandler.js");
const exportHandler = require("./exportHandler.js");
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

    // Load league config
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

      // Conference info (location/timezone)
      let confLocation = null;
      for (let i=0; i < confs.length; i++){
        if (confs[i].conf === conf) {
          confLocation = confs[i].location;
          break;
        }
      }

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

      ///// CHUNKING LOGIC /////
      // Split into 2 equal chunks if 12+ teams, with first chunk getting extra if odd
      const numOfTeams = divTeams.length;
      const chunks = [];
      if (numOfTeams < 12) {
        chunks.push(divTeams);
      } else {
        // Split into 2 chunks: first chunk gets extra if odd
        const chunkSize = Math.ceil(numOfTeams / 2);
        chunks.push(divTeams.slice(0, chunkSize));
        chunks.push(divTeams.slice(chunkSize));
      }

      ///// PHOTOSHOP AUTOMATION /////
      // Process each chunk separately
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunkTeams = chunks[chunkIndex];
        const chunkNumTeams = chunkTeams.length;

      // Show which division is updating and how many teams it has
      statusEl.innerHTML = `Updating ${divAbb} (${divTeams.length} teams)...`;

      await core.executeAsModal(async () => {
        await app.open(templateFile);

        // Only close previous document when running ALL divisions
        if (userDiv === 'ALL' && previousDocId) {
          const prev = app.documents.find(docItem => docItem._id === previousDocId);
          if (prev) { 
            await delay(1000); 
            await prev.close(); 
          }
        }

        //Define document and header
        const doc = app.activeDocument;
        // Save As immediately to avoid editing/saving the template
        if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
        const header = getByName(doc, 'HEADER');
        const teamsGroup = getByName(doc, 'TEAMS'); // Photoshop layer group
        const background = getByName(doc, 'BACKGROUND');

        // Header updates
        const divisionText = getByName(header, 'DIVISION');
        const emblem = getByName(header, 'EMBLEM');
        const divisionColorLayer = getByName(header, 'HEADER COLOR');
        const locationText = getByName(header, 'LOCATION');
        const tierFolder = getByName(header, 'TIER');

        divisionText.textItem.contents = division.toUpperCase()
        if (locationText) locationText.textItem.contents = confLocation.toUpperCase();

        //tier visibility
        if (tierFolder){
          for (let i = 0; i < tierFolder.layers.length; i++) {
            tierFolder.layers[i].visible = (tierFolder.layers[i].name === conf);
          }
        }

        // Division emblem: replace EMBLEM layer if it exists
        if (emblem) {
          await imageHandler.replaceLayerWithImage(emblem, `LOGOS/Division Emblems/PNG/${divAbb}_emblem.png`, baseFolder);
        }

        if (divisionColorLayer) await fillColor(divisionColorLayer, divColorHex);
      
        // Read max area height from AREA rectangle layer in BACKGROUND folder
        const areaLayer = getByName(background, 'AREA');
        if (!areaLayer) {
          throw new Error("AREA layer not found in BACKGROUND folder");
        }
        const areaBounds = areaLayer.boundsNoEffects;
        const maxAreaHeight = Math.abs(areaBounds.bottom - areaBounds.top); // Height in pixels
        
        // Get team1 layer first to read its dimensions
        const team1 = getByName(teamsGroup, 'TEAM 1');
        let teamBox = getByName(team1, 'TEAM COLOR')
        
        // Read box height from the actual layer bounds (without effects)
        // boundsNoEffects excludes drop shadows, strokes, etc. that can inflate the size
        const team1Bounds = teamBox.boundsNoEffects;
        const boxHeight = Math.abs(team1Bounds.bottom - team1Bounds.top); // Height in pixels
        
        // Create team boxes dynamically based on number of teams in this chunk
        const numOfTeams = chunkNumTeams;
        const defaultSpacing = boxHeight * 0.13; // Default spacing between team boxes (gap)
        
        // Calculate if teams fit at normal size (100%)
        // Total height = (numOfTeams - 1) * spacing + boxHeight
        // Where spacing = boxHeight + gap, so: (numOfTeams - 1) * (boxHeight + gap) + boxHeight
        // Simplifies to: numOfTeams * boxHeight + (numOfTeams - 1) * gap
        const totalHeight = (boxHeight * numOfTeams) + (defaultSpacing * (numOfTeams - 1)) ;
        
        let scale = 100;
        let spacing = defaultSpacing;
        
        if (totalHeight <= maxAreaHeight) {
          // Teams fit at normal size - use default spacing
          scale = 100;
          spacing = defaultSpacing;
        } else {
          scale = (maxAreaHeight / totalHeight) * 100
          spacing  = defaultSpacing * (scale / 100)
          }
              
        await scaleLayer(team1, scale);
          
        for (let p = 1; p < numOfTeams ; p++) {
          const teamX = getByName(teamsGroup, 'TEAM ' + p);
          if (teamX) {
            await duplicate(teamX, 'TEAM ' + (p + 1), 0, (scale / 100) * (spacing + boxHeight));
          }
        }

        // Apply vertical translation to center teams in available area
        if (scale == 100) {
          // Center vertically in available area
          let translateY = (maxAreaHeight - totalHeight) / 3;
          await translate(teamsGroup, 0, translateY);
        }
        
        // Update each team slot with logo, color, and name
        for (let i = 0; i < chunkNumTeams; i++) {
          const teamSlot = getByName(teamsGroup, 'TEAM ' + (i + 1));
          
          const teamData = chunkTeams[i];
          
          // Get team info layers
          const teamColorLayer = getByName(teamSlot, 'TEAM COLOR');
          const teamLogoLayer = getByName(teamSlot, 'LOGO');
          const teamCityLayer = getByName(teamSlot, 'TEAM CITY');
          const teamNameLayer = getByName(teamSlot, 'TEAM NAME');
          
          // Team data is already available in teamData (from chunkTeams/divTeams)
          const tColor = teamData.color1 || '000000';
          const tCity = teamData.teamCity || '';
          const tName = teamData.teamName || '';
          const tFull = teamData.fullTeam || '';
          
          // Update team color
          await fillColor(teamColorLayer, tColor);
          
          // Update team color stroke
          await setStrokeColor(teamColorLayer, tColor);
          
          // Update team logo (try URL, then local path, then LeagueLogo)
          const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(tFull)}.png`;
          let ok = await imageHandler.replaceLayerWithImage(teamLogoLayer, logoUrl);
          if (!ok) ok = await imageHandler.replaceLayerWithImage(teamLogoLayer, `LOGOS/TEAMS/${conf}/${divAbb}/${tFull}.png`, baseFolder);
          if (!ok) await imageHandler.replaceLayerWithImage(teamLogoLayer, "LOGOS/LeagueLogo.png", baseFolder);

          
          // Update team name
          const displayTeamCity = String(tCity).toUpperCase();
          const displayTeamName = String(tName).toUpperCase();
          
          if (teamCityLayer) teamCityLayer.textItem.contents = displayTeamCity.length > 20 ? (displayTeamCity.slice(0, 20) + '...') : displayTeamCity;
          teamNameLayer.textItem.contents = displayTeamName.length > 20 ? (displayTeamName.slice(0, 20) + '...') : displayTeamName;

          // Shrink team name text until it fits within the team color rectangle
          const teamColorBounds = teamColorLayer.boundsNoEffects;
          const maxRight = teamColorBounds.right;
          while (teamNameLayer.boundsNoEffects.right > maxRight && teamNameLayer.textItem.characterStyle) {
            const fontSize = Number(teamNameLayer.textItem.characterStyle.size);
            if (!isFinite(fontSize) || fontSize <= 1) break;
            teamNameLayer.textItem.characterStyle.size = fontSize * 0.95;
          }

          // Set text color: if team color is white, use dark gray (252525), otherwise use white
          if (teamCityLayer) setTextColor(teamCityLayer, tColor);
          setTextColor(teamNameLayer, tColor);
        }

        // Save the document
        await doc.save();
        
        // Export PNG to Exports/Preseason/Div-Preview
        const exportFile = await prepareDivPreviewExport(gamedayFolder, divAbb, chunkIndex);
        const cdnPath = exportHandler.buildCdnPath(baseFolder.name, 'Preseason', DOC_EXPORT, exportFile.name);
        await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);
        
        // Store this doc's ID to close it next time (only when running ALL)
        if (userDiv === 'ALL') {
          previousDocId = doc._id;
        }
        });
        
        // Close document after each chunk (only when running ALL and not the last chunk)
        if (userDiv === 'ALL' && chunkIndex < chunks.length - 1) {
          await core.executeAsModal(async () => {
            const docToClose = app.documents.find(docItem => docItem._id === previousDocId);
            if (docToClose) {
              await delay(500);
              await docToClose.close();
              previousDocId = null;
            }
          });
        }
      }
    }
    
    // After all divisions are processed, close the last document (only when running ALL)
    if (userDiv === 'ALL' && previousDocId) {
      await core.executeAsModal(async () => {
        const lastDoc = app.documents.find(docItem => docItem._id === previousDocId);
        if (lastDoc) {
          await delay(500);
          await lastDoc.close();
        }
      });
    }

    if (userDiv === 'ALL') {
      statusEl.innerHTML = `✅ Updated ${activeDivs.length} divisions`;
    } else {
      statusEl.innerHTML = `✅ Updated ${userDiv}`;
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

async function setStrokeColor(layer, hex) {

  const { r, g, b } = hexToRgb(hex);

  await app.batchPlay([
    { _obj: "select", _target: [{ _ref: "layer", _id: layer._id }], makeVisible: false, selectionModifier: { _enum: "selectionModifierType", _value: "replaceSelection" }, _isCommand: true }
  ], { synchronousExecution: true });

  await app.batchPlay([
    {
      _obj: "set",
      _target: [
        {
          _enum: "ordinal",
          _ref: "contentLayer",
          _value: "targetEnum"
        }
      ],
      to: {
        _obj: "shapeStyle",
        strokeStyle: {
          _obj: "strokeStyle",
          strokeEnabled: true,
          strokeStyleContent: {
            _obj: "solidColorLayer",
            color: {
              _obj: "RGBColor",
              red: r,
              green: g,
              blue: b
            }
          },
          strokeStyleVersion: 2
        }
      }
    }
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

async function scaleLayer(layer, percent, anchor = "top") {
  const value = Number(percent);
  if (!isFinite(value) || value <= 0) return;
  
  // Map anchor to quadCenterState enum value
  const anchorMap = {
    "top": "QCSTop",
    "center": "QCSAverage",
    "bottom": "QCSBottom",
    "topLeft": "QCSTopLeft",
    "topRight": "QCSTopRight",
    "bottomLeft": "QCSBottomLeft",
    "bottomRight": "QCSBottomRight"
  };
  
  const centerState = anchorMap[anchor] || "QCSTop";
  
  await app.batchPlay([
    {
      _obj: "select",
      _target: [{ _ref: "layer", _id: layer._id }],
      makeVisible: true
    },
    {
      _obj: "transform",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      freeTransformCenterState: { _enum: "quadCenterState", _value: centerState },
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
  layer.textItem.characterStyle.color = color;
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

async function prepareDivPreviewExport(gamedayFolder, divAbb, chunkIndex) {
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', 'Preseason', DOC_EXPORT]);
  const suffix = (typeof chunkIndex === 'number') ? `_${chunkIndex + 1}` : '';
  const exportFileName = `${divAbb}_${DOC_EXPORT}${suffix}.png`;
  return await exportFolder.createFile(exportFileName, { overwrite: true });
}


module.exports = {
  handleDivPreviewsUpdate
};
