const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

// Helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Document identifiers for this script
const DOC_ID = 'SCHEDULE';        // folder + template basename (e.g., SCHEDULE/SCHEDULE.psd)
// We export to one of two folders depending on mode: 'Upcoming Games' or 'Final Scores'

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

    // Read user input (division abb, conference name, or ALL)
    const input = document.getElementById("divisionInput").value.trim().toUpperCase();
    let selectedConf = null;    // filter to a specific conference
    let selectedDivAbb = null;  // filter to a specific division

    if (input && input !== 'ALL') {
      // Try division abb first
      for (let i = 0; i < divs.length; i++) {
        if (input === String(divs[i].abb || '').toUpperCase()) {
          selectedDivAbb = divs[i].abb;
          break;
        }
      }
      // If no division match, try conference name
      if (!selectedDivAbb) {
        for (let i = 0; i < confs.length; i++) {
          if (input === String(confs[i].conf || '').toUpperCase()) {
            selectedConf = confs[i].conf;
            break;
          }
        }
      }
    }

    // Build active divisions list — one entry per division that has games this/next week
    const activeDivs = [];
    for (let i = 0; i < divs.length; i++) {
      const divAbb = divs[i].abb;
      const divConf = divs[i].conf;

      if (selectedDivAbb && divAbb !== selectedDivAbb) continue;
      if (selectedConf && !selectedDivAbb && divConf !== selectedConf) continue;

      const divGames = schedule.filter(g =>
        g.div1 === divAbb &&
        String(g.week).trim() !== '' &&
        (Number(g.week) === week || Number(g.week) === week + 1)
      );

      if (divGames.length) activeDivs.push(divGames);
    }

    // ── DEBUG: dump every game collected for the current week ──
    console.log(`\n========== SCHEDULE DEBUG (Week ${week}, Year ${year}) ==========`);
    console.log(`Filter: input="${input || 'ALL'}", selectedConf=${selectedConf}, selectedDivAbb=${selectedDivAbb}`);
    console.log(`Total divisions with games: ${activeDivs.length}`);
    for (let dc = 0; dc < activeDivs.length; dc++) {
      const dg = activeDivs[dc];
      console.log(`\n── Division: ${dg[0].div1} / ${dg[0].conf} (${dg.length} games) ──`);
      for (let gi = 0; gi < dg.length; gi++) {
        const g = dg[gi];
        console.log(
          `  [${gi}] week=${g.week} | date=${g.date} | gameType=${g.gameType}` +
          ` | ${g.team1} vs ${g.team2}` +
          (g.round ? ` | round=${g.round}` : '') +
          (g.score1 ? ` | score=${g.score1}-${g.score2}` : '')
        );
      }
    }
    console.log(`====================================================\n`);
    // ── END DEBUG ──

    if (!activeDivs.length) {
      statusEl.textContent = `⚠️ No games found for ${input || 'ALL'} (Week ${week})`;
      return;
    }

    // Root folders (Gameday Graphics is directly inside the league folder)
    const gamedayFolder = await baseFolder.getEntry('Gameday Graphics');
    const templateFolder = await gamedayFolder.getEntry(DOC_ID);

    // Track previously opened doc id (for ALL mode)
    let previousDocId = null;
    // Per-division export counters for this run/week
    const divisionExportCounts = {};

    // Iterate divisions
    for (let d = 0; d < activeDivs.length; d++) {
      const divGames = activeDivs[d];
      const divAbb = divGames[0].div1;
      const division = divGames[0].division1
      const conf = divGames[0].conf;

      // Division colors
      let divColor1Hex = 'ffffff';
      let divColor2Hex = 'ffffff';
      for (let i = 0; i < divs.length; i++) {
        if (divs[i].abb === divAbb) {
          divColor1Hex = divs[i].color1 || 'ffffff';
          divColor2Hex = divs[i].color2 || 'ffffff';
          break;
        }
      }

      // Separate by Type (e.g., Regular Season vs Playoffs) across the full division week
      const uniqueTypes = [];
      for (let j = 0; j < divGames.length; j++) {
        const type = divGames[j].gameType;
        if (!uniqueTypes.includes(type)) uniqueTypes.push(type);
      }

      const activeTypes = [];
      for (let i = 0; i < uniqueTypes.length; i++) {
        const typeGames = divGames.filter(g => g.gameType === uniqueTypes[i]);
        if (typeGames.length) activeTypes.push(typeGames);
      }

      for (let t = 0; t < activeTypes.length; t++) {
        let finalGames = activeTypes[t];
        const gameType = finalGames[0].gameType;
        const gameSeason = finalGames[0].season;

          // Determine doc type by whether this is current week has scores or upcoming week
          let docType = 'Upcoming Games';
          if (finalGames.some(g => Number(g.week) === week && String(g.score1).trim() !== '')) {
            docType = 'Final Scores';
          }

          // For Final Scores, drop any games that don't yet have a status
          if (docType === 'Final Scores') {
            finalGames = finalGames.filter(g => String(g.status || '').trim() !== '');
            if (!finalGames.length) continue;
          }

          // Chunking for long lists
          let chunkA = [];
          let chunkB = [];
          if (finalGames.length > 7) {
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

            // Show which division/week and how many games are on this graphic
            statusEl.innerHTML = `Updating ${divAbb} Week ${week} (${finalGames.length} games)...`;

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
              const docTypeSuffix = docType === 'Final Scores' ? 'FS' : 'UG';
              const chunkSuffix = (chunks.length > 1 && chunks[1] && chunks[1].length > 0) ? `_${a}` : '';
              const workingFileName = `${divAbb}_${DOC_ID}_working_Week${week}_${docTypeSuffix}${chunkSuffix}.psd`;
              const saveFile = await workingFolder.createFile(sanitizeFilename(workingFileName), { overwrite: true });
              if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
              const header = getByName(doc, 'HEADER');
              const matchups = getByName(doc, 'MATCHUPS');
              const background = getByName(doc, 'BACKGROUND');

              // Header layers
              const headerText = getByName(header, 'HEADING');
              const locationText = getByName(header, 'LOCATION');
              const levelText = getByName(header, 'LEVEL');

              // HEADING
              headerText.textItem.contents = docType === 'Final Scores' ? 'FINAL SCORES' : 'UPCOMING GAMES';

              // Split division name on " - " → LOCATION / LEVEL
              const divisionRaw = String(division || divAbb);
              const divSplitIdx = divisionRaw.indexOf(' - ');
              const divLocationLabel = divSplitIdx >= 0 ? divisionRaw.slice(0, divSplitIdx).toUpperCase() : divisionRaw.toUpperCase();
              const divLevelLabel = divSplitIdx >= 0 ? divisionRaw.slice(divSplitIdx + 3).toUpperCase() : '';
              if (locationText && locationText.textItem) locationText.textItem.contents = divLocationLabel;
              if (levelText && levelText.textItem) levelText.textItem.contents = divLevelLabel;

              // If div color 1 is very light, darken header text and show BLACK background layer
              const divColor1Lum = relativeLuminance(divColor1Hex);
              const headerIsLight = divColor1Lum > 0.75;
              if (headerIsLight) {
                if (locationText && locationText.textItem) setTextHex(locationText, '252525');
                if (levelText && levelText.textItem) setTextHex(levelText, '252525');
              }
              const blackLayer = background ? getByName(background, 'BLACK') : null;
              if (blackLayer) blackLayer.visible = headerIsLight;

              // Background division colors
              const divColor1Layer = background ? getByName(background, 'DIV COLOR 1') : null;
              const divColor2Layer = background ? getByName(background, 'DIV COLOR 2') : null;
              await fillColor(divColor1Layer, divColor1Hex);
              await fillColor(divColor2Layer, divColor2Hex);

              // Dynamic box creation using AREA layer bounds
              const numOfGames = finalGames.length;
              const areaLayer = background ? getByName(background, 'AREA') : null;
              if (!areaLayer) throw new Error("AREA layer not found in BACKGROUND group");

              const areaBounds = areaLayer.boundsNoEffects;
              const maxAreaHeight = Math.abs(areaBounds.bottom - areaBounds.top);

              const match1 = getByName(matchups, 'MATCH 1');
              const match1Rectangle = getByName(match1, 'RECTANGLE');
              const match1Bounds = match1Rectangle.boundsNoEffects;
              const boxHeight = Math.abs(match1Bounds.bottom - match1Bounds.top);

              const defaultSpacing = boxHeight * 0.1;
              const totalHeight = (boxHeight * numOfGames) + (defaultSpacing * (numOfGames - 1));

              let scale = 100;
              let spacing = defaultSpacing;
              if (totalHeight > maxAreaHeight) {
                scale = (maxAreaHeight / totalHeight) * 100;
                spacing = defaultSpacing * (scale / 100);
              }

              await scaleLayer(match1, scale, 'top');

              // Round the step to a whole pixel so sub-pixel errors don't accumulate
              // across copies (each duplicate is offset from the previous one)
              const step = Math.round((scale / 100) * (spacing + boxHeight));

              for (let p = 1; p < numOfGames; p++) {
                const matchX = getByName(matchups, 'MATCH ' + p);
                if (!matchX) break;
                await duplicate(matchX, 'MATCH ' + (p + 1), 0, step);
              }

              if (scale === 100) {
                await translate(matchups, 0, Math.round((maxAreaHeight - totalHeight) / 3));
              }

              // Update each match
              for (let i = 0; i < numOfGames; i++) {
                const j = i + 1;
                const matchX = getByName(matchups, 'MATCH ' + j);
                if (!matchX) continue;

                // Team layers
                const color1 = getByName(matchX, 'TEAM 1 COLOR');
                const color2 = getByName(matchX, 'TEAM 2 COLOR');
                const logo1 = getByName(matchX, 'TEAM 1 LOGO');
                const logo2 = getByName(matchX, 'TEAM 2 LOGO');
                const team1nameText = getByName(matchX, 'TEAM 1 NAME');
                const team2nameText = getByName(matchX, 'TEAM 2 NAME');
                const dateLayer = getByName(matchX, 'DATE');
                const facilityLayer = getByName(matchX, 'FACILITY');

                // Time/final groups
                const timeFolder = getByName(matchX, 'TIME');
                const finalFolder = getByName(matchX, 'FINAL SCORE');
                const timeLayer = timeFolder ? getByName(timeFolder, 'TIME') : null;
                const score1 = finalFolder ? getByName(finalFolder, 'SCORE 1') : null;
                const score2 = finalFolder ? getByName(finalFolder, 'SCORE 2') : null;
                const finalLayer = finalFolder ? getByName(finalFolder, 'FINAL') : null;
                const finalOtLayer = finalFolder ? getByName(finalFolder, 'FINAL (OT)') : null;
                const finalSoLayer = finalFolder ? getByName(finalFolder, 'FINAL (SO)') : null;

                // Determine per-team division abb for logo paths
                const team1DivAbb = finalGames[i].div1;
                const team2DivAbb = finalGames[i].div2 || finalGames[i].div1;

                // Toggle time/final based on docType
                if (docType === 'Final Scores') {
                  if (timeFolder) timeFolder.visible = false;
                  if (finalFolder) finalFolder.visible = true;
                  // Show the layer that matches the status text exactly, hide others
                  const statusVal = String(finalGames[i].status || 'FINAL').toUpperCase().trim();
                  if (finalLayer) finalLayer.visible = (statusVal === 'FINAL');
                  if (finalOtLayer) finalOtLayer.visible = (statusVal === 'FINAL (OT)');
                  if (finalSoLayer) finalSoLayer.visible = (statusVal === 'FINAL (SO)');
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
                if (!t1Name || String(t1Name).trim() === '') t1Name = 'TBD';

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
                if (!t2Name || String(t2Name).trim() === '') t2Name = 'TBD';

                // Apply colors
                await fillColor(color1, t1Color);
                await fillColor(color2, t2Color);

                // Names - add seeds for Playoffs
                let team1DisplayName = String(t1Name).toUpperCase();
                let team2DisplayName = String(t2Name).toUpperCase();
                
                team1nameText.textItem.contents = team1DisplayName.length > 20 ? (team1DisplayName.slice(0, 20) + '...') : team1DisplayName;
                team2nameText.textItem.contents = team2DisplayName.length > 20 ? (team2DisplayName.slice(0, 20) + '...') : team2DisplayName;

                // Logos with fallback to LeagueLogo.png
                if (t1Found) {
                  const logo1Url = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(team1DivAbb)}/${encodeURIComponent(t1Full)}.png`;
                  let ok1 = await imageHandler.replaceLayerWithImage(logo1, logo1Url);
                  if (!ok1) ok1 = await imageHandler.replaceLayerWithImage(logo1, `LOGOS/TEAMS/${conf}/${team1DivAbb}/${t1Full}.png`, baseFolder);
                  if (!ok1) await imageHandler.replaceLayerWithImage(logo1, "LOGOS/LeagueLogo.png", baseFolder);
                } else {
                  await imageHandler.replaceLayerWithImage(logo1, "LOGOS/LeagueLogo.png", baseFolder);
                }

                if (t2Found) {
                  const logo2Url = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(team2DivAbb)}/${encodeURIComponent(t2Full)}.png`;
                  let ok2 = await imageHandler.replaceLayerWithImage(logo2, logo2Url);
                  if (!ok2) ok2 = await imageHandler.replaceLayerWithImage(logo2, `LOGOS/TEAMS/${conf}/${team2DivAbb}/${t2Full}.png`, baseFolder);
                  if (!ok2) await imageHandler.replaceLayerWithImage(logo2, "LOGOS/LeagueLogo.png", baseFolder);
                } else {
                  await imageHandler.replaceLayerWithImage(logo2, "LOGOS/LeagueLogo.png", baseFolder);
                }

                // Per-game date and facility
                if (dateLayer) dateLayer.textItem.contents = String(finalGames[i].date || '').toUpperCase();
                if (facilityLayer) facilityLayer.textItem.contents = String(finalGames[i].location || '').toUpperCase();

                // Time/Final values
                if (docType === 'Final Scores') {
                  if (score1) score1.textItem.contents = String(finalGames[i].score1 || '');
                  if (score2) score2.textItem.contents = String(finalGames[i].score2 || '');

                  const s1 = Number(finalGames[i].score1);
                  const s2 = Number(finalGames[i].score2);
                  const hasScores = !isNaN(s1) && !isNaN(s2);
                  const team1Wins = hasScores && s1 > s2;
                  const team2Wins = hasScores && s2 > s1;

                  // Pick a win highlight color: div color1 if luminance 0.5–0.75,
                  // else div color2 if luminance 0.5–0.75, else fallback orange
                  const lum1 = relativeLuminance(divColor1Hex);
                  const lum2 = relativeLuminance(divColor2Hex);
                  const winHex = // (lum1 >= 0.1 && lum1 <= 0.75) ? divColor1Hex
                               //: (lum2 >= 0.1 && lum2 <= 0.75) ? divColor2Hex :
                                'ff8400';

                  if (team1Wins) {
                    setTextHex(team1nameText, winHex);
                    if (score1) setTextHex(score1, winHex);
                  } else if (team2Wins) {
                    setTextHex(team2nameText, winHex);
                    if (score2) setTextHex(score2, winHex);
                  }
                } else {
                  if (timeLayer) timeLayer.textItem.contents = String(finalGames[i].time || '').toUpperCase();
                }
              }

              // Export per chunk
              divisionExportCounts[divAbb] = (divisionExportCounts[divAbb] || 0) + 1;
              const exportFile = await prepareScheduleExport(gamedayFolder, week, docType, divAbb, divisionExportCounts[divAbb]);
              const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, docType, exportFile.name);
              await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);

              previousDocId = doc._id;
              await doc.save();

            }, { commandName: `Update ${DOC_ID}` });
          }
        }
      }

    const selectedTag = input && input !== 'ALL' ? input : 'ALL';
    statusEl.textContent = `✅ ${DOC_ID} completed for ${selectedTag} (${activeDivs.length} divisions)`;
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

