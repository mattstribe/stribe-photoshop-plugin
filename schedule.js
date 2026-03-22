const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const imageHandler = require("./imageHandler.js");
const exportHandler = require("./exportHandler.js");

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

    // Iterate divisions
    for (let d = 0; d < activeDivs.length; d++) {
      const divGames = activeDivs[d];
      const divAbb = divGames[0].div1;
      const division = divGames[0].division1
      const conf = divGames[0].conf;

      // Counter for export filenames — resets to 1 for each division
      let fileCounter = 1;

      // Division color + conference location
      let divColorHex = 'ffffff';
      let divTimeZone = '';
      let divLocation = '';
      for (let i = 0; i < divs.length; i++) {
        if (divs[i].abb === divAbb) { divColorHex = divs[i].color1; divTimeZone = divs[i].timeZone || ''; break; }
      }
      for (let i = 0; i < confs.length; i++) {
        if (confs[i].conf === conf) { divLocation = confs[i].location; break; }
      }

      // Group by date (unique dates within this division)
      const uniqueDates = [];
      for (let j = 0; j < divGames.length; j++) {
        const gameDate = divGames[j].date;
        if (!uniqueDates.includes(gameDate)) uniqueDates.push(gameDate);
      }

      const dates = [];
      for (let i = 0; i < uniqueDates.length; i++) {
        const dayGames = divGames.filter(g => g.date === uniqueDates[i]);
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

            // Show which division/date and how many games are on this graphic
            statusEl.innerHTML = `Updating ${divAbb} ${dateShort} (${finalGames.length} games)...`;

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
              const docTypeSuffix = docType === 'Final Scores' ? 'FS' : 'UG';
              const chunkSuffix = (chunks.length > 1 && chunks[1] && chunks[1].length > 0) ? `_${a}` : '';
              const workingFileName = `${divAbb}_${DOC_ID}_working_${dayName}_${docTypeSuffix}${chunkSuffix}.psd`;
              const saveFile = await workingFolder.createFile(sanitizeFilename(workingFileName), { overwrite: true });
              if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
              const header = getByName(doc, 'HEADER');
              const matchups = getByName(doc, 'MATCHUPS');
              const background = getByName(doc, 'BACKGROUND');
              const sponsorsFolder = getByName(doc, 'Sponsors');
              const sponsorBar = sponsorsFolder ? getByName(sponsorsFolder, 'SPONSOR BAR') : null;
              const backgroundBlack = background ? getByName(background, 'BLACK') : null;
              const backgroundWhite = background ? getByName(background, 'WHITE') : null;

              // Header layers
              const headerText = getByName(header, 'HEADING');
              const dateText = getByName(header, 'DATE');
              const divisionText = getByName(header, 'DIVISION');
              const emblemLayer = getByName(header, 'EMBLEM');
              //const locationText = getByName(header, 'LOCATION');
              const divisionColorLayer = getByName(header, 'HEADER COLOR');

              // Set header
              let headerTextValue;
              if (docType === 'Final Scores') {
                headerTextValue = 'FINAL SCORES';
              } else if (gameType === 'Playoffs') {
                headerTextValue = 'PLAYOFFS';
              } else {
                headerTextValue = 'UPCOMING GAMES';
              }
              headerText.textItem.contents = headerTextValue;
              dateText.textItem.contents = String(dateValue).toUpperCase();
              if (divisionText) {
                divisionText.textItem.contents = (division + ' ' + conf).toUpperCase();
              }
              const tierFolder = getByName(header, 'TIER');
              if (tierFolder) {
                for (let i = 0; i < tierFolder.layers.length; i++) {
                  tierFolder.layers[i].visible = (tierFolder.layers[i].name === conf);
                }
              }
              if (emblemLayer) {
                await imageHandler.replaceLayerWithImage(emblemLayer, `LOGOS/Division Emblems/PNG/${divAbb}_emblem.png`, baseFolder);
              }

              const sponsorDir = 'LOGOS/Sponsor/Division Sponsors/Sponsor Bars/';
              let sponsorSuffix = '';
              if (backgroundBlack) sponsorSuffix = 'BLACK';
              else if (backgroundWhite) sponsorSuffix = 'WHITE';
              const sponsorBaseFile = divAbb + '_Sponsors.psd';
              const sponsorBasePath = sponsorDir + sponsorBaseFile;
              let ok = false;
              if (sponsorSuffix) {
                const sponsorVariantFile = divAbb + '_Sponsors_' + sponsorSuffix + '.psd';
                const variantPath = sponsorDir + sponsorVariantFile;
                ok = await imageHandler.replaceLayerWithImage(sponsorBar, variantPath, baseFolder);
              }
              if (!ok) {
                await imageHandler.replaceLayerWithImage(sponsorBar, sponsorBasePath, baseFolder);
              }
            

              //locationText.textItem.contents = String(divLocation).toUpperCase();
              await fillColor(divisionColorLayer, divColorHex);

              // Dynamic box creation using AREA layer bounds
              const numOfGames = finalGames.length;
              const areaLayer = background ? getByName(background, 'AREA') : null;
              if (!areaLayer) throw new Error("AREA layer not found in BACKGROUND group");

              const areaBounds = areaLayer.boundsNoEffects;
              const maxAreaHeight = Math.abs(areaBounds.bottom - areaBounds.top);

              const match1 = getByName(matchups, 'MATCH 1');
              const match1Bounds = match1.boundsNoEffects;
              const boxHeight = Math.abs(match1Bounds.bottom - match1Bounds.top);

              const defaultSpacing = boxHeight * 0.05;
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

                const roundText = getByName(matchX, 'ROUND');

                // Team layers
                const color1 = getByName(matchX, 'TEAM 1 COLOR');
                const color2 = getByName(matchX, 'TEAM 2 COLOR');
                const logo1 = getByName(matchX, 'TEAM 1 LOGO');
                const logo2 = getByName(matchX, 'TEAM 2 LOGO');
                const team1RankFolder = getByName(matchX, 'TEAM 1 RANK');
                const team2RankFolder = getByName(matchX, 'TEAM 2 RANK');

                // Time/final groups
                const timeFolder = getByName(matchX, 'TIME');
                const finalFolder = getByName(matchX, 'FINAL SCORE');
                const timeLayer = timeFolder ? getByName(timeFolder, 'TIME') : null;
                const timeZoneLayer = timeFolder ? getByName(timeFolder, 'TIME ZONE') : null;
                const team1nameText = getByName(timeFolder, 'TEAM 1 NAME');
                const team2nameText = getByName(timeFolder, 'TEAM 2 NAME');
                const score1 = finalFolder ? getByName(finalFolder, 'SCORE 1') : null;
                const score2 = finalFolder ? getByName(finalFolder, 'SCORE 2') : null;
                const finalText = finalFolder ? getByName(finalFolder, 'FINAL') : null;
                const win1 = finalFolder ? getByName(finalFolder, 'WIN 1') : null;
                const win2 = finalFolder ? getByName(finalFolder, 'WIN 2') : null;
                const box1 = finalFolder ? getByName(finalFolder, 'BOX 1') : null;
                const box2 = finalFolder ? getByName(finalFolder, 'BOX 2') : null;

                // Determine division abb for logos path
                const divAbb = finalGames[i].div1;
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
                let t1Tier = conf;
                let t1PowerRanking = '';
                let t1Found = false;
                for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === finalGames[i].team1) {
                    t1Color = teams[c].color1;
                    t1Name = teams[c].teamName;
                    t1Tier = teams[c].conf || conf;
                    t1PowerRanking = teams[c].powerRanking || '';
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
                let t2Tier = conf;
                let t2PowerRanking = '';
                let t2Found = false;
                for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === finalGames[i].team2) {
                    t2Color = teams[c].color1;
                    t2Name = teams[c].teamName;
                    t2Tier = teams[c].conf || conf;
                    t2PowerRanking = teams[c].powerRanking || '';
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

                // Power rank badges (if PR exists): show folder, set rank text, and
                // show only the tier layer matching the team tier.
                applyTeamRankFolder(team1RankFolder, t1PowerRanking, t1Tier || conf);
                applyTeamRankFolder(team2RankFolder, t2PowerRanking, t2Tier || conf);

                // Text color: black on white team color, white otherwise
                const textColor1 = new app.SolidColor();
                textColor1.rgb.hexValue = t1Color.replace(/^#/, '').toLowerCase() === 'ffffff' ? '000000' : 'ffffff';
                team1nameText.textItem.characterStyle.color = textColor1;
                const textColor2 = new app.SolidColor();
                textColor2.rgb.hexValue = t2Color.replace(/^#/, '').toLowerCase() === 'ffffff' ? '000000' : 'ffffff';
                team2nameText.textItem.characterStyle.color = textColor2;

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

                // Round label – only for Playoffs
                if (finalGames[i].gameType === 'Playoffs' && roundText) {
                  roundText.textItem.contents = String(finalGames[i].round || '').toUpperCase();
                }

                // Time/Final values
                if (docType === 'Final Scores') {
                  if (score1) score1.textItem.contents = String(finalGames[i].score1 || '');
                  if (score2) score2.textItem.contents = String(finalGames[i].score2 || '');

                  const s1 = Number(finalGames[i].score1);
                  const s2 = Number(finalGames[i].score2);
                  const hasScores = !isNaN(s1) && !isNaN(s2);
                  const team1Wins = hasScores && s1 > s2;
                  const team2Wins = hasScores && s2 > s1;

                  if (win1) win1.visible = team1Wins;
                  if (win2) win2.visible = team2Wins;
                  if (box1) await fillColor(box1, team1Wins ? 'ffffff' : '535353');
                  if (box2) await fillColor(box2, team2Wins ? 'ffffff' : '535353');
                } else {
                  if (timeLayer) timeLayer.textItem.contents = String(finalGames[i].time || '').toUpperCase();
                  if (timeZoneLayer) timeZoneLayer.textItem.contents = String(divTimeZone || '').toUpperCase();
                }
              }

              // Export per chunk
              const exportFile = await prepareScheduleExport(gamedayFolder, week, docType, divAbb, fileCounter);
              const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, docType, exportFile.name);
              await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);
              fileCounter++;

              previousDocId = doc._id;
              await doc.save();

            }, { commandName: `Update ${DOC_ID}` });
          }
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
async function prepareScheduleExport(gamedayFolder, week, docType, divAbb, fileCounter) {
  const weekFolderName = `Week ${week}`;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, docType]);
  const fileName = `${divAbb}_SCHEDULE_${fileCounter}.png`;
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
