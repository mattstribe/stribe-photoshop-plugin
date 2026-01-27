const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const logoHandler = require("./logoHandler.js");
const exportHandler = require("./exportHandler.js");
const bracketHandler = require("./bracket.js");
const fs = require("uxp").storage.localFileSystem;

// Small delay helper (used when closing previous doc)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Document identifiers for this script
const DOC_ID = 'STANDINGS';       // folder + template basename (e.g., STANDINGS/STANDINGS.psd)
const DOC_EXPORT = 'Standings';    // export folder + filename prefix

// Function to handle STANDINGS Update
async function handleStandingsUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  
  // Read cloud export checkbox state BEFORE entering executeAsModal
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {

    /////INITIALIZE ALL INFORMATION/////

    // Clear cached URLs/branding for this league so each run sees fresh sheet data
    await leagueConfig.invalidateLeagueCache(baseFolder);

    // Load league config, structured standings objects, and schedule data
    const [leagueData, standingsData, scheduleData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadStandings(baseFolder),
      leagueConfig.loadSchedule(baseFolder)
    ]);

    const { divs, confs, teams } = leagueData;
    const { schedule, week, year } = scheduleData;

    // Get user division input from UI (converts abbreviations automatically)
    const userDiv = leagueConfig.getUserDivision(divs);
    console.log(`Selected division for STANDINGS: ${userDiv}`);

    // Use structured standings objects from leagueConfig
    const teamStats = standingsData;

    // Build active divisions list.
    // By default, we only run for divisions that have games in the current week.
    // If the "allDivisionsCheckbox" is checked in the UI, we instead run
    // STANDINGS for every division (or the specific division selected),
    // regardless of whether they have games this week.
    const activeDivs = [];
    const allDivsCheckbox = document.getElementById("allDivisionsCheckbox");
    const runAllDivs = !!(allDivsCheckbox && allDivsCheckbox.checked);

    if (runAllDivs) {
      if (userDiv === 'ALL') {
        // One "virtual" game per division, carrying just conf/division1
        for (let m = 0; m < divs.length; m++) {
          const d = divs[m];
          activeDivs.push([{ conf: d.conf, division1: d.div }]);
        }
      } else {
        // A specific division was selected; find its conf/div and build one entry
        for (let m = 0; m < divs.length; m++) {
          const d = divs[m];
          const confDiv = d.conf + ' ' + d.div;
          if (confDiv === userDiv) {
            activeDivs.push([{ conf: d.conf, division1: d.div }]);
            break;
          }
        }
      }
    } else {
      // Original behavior: divisions with at least one game this week or next week
      // (needed to detect playoff games in next week)
      if (userDiv === 'ALL') {
        for (let m = 0; m < divs.length; m++) {
          const divGames = [];
          for (let n = 0; n < schedule.length; n++) {
            const isSameDiv = (schedule[n].conf + ' ' + schedule[n].division1) === (divs[m].conf + ' ' + divs[m].div);
            const gameWeek = Number(schedule[n].week);
            const isWeek = gameWeek === week || gameWeek === week + 1;
            if (isSameDiv && isWeek) 
              divGames.push(schedule[n]);
          }
          if (divGames.length !== 0) activeDivs.push(divGames);
        }
      } else {
        const divGames = [];
        for (let n = 0; n < schedule.length; n++) {
          const isSameDiv = (schedule[n].conf + ' ' + schedule[n].division1) === userDiv;
          const gameWeek = Number(schedule[n].week);
          const isWeek = gameWeek === week || gameWeek === week + 1;
          if (isSameDiv && isWeek) 
            divGames.push(schedule[n]);
        }
        if (divGames.length !== 0) activeDivs.push(divGames);
      }
    }

    ///// SEPARATE INFORMATION INTO DIVISIONS /////


    // Track previously opened doc id so we can close it after the next opens (when running ALL)
    let previousDocId = null;

    // Run for each active division
    for (let d = 0; d < activeDivs.length; d++) {
      //create arrays for games in each division
      const divisionGames = activeDivs[d]
      //define division
      const confDiv = divisionGames[0].conf + ' ' + divisionGames[0].division1
      const division = divisionGames[0].division1

      // Build teams for this division
      const divTeams = [];

      //put teams into standings array
      for (let i = 0; i < teamStats.length; i++) {
        if (teamStats[i].div === confDiv) 
          divTeams.push(teamStats[i]);
      }
      if (divTeams.length === 0) continue;


      // Convert division to abbreviations and conference
      let divAbb = null;
      let conf = null;
      for (let i = 0; i < divs.length; i++) {
        if (confDiv === divs[i].conf + ' ' + divs[i].div) {
          divAbb = divs[i].abb;
          conf = divs[i].conf;
          break;
        }
      }

      // Conference info (location/timezone)
      let confTimeZone = null;
      let confLocation = null;
      for (let i=0; i < confs.length; i++){
        if (confs[i].conf === conf) {
          confTimeZone = confs[i].timeZone;
          confLocation = confs[i].location;
          break;
        }
      }

      // Division color (per division, not overall conference)
      let divColorHex = 'ffffff';
      for (let i = 0; i < divs.length; i++) {
        if (divs[i].abb === divAbb) {
          divColorHex = String(divs[i].color1);
          break;
        }
      }

      // Check if this division has playoff games in current week or next week
      let hasPlayoffGames = false;
      for (let i = 0; i < schedule.length; i++) {
        const game = schedule[i];
        const gameConfDiv = game.conf + ' ' + game.division1;
        const gameWeek = Number(game.week);
        if (gameConfDiv === confDiv && game.gameType === 'Playoffs' && (gameWeek === week || gameWeek === week + 1)) {
          hasPlayoffGames = true;
          break;
        }
      }

      // Navigate folders
      const automationsFolder = await baseFolder.getEntry('Automations');
      const gamedayFolder = await automationsFolder.getEntry('Gameday Graphics');
      const templateFolder = await gamedayFolder.getEntry(DOC_ID);

      // Build logo source configuration (online vs local)
      const { logoSource, logosFolder } = await logoHandler.buildLogoSource(baseFolder, conf, divAbb);

      // If division has playoff games (current or next week), run bracket.js
      // This can run in addition to standings if division also has regular season games
      if (hasPlayoffGames) {
        const divisionData = {
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
          templateFolder,
          logoSource,
          logosFolder
        };
        const newDocId = await bracketHandler.handleBracketUpdate(baseFolder, divisionData);
        if (userDiv === 'ALL') {
          previousDocId = newDocId;
        }
        // Continue to also process standings if division has regular season games
      }

      // Check if this division has regular season games in current week
      // If allDivisionsCheckbox is checked, run standings for all divisions regardless
      let hasRegularSeasonGames = runAllDivs; // Default to true if running all divs
      if (!runAllDivs) {
        for (let i = 0; i < schedule.length; i++) {
          const game = schedule[i];
          const gameConfDiv = game.conf + ' ' + game.division1;
          const gameWeek = Number(game.week);
          if (gameConfDiv === confDiv && game.gameType !== 'Playoffs' && gameWeek === week) {
            hasRegularSeasonGames = true;
            break;
          }
        }
      }

      // Only run standings if division has regular season games in current week (or if running all divs)
      if (!hasRegularSeasonGames) {
        continue; // Skip standings processing for this division
      }

      // Build final standings in order (regular season only)
      const nullTeam = { fullTeam: null, div: null, gp: 0, w: 0, otw: 0, otl: 0, l: 0, pts: 0, diff: 0, pct: 0, gf: 0, ga: 0 };
      const standings = [];
      //initialize blank standings
      for (let i = 0; i < divTeams.length; i++) 
        standings.push(nullTeam);

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
        if (userDiv === 'ALL' && previousDocId) {
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
        const table = getByName(doc, 'TABLE');

        // Header updates
        const divisionText = getByName(header, 'DIVISION');
        const locationText = getByName(header, 'LOCATION');
        const divisionColorLayer = getByName(header, 'HEADER COLOR');

        divisionText.textItem.contents = division.toUpperCase();
        locationText.textItem.contents = confLocation.toUpperCase();
        // division fill color
        await fillColor(divisionColorLayer, divColorHex);

        // Sort teams by rank property from spreadsheet
        let standings = divTeams.slice().sort((a, b) => {
          const rankA = Number(a.rank) || 999;
          const rankB = Number(b.rank) || 999;
          return rankA - rankB;
        });

        const numOfTeams = standings.length;

        // Split standings into chunks where all chunks except the last
        // have the same size, and no chunk is larger than MAX_TEAMS_PER_CHUNK.
        // Examples:
        //  - 12 teams  -> 6 + 6
        //  - 15 teams  -> 8 + 7
        //  - 19 teams  -> 7 + 7 + 5
        //  - 20 teams  -> 7 + 7 + 6
        const MAX_TEAMS_PER_CHUNK = 9;
        const chunks = [];
        if (numOfTeams <= MAX_TEAMS_PER_CHUNK) {
          chunks.push(standings);
        } else {
          const numChunks = Math.ceil(numOfTeams / MAX_TEAMS_PER_CHUNK);
          const chunkSize = Math.ceil(numOfTeams / numChunks); // size for all but last

          let startIndex = 0;
          for (let c = 0; c < numChunks; c++) {
            const isLast = (c === numChunks - 1);
            const endIndex = isLast ? numOfTeams : startIndex + chunkSize;
            const chunk = standings.slice(startIndex, endIndex);
            if (chunk.length) chunks.push(chunk);
            startIndex = endIndex;
          }
        }

        let finalStandings = [];
        let processedBefore = 0; // how many teams we've already ranked in previous chunks

        for (let h = 0; h < chunks.length; h++){
          if (chunks[h].length == 0)
            break;
          else
            finalStandings = chunks[h]
 
          //STANDINGS UPDATE
          for (let i = 0; i < finalStandings.length; i++) {
            //TABLE UPDATE
            //Create boxes for number of teams if not existing
            const chunkTeams = finalStandings.length
            
            if (table.layers.length === 2) {
              const baseStep = 140; // original vertical spacing between rows

              if (chunkTeams <= 6) {
                await translate(table, 0, 200 - (30 * (chunkTeams)));
                for (let p = 2; p < chunkTeams + 1; p++) {
                  const teamX = getByName(table, `TEAM ${p-1}`);
                  if (!teamX) break;
                  await duplicate(teamX, `TEAM ${p}`, 0, baseStep);
                }
              } 
              else if (chunkTeams ==  7) {
                for (let p = 2; p < chunkTeams + 1; p++) {
                  const teamX = getByName(table, `TEAM ${p-1}`);
                  if (!teamX) break;
                  await duplicate(teamX, `TEAM ${p}`, 0, baseStep - 15);
                }
              }
              else if (chunkTeams ==  8) {
                await translate(table, 0, -10);
                let scale = 90
                scaleLayer(table, scale)
                const step = Math.round((baseStep - 15) * (scale/100))
                for (let p = 2; p < chunkTeams + 1; p++) {
                  const teamX = getByName(table, `TEAM ${p-1}`);
                  if (!teamX) break;
                  await duplicate(teamX, `TEAM ${p}`, 0, step);
                }
              }
              else if (chunkTeams ==  9) {
                await translate(table, 0, -10);
                let scale = 80
                scaleLayer(table, scale)
                const step = Math.round((baseStep - 15) * (scale/100))
                for (let p = 2; p < chunkTeams + 1; p++) {
                  const teamX = getByName(table, `TEAM ${p-1}`);
                  if (!teamX) break;
                  await duplicate(teamX, `TEAM ${p}`, 0, step);
                }
              }
            }

            // Hide any extra TEAM slots above chunkTeams so that, for example,
            // a 15-team division split into 9 + 6 only shows 6 rows on the
            // second page instead of all 9.
            for (let extraIndex = chunkTeams + 1; ; extraIndex++) {
              const extraTeam = getByName(table, `TEAM ${extraIndex}`);
              if (!extraTeam) break;
              extraTeam.visible = false;
            }

            //define current standings folder
            const j = i + 1;
            const teamX = getByName(table, 'TEAM ' + j);
            // Get team info layers
            const rankText = getByName(teamX, 'RANK');
            const teamColorLayer = getByName(teamX, 'TEAM COLOR');
            const teamNameLayer = getByName(teamX, 'TEAM NAME');
            const teamLogoLayer = getByName(teamX, 'LOGO');
            // Get stat info layers
            const gpText = getByName(teamX, 'GP');
            const winText = getByName(teamX, 'W');
            const lossText = getByName(teamX, 'L');
            const otlText = getByName(teamX, 'OTL') || getByName(teamX, 'T');
            const otwText = getByName(teamX, 'OTW');
            const ptsText = getByName(teamX, 'PTS');
            const pctText = getByName(teamX, 'PT%');

            // Team color and logo lookup
            let tColor = '000000';
            let tName = '';
            for (let c = 0; c < teams.length; c++) {
              if (teams[c].fullTeam === finalStandings[i].fullTeam) {
                tColor = teams[c].color1;
                tName = teams[c].teamName;
                tFull = teams[c].fullTeam;
                break;
              }
            }

            //update team information
            await fillColor(teamColorLayer, tColor);
            await logoHandler.replaceLogo(teamLogoLayer, logoSource, tFull, logosFolder, 'STANDINGS');

            // Text updates
            teamNameLayer.textItem.contents = (() => { const u = String(tName).toUpperCase(); return u.length > 20 ? (u.slice(0, 20) + '...') : u; })();
            // Global rank across all chunks: offset by how many teams we've
            // already placed in prior chunks.
            rankText.textItem.contents = String(processedBefore + j);
            gpText.textItem.contents = finalStandings[i].gp;
            winText.textItem.contents = finalStandings[i].w;
            lossText.textItem.contents = finalStandings[i].l;
            otlText.textItem.contents = finalStandings[i].otl;
            if (otwText) otwText.textItem.contents = finalStandings[i].otw;
            ptsText.textItem.contents = finalStandings[i].pts;
            pctText.textItem.contents = finalStandings[i].pct;

            // Text color based on background
            setTextColor(teamNameLayer, tColor);
            setTextColor(gpText, tColor);
            setTextColor(winText, tColor);
            setTextColor(lossText, tColor);
            setTextColor(otlText, tColor);
            if (otwText) setTextColor(otwText, tColor);
            setTextColor(ptsText, tColor);
            setTextColor(pctText, tColor);
          }

          // After finishing this chunk, record how many teams we've output so far
          processedBefore += finalStandings.length;

          // Export PNG to Exports/Week {week}/Standings
          const exportFile = await prepareStandingsExport(gamedayFolder, week, divAbb, h);
          const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, exportFile.name);
          await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);
        }
        // If processing ALL, remember this doc to close after the next opens
        if (userDiv === 'ALL') 
          previousDocId = doc._id;

        await doc.save();
      }, { commandName: "Update STANDINGS" });
    }

    if (userDiv === 'ALL') {
      statusEl.innerHTML = `✅ Updated ${activeDivs.length} divisions`;
    } else {
      statusEl.innerHTML = `✅ Updated ${userDiv}`;
    }
  } catch (err) {
    statusEl.textContent = "⚠️ Error updating STANDINGS";
    console.error("Error:", err);
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


function compareTeams(team1, team2, sortConfig) {
  for (let i = 0; i < sortConfig.length; i++) {
    const stat = sortConfig[i].stat;
    const direction = sortConfig[i].direction;
    const value1 = Number(team1[stat]);
    const value2 = Number(team2[stat]);
    if (value1 != value2) {
      if (direction == 'desc') {
          return value1 > value2;  // Higher is better
      } else {
          return value1 < value2;  // Lower is better
      }
    }
  // If equal, continue to next tiebreaker
  }
  return false;
}

function computeStandings(divTeams, order) {
  const nullTeam = { fullTeam: null, div: null, gp: 0, w: 0, otw: 0, otl: 0, l: 0, pts: 0, diff: 0, pct: 0, gf: 0, ga: 0 };
  const standings = [];
  for (let i = 0; i < divTeams.length; i++) standings.push(nullTeam);

  for (let m = 0; m < standings.length; m++) {
    for (let n = 0; n < divTeams.length; n++) {
      let unique = true;
      for (let p = 0; p < m; p++) {
        if (divTeams[n].fullTeam == standings[p].fullTeam) { unique = false; break; }
      }
      if (unique && compareTeams(divTeams[n], standings[m], order)) {
        standings[m] = divTeams[n];
      }
      if (unique && Number(standings[m].gp) == 0) {
        standings[m] = divTeams[n];
      }
    }
  }
  return standings;
}

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

// Prepare and return a FileEntry for Standings PNG export
async function prepareStandingsExport(gamedayFolder, week, divAbb, chunkIndex) {
  const weekFolderName = `Week ${week}`;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, DOC_EXPORT]);
  const suffix = (typeof chunkIndex === 'number') ? `_${chunkIndex + 1}` : '';
  const exportFileName = `${divAbb}_${DOC_EXPORT}${suffix}.png`;
  return await exportFolder.createFile(exportFileName, { overwrite: true });
}


// Export the functions
module.exports = {
  handleStandingsUpdate
};
