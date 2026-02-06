const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const imageHandler = require("./imageHandler.js");
const exportHandler = require("./exportHandler.js");
const fs = require("uxp").storage.localFileSystem;

// Document identifiers for this script
const DOC_ID = 'SCHEDULE';        // folder + template basename (e.g., SCHEDULE/SCHEDULE.psd)
// We export to one of two folders depending on mode: 'Upcoming Games' or 'Final Scores'

// Helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to handle SCHEDULE Update
async function handleScheduleUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  
  // Read cloud export checkbox state BEFORE entering executeAsModal
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {
    // Clear any cached URLs/branding so this run sees fresh sheet data,
    // then load league config and schedule data (branding will still be
    // cached within this run only).
    await leagueConfig.invalidateLeagueCache(baseFolder);

    // Load league config and schedule data
    const [leagueData, scheduleData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadSchedule(baseFolder)
    ]);

    const { divs, confs, teams } = leagueData;
    const { schedule, week, year } = scheduleData;

    // Read user input (can be conference abb, division abb, or ALL)
    const input = document.getElementById("divisionInput").value.trim().toUpperCase();
    let selectedConf = null;      // e.g., STG
    let selectedDivAbb = null;    // e.g., STGP

    if (input && input !== 'ALL') {
      // Try match division abb first
      for (let i = 0; i < divs.length; i++) {
        if (input === String(divs[i].abb || '').toUpperCase()) {
          selectedDivAbb = divs[i].abb;
          selectedConf = divs[i].conf; // also know the conf but we will still iterate
          break;
        }
      }
      // If not a division, try match conference abb
      if (!selectedDivAbb) {
        for (let i = 0; i < confs.length; i++) {
          if (input === String(confs[i].conf || '').toUpperCase()) {
            selectedConf = confs[i].conf;
            break;
          }
        }
      }
    }

    // Build active conferences list per filter
    const activeConfs = [];
    for (let i = 0; i < confs.length; i++) {
      const confName = confs[i].conf;

      // Skip other conferences if a specific conference was selected
      if (selectedConf && confName !== selectedConf) continue;

      // Base filter: this week or next week
      let confGames = schedule.filter(g => g.conf === confName && (Number(g.week) === week || Number(g.week) === week + 1));

      // If a specific division is selected, restrict to that division
      if (selectedDivAbb) {
        confGames = confGames.filter(g => String(g.div1 || '').toUpperCase() === selectedDivAbb);
      }

      if (confGames.length) 
        activeConfs.push(confGames);
    }

    if (!activeConfs.length) {
      statusEl.textContent = `⚠️ No games found for ${input || 'ALL'} (Week ${week})`;
      return;
    }

    // Root folders (Gameday Graphics is directly inside the league folder)
    const gamedayFolder = await baseFolder.getEntry('Gameday Graphics');
    const templateFolder = await gamedayFolder.getEntry(DOC_ID);

    // Track previously opened doc id (for ALL mode)
    let previousDocId = null;

    // Iterate conferences
    for (let d = 0; d < activeConfs.length; d++) {
      const confGames = activeConfs[d];
      const conf = confGames[0].conf;

      // Conference info (color/location)
      let confColorHex = 'ffffff';
      let confLocation = '';
      for (let i = 0; i < confs.length; i++) {
        if (confs[i].conf === conf) {
          confColorHex = confs[i].color;
          confLocation = confs[i].location;
          break;
        }
      }

      // Group by date (unique dates within this conf)
      const uniqueDates = [];
      for (let j = 0; j < confGames.length; j++) {
        const gameDate = confGames[j].date;
        if (!uniqueDates.includes(gameDate)) uniqueDates.push(gameDate);
      }

      const dates = [];
      for (let i = 0; i < uniqueDates.length; i++) {
        const dayGames = confGames.filter(g => g.date === uniqueDates[i]);
        if (dayGames.length) dates.push(dayGames);
      }

      // Build per-date → per-season chunks
      for (let s = 0; s < dates.length; s++) {
        const todayGames = dates[s];
        const dateValue = todayGames[0].date;
        const dateShort = todayGames[0].dateShort;

        // Separate by Type (e.g., Regular Season vs Playoffs)
        const uniqueTypes = [];
        for (let j = 0; j < todayGames.length; j++) {
          const type = todayGames[j].gameType;
          if (!uniqueTypes.includes(type)) uniqueTypes.push(type);
        }

        const activeTypes = [];
        for (let i = 0; i < uniqueTypes.length; i++) {
          const typeGames = todayGames.filter(g => g.gameType === uniqueTypes[i]);
          if (typeGames.length) activeTypes.push(typeGames);
        }

        for (let t = 0; t < activeTypes.length; t++) {
          let finalGames = activeTypes[t];
          const gameType = finalGames[0].gameType
          const gameSeason = finalGames[0].season;

          // Determine doc type by whether this is current week has scores or upcoming week
          let docType = 'Upcoming Games';
          if (finalGames.some(g => Number(g.week) === week && String(g.score1).trim() !== '')) {
            docType = 'Final Scores';
          }

          // Chunking for long lists
          let chunkA = [];
          let chunkB = [];
          if (finalGames.length > 10) {
            const half = Math.ceil(finalGames.length / 2);
            chunkA = finalGames.slice(0, half);
            chunkB = finalGames.slice(half);
          } else {
            chunkA = finalGames;
          }

          const chunks = [chunkA, chunkB];

          for (let a = 0; a < chunks.length; a++) {
            if (!chunks[a] || chunks[a].length === 0) break;
            finalGames = chunks[a];

            // Show which conference/date and how many games are on this graphic
            statusEl.innerHTML = `Updating ${conf} ${dateShort} (${finalGames.length} games)...`;

            await core.executeAsModal(async () => {
              // Use playoff template if season is "Playoffs"
              let templateFileName;
              if (gameType === 'Playoffs') {
                templateFileName = `${DOC_ID}_Playoffs.psd`;
              } else {
                templateFileName = `${DOC_ID}.psd`;
              }
              const templateFile = await templateFolder.getEntry(templateFileName);
              await app.open(templateFile);

              // Close previous doc when doing many
              if (previousDocId) {
                const prev = app.documents.find(docItem => docItem._id === previousDocId);
                if (prev) { await delay(300); await prev.close(); }
                previousDocId = null;
              }

              const doc = app.activeDocument;
              // Save As immediately to avoid editing/saving the template
              // Ensure working folder exists and create save file first
              let workingFolder = null;
              try { workingFolder = await templateFolder.getEntry('Working Files'); }
              catch { workingFolder = await templateFolder.createFolder('Working Files'); }
              const dayName = String(finalGames[0].day);
              const workingFileName = `${conf}_${DOC_ID}_working_${dayName}.psd`;
              const saveFile = await workingFolder.createFile(sanitizeFilename(workingFileName), { overwrite: true });
              if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
              const header = getByName(doc, 'HEADER');
              const matchups = getByName(doc, 'MATCHUPS');

              // Header layers
              const headerText = getByName(header, 'HEADING');
              const dateText = getByName(header, 'DATE');
              const locationText = getByName(header, 'LOCATION');
              const divisionColorLayer = getByName(header, 'HEADER COLOR');

              // Set header
              let headerTextValue;
              if (docType === 'Final Scores') {
                headerTextValue = 'FINAL SCORES';
              } else if (gameType === 'Playoffs') {
                headerTextValue = 'PLAYOFFS';
              } else {
                headerTextValue = 'SCHEDULE';
              }
              headerText.textItem.contents = headerTextValue;
              dateText.textItem.contents = String(dateValue).toUpperCase();
              locationText.textItem.contents = String(confLocation).toUpperCase();
              
              // Header color: conference color unless a specific division is selected
              let headerColorHex = confColorHex;
              if (selectedDivAbb) {
                let divHex = 'ffffff';
                for (let i = 0; i < divs.length; i++) {
                  if (divs[i].abb === selectedDivAbb) {
                    divHex = String(divs[i].color1);
                    break;
                  }
                }
                headerColorHex = divHex;
              }
              await fillColor(divisionColorLayer, headerColorHex);

              // Create boxes for number of games (follow JSX logic)
              const numOfGames = finalGames.length;
              if (numOfGames === 1) {
                await translate(matchups, 0, 300);
              } else if (numOfGames > 1 && numOfGames < 7) {
                for (let p = 2; p < numOfGames + 1; p++) {
                  const matchX = getByName(matchups, 'MATCH ' + (p - 1));
                  if (!matchX) break;
                  await duplicate(matchX, 'MATCH ' + p, 0, 150);
                }
                const adjust = 240 - (60 * (numOfGames - 2));
                await translate(matchups, 0, adjust);
              } else if (numOfGames === 7) {
                for (let p = 2; p < numOfGames + 1; p++) {
                  const matchX = getByName(matchups, 'MATCH ' + (p - 1));
                  if (!matchX) break;
                  await duplicate(matchX, 'MATCH ' + p, 0, 130);
                }
              } else if (numOfGames > 7 && numOfGames < 11) {
                // Scale the whole MATCHUPS group down slightly when there are many games
                let scalePercent = 90 - 10*(numOfGames - 8);
                await translate(matchups, 0, -20)
                await scaleLayer(matchups, scalePercent);
                for (let p = 2; p < numOfGames + 1; p++) {
                  const matchX = getByName(matchups, 'MATCH ' + (p - 1));
                  if (!matchX) break;
                  await duplicate(matchX, 'MATCH ' + p, 0, (130*scalePercent)/100);
                }
              }

              // Update each match
              for (let i = 0; i < numOfGames; i++) {
                const j = i + 1;
                const matchX = getByName(matchups, 'MATCH ' + j);
                if (!matchX) continue;

                const divisionText = getByName(matchX, 'DIVISION');
                const roundText = getByName(matchX, 'ROUND');

                // Team layers
                const color1 = getByName(matchX, 'TEAM 1 COLOR');
                const color2 = getByName(matchX, 'TEAM 2 COLOR');
                const logo1 = getByName(matchX, 'TEAM 1 LOGO');
                const logo2 = getByName(matchX, 'TEAM 2 LOGO');
                const team1nameText = getByName(matchX, 'TEAM 1 NAME');
                const team2nameText = getByName(matchX, 'TEAM 2 NAME');

                // Time/final groups
                const timeFolder = getByName(matchX, 'TIME');
                const finalFolder = getByName(matchX, 'FINAL SCORE');
                const timeLayer = timeFolder ? getByName(timeFolder, 'TIME') : null;
                const score1 = finalFolder ? getByName(finalFolder, 'SCORE 1') : null;
                const score2 = finalFolder ? getByName(finalFolder, 'SCORE 2') : null;
                const finalText = finalFolder ? getByName(finalFolder, 'FINAL') : null;

                // Determine division + abb for logos path
                const divAbb = finalGames[i].div1;
                const division = finalGames[i].division1;
                // Find short division label if available
                let divisionShort = null;
                for (let k = 0; k < divs.length; k++) {
                  if (divs[k].abb === divAbb && divs[k].conf === conf) {
                    divisionShort = divs[k].divShort || null;
                    break;
                  }
                }
                // Toggle time/final based on docType
                if (docType === 'Final Scores') {
                  if (timeFolder) timeFolder.visible = false;
                  if (finalFolder) finalFolder.visible = true;
                  if (finalText) finalText.textItem.contents = String(finalGames[i].status).toUpperCase();
                } else {
                  if (timeFolder) timeFolder.visible = true;
                  if (finalFolder) finalFolder.visible = false;
                }

                // Team 1
                let t1Color = '4a4a4a';
                let t1Name = finalGames[i].team1;
                let t1Found = false;
                for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === finalGames[i].team1) {
                    t1Color = teams[c].color1;
                    t1Name = teams[c].teamName;
                    t1Full = teams[c].fullTeam;
                    t1Found = true;
                    break;
                  }
                }
                // Set to TBD if name is blank
                if (!t1Name || String(t1Name).trim() === '') {
                  t1Name = 'TBD';
                }

                // Team 2
                let t2Color = '4a4a4a';
                let t2Name = finalGames[i].team2;
                let t2Found = false;
                for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === finalGames[i].team2) {
                    t2Color = teams[c].color1;
                    t2Name = teams[c].teamName;
                    t2Full = teams[c].fullTeam;
                    t2Found = true;
                    break;
                  }
                }
                // Set to TBD if name is blank
                if (!t2Name || String(t2Name).trim() === '') {
                  t2Name = 'TBD';
                }

                // Apply colors
                await fillColor(color1, t1Color);
                await fillColor(color2, t2Color);

                // Names - add seeds for Playoffs
                let team1DisplayName = String(t1Name).toUpperCase();
                let team2DisplayName = String(t2Name).toUpperCase();
                
                if (finalGames[i].gameType === 'Playoffs') {
                  const seed1 = finalGames[i].seed1;
                  const seed2 = finalGames[i].seed2;
                  if (seed1 !== undefined && seed1 !== null && seed1 !== '') {
                    team1DisplayName = `#${seed1} ${team1DisplayName}`;
                  }
                  if (seed2 !== undefined && seed2 !== null && seed2 !== '') {
                    team2DisplayName = `#${seed2} ${team2DisplayName}`;
                  }
                }
                
                team1nameText.textItem.contents = team1DisplayName.length > 20 ? (team1DisplayName.slice(0, 20) + '...') : team1DisplayName;
                team2nameText.textItem.contents = team2DisplayName.length > 20 ? (team2DisplayName.slice(0, 20) + '...') : team2DisplayName;

                // Logos with fallback to LeagueLogo.png
                if (t1Found) {
                  const logo1Url = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(t1Full)}.png`;
                  let ok1 = await imageHandler.replaceLayerWithImage(logo1, logo1Url);
                  if (!ok1) ok1 = await imageHandler.replaceLayerWithImage(logo1, `LOGOS/TEAMS/${conf}/${divAbb}/${t1Full}.png`, baseFolder);
                  if (!ok1) await imageHandler.replaceLayerWithImage(logo1, "LOGOS/LeagueLogo.png", baseFolder);
                } else {
                  await imageHandler.replaceLayerWithImage(logo1, "LOGOS/LeagueLogo.png", baseFolder);
                }

                if (t2Found) {
                  const logo2Url = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(t2Full)}.png`;
                  let ok2 = await imageHandler.replaceLayerWithImage(logo2, logo2Url);
                  if (!ok2) ok2 = await imageHandler.replaceLayerWithImage(logo2, `LOGOS/TEAMS/${conf}/${divAbb}/${t2Full}.png`, baseFolder);
                  if (!ok2) await imageHandler.replaceLayerWithImage(logo2, "LOGOS/LeagueLogo.png", baseFolder);
                } else {
                  await imageHandler.replaceLayerWithImage(logo2, "LOGOS/LeagueLogo.png", baseFolder);
                }

                // Division label – always prefer short name if available
                if (divisionText) {
                  const displayDivision = divisionShort || division;
                  divisionText.textItem.contents = String(displayDivision).toUpperCase();
                }

                // Round label – only for Playoffs
                if (finalGames[i].gameType === 'Playoffs' && roundText) {
                  roundText.textItem.contents = String(finalGames[i].round || '').toUpperCase();
                }

                // Time/Final values
                if (docType === 'Final Scores') {
                  if (score1) score1.textItem.contents = String(finalGames[i].score1 || '');
                  if (score2) score2.textItem.contents = String(finalGames[i].score2 || '');

                  // Highlight winning score (gold)
                  const s1 = Number(finalGames[i].score1);
                  const s2 = Number(finalGames[i].score2);
                  if (!isNaN(s1) && !isNaN(s2)) {
                    if (s1 > s2 && score1) setTextHex(score1, 'ffd800');
                    else if (s2 > s1 && score2) setTextHex(score2, 'ffd800');
                  }
                } else {
                  if (timeLayer) timeLayer.textItem.contents = String(finalGames[i].time || '').toUpperCase();
                }
              }

              // Export per chunk
              const exportFile = await prepareScheduleExport(gamedayFolder, week, docType, conf, dateShort, gameType, a);
              const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, docType, exportFile.name);
              await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);

              previousDocId = doc._id;
              await doc.save();
            }, { commandName: `Update ${DOC_ID}` });
          }
        }
      }
    }

    const selectedTag = input && input !== 'ALL' ? input : 'ALL';
    statusEl.textContent = `✅ ${DOC_ID} completed for ${selectedTag}`;
  } catch (err) {
    statusEl.textContent = `⚠️ Error updating ${DOC_ID}`;
    console.error(err);
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

function setTextHex(layer, hex) {
  if (!layer) return;
  const color = new app.SolidColor();
  color.rgb.hexValue = String(hex).replace(/^#/, '').toLowerCase();
  layer.textItem.color = color;
}

const getByName = (parent, name) => {
  const layers = parent.layers || parent;
  return layers.find(l => l.name === name);
};


// Duplicate a layer/group, strip "copy" suffixes, and translate by offset
async function duplicate(group, newName, deltaX = 0, deltaY = 0) {
  await app.batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: group._id }], makeVisible: false }],
    { synchronousExecution: true }
  );

  await app.batchPlay(
    [{ _obj: "duplicate", _target: [{ _ref: "layer", _id: group._id }] }],
    { synchronousExecution: true }
  );

  const dup = app.activeDocument.activeLayers[0];
  try { dup.name = newName; } catch {}

  const stripSuffix = n => n.replace(/\s+copy(?:\s*\d+)?$/i, "");
  const scrubNamesRecursively = (layerLike) => {
    try {
      if (layerLike.name) {
        const cleaned = stripSuffix(layerLike.name);
        if (cleaned !== layerLike.name) layerLike.name = cleaned;
      }
    } catch {}
    if (layerLike.layers && layerLike.layers.length) {
      for (const child of layerLike.layers) scrubNamesRecursively(child);
    }
  };
  scrubNamesRecursively(dup);

  if (deltaX !== 0 || deltaY !== 0) {
    await translate(dup, deltaX, deltaY);
  }

  return dup;
}

async function translate(layer, deltaX, deltaY) {
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
        horizontal: { _unit: "pixelsUnit", _value: deltaX },
        vertical: { _unit: "pixelsUnit", _value: deltaY }
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

// Ensure folder path under a root FolderEntry; returns the deepest folder
async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (const segment of segments) {
    try { current = await current.getEntry(segment); }
    catch { current = await current.createFolder(segment); }
  }
  return current;
}

// Prepare and return a FileEntry for Schedule PNG export
async function prepareScheduleExport(gamedayFolder, week, docType, conf, dateShort, type, chunkIndex) {
  const weekFolderName = `Week ${week}`;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, docType]);
  const safeConf = sanitizeFilename(conf);
  const safeDate = sanitizeFilename(dateShort);
  const safeType = sanitizeFilename(type);
  const fileName = `${safeConf}_${safeDate}_${safeType}_${chunkIndex}.png`;
  return await exportFolder.createFile(fileName, { overwrite: true });
}


// Export the function
module.exports = {
  handleScheduleUpdate
};

// Sanitize strings for valid filenames on all platforms
function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-') // replace invalid characters
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim()
    .replace(/\s/g, '-')             // spaces to dashes
    .replace(/\.+$/g, '');           // no trailing dots
}