const getByName = (parent, name) => {
  const layers = parent.layers || parent;
  return layers.find(l => l.name === name);
};

function setTextHex(layer, hex) {
  if (!layer) return;
  const color = new app.SolidColor();
  color.rgb.hexValue = String(hex).replace(/^#/, '').toLowerCase();
  layer.textItem.characterStyle.color = color;
}


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

async function scaleLayer(layer, percent, anchor = 'center') {
  const value = Number(percent);
  if (!isFinite(value) || value <= 0) return;
  const anchorMap = {
    top: 'QCSTop', center: 'QCSAverage', bottom: 'QCSBottom',
    topLeft: 'QCSTopLeft', topRight: 'QCSTopRight',
    bottomLeft: 'QCSBottomLeft', bottomRight: 'QCSBottomRight'
  };
  const centerState = anchorMap[anchor] || 'QCSAverage';
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

function applyTeamRankFolder(rankFolder, powerRanking, tierName) {
  if (!rankFolder) return;

  const hasRanking = String(powerRanking ?? '').trim() !== '';
  rankFolder.visible = hasRanking;
  if (!hasRanking) return;

  const rankTextLayer = getByName(rankFolder, 'RANK');
  if (rankTextLayer && rankTextLayer.textItem) {
    rankTextLayer.textItem.contents = String(powerRanking).trim();
    rankTextLayer.visible = true;
  }

  const targetTier = String(tierName || '').trim().toUpperCase();
  if (!Array.isArray(rankFolder.layers)) return;

  for (let i = 0; i < rankFolder.layers.length; i++) {
    const layer = rankFolder.layers[i];
    if (!layer) continue;
    if (String(layer.name).toUpperCase() === 'RANK') continue;
    layer.visible = targetTier !== '' && String(layer.name || '').trim().toUpperCase() === targetTier;
  }
}

function applyTeamSeedFolder(seedFolder, seedValue) {
  if (!seedFolder) return;
  const hasSeed = String(seedValue ?? '').trim() !== '';
  seedFolder.visible = hasSeed;
  if (!hasSeed) return;
  const seedTextLayer = getByName(seedFolder, 'SEED');
  if (seedTextLayer && seedTextLayer.textItem) {
    seedTextLayer.textItem.contents = String(seedValue).trim();
    seedTextLayer.visible = true;
  }
}

function setTextColor(layer, backgroundColor) {
  if (!layer || !layer.textItem) return;
  const color = new app.SolidColor();
  const luminance = relativeLuminance(backgroundColor);
  color.rgb.hexValue = luminance >= 0.7 ? '252525' : 'ffffff';
  layer.textItem.characterStyle.color = color;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rs = r / 255;
  const gs = g / 255;
  const bs = b / 255;
  const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const rl = toLinear(rs);
  const gl = toLinear(gs);
  const bl = toLinear(bs);
  return (0.2126 * rl) + (0.7152 * gl) + (0.0722 * bl);
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
async function prepareScheduleExport(gamedayFolder, week, docType, divAbb, sequenceNumber) {
  const weekFolderName = `Week ${week}`;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, docType]);
  const safeDivAbb = sanitizeFilename(divAbb);
  const n = Number(sequenceNumber) || 1;
  const fileName = `${safeDivAbb}_Schedule_${n}.png`;
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
