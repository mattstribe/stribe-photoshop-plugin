const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const imageHandler = require("./imageHandler.js");
const exportHandler = require("./exportHandler.js");
const fs = require("uxp").storage.localFileSystem;

// Helper function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Document identifiers for this script
const DOC_ID = 'STATS';          // folder + template basename (e.g., STATS/STATS.psd)
const DOC_EXPORT = 'Stats';       // export folder + filename prefix

// STATS Update Logic
async function handleStatsUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  
  // Read cloud export checkbox state BEFORE entering executeAsModal
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {

    /////INITIALIZE ALL INFORMATION/////

    // Clear cached URLs/branding for this league so each run sees fresh sheet data
    await leagueConfig.invalidateLeagueCache(baseFolder);

    // Load all data in parallel for maximum speed (including playoff stats)
    const [leagueData, playerStats, goalieStats, playoffPlayerStats, playoffGoalieStats, scheduleData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadPlayerStats(baseFolder),
      leagueConfig.loadGoalieStats(baseFolder),
      leagueConfig.loadPlayoffPlayerStats(baseFolder),
      leagueConfig.loadPlayoffGoalieStats(baseFolder),
      leagueConfig.loadSchedule(baseFolder)
    ]);

    // Destructure the loaded data
    const { divs, confs, teams } = leagueData;
    const { schedule, week, year } = scheduleData;

    // Get user division input from UI (converts abbreviations automatically)
    const userDiv = leagueConfig.getUserDivision(divs);
    console.log(`Selected division: ${userDiv}`);

    // Build activeDivs from schedule, separated by gameType (regular season vs playoffs).
    // By default we only run STATS for divisions that have games in the current week or next week.
    // If the "allDivisionsCheckbox" is checked in the UI, we instead run STATS
    // for every division (or just the selected one) regardless of games.
    const activeRegularDivs = [];
    const activePlayoffDivs = [];
    const allDivsCheckbox = document.getElementById("allDivisionsCheckbox");
    const runAllDivs = !!(allDivsCheckbox && allDivsCheckbox.checked);

    if (runAllDivs) {
      if (userDiv == 'ALL') {
        for (let m = 0; m < divs.length; m++) {
          const d = divs[m];
          // Create virtual game objects for both regular and playoff
          activeRegularDivs.push([{ conf: d.conf, division1: d.div, gameType: 'Regular Season' }]);
          activePlayoffDivs.push([{ conf: d.conf, division1: d.div, gameType: 'Playoffs' }]);
        }
      } else {
        for (let m = 0; m < divs.length; m++) {
          const d = divs[m];
          const confDiv = d.conf + ' ' + d.div;
          if (confDiv === userDiv) {
            activeRegularDivs.push([{ conf: d.conf, division1: d.div, gameType: 'Regular Season' }]);
            activePlayoffDivs.push([{ conf: d.conf, division1: d.div, gameType: 'Playoffs' }]);
            break;
          }
        }
      }
    } else {
      if (userDiv == 'ALL') {
        for (let m = 0; m < divs.length; m++) {
          const regularGames = [];
          const playoffGames = [];
          for (let n = 0; n < schedule.length; n++) {
            const isSameDiv = (schedule[n].conf + ' ' + schedule[n].division1) === (divs[m].conf + ' ' + divs[m].div);
            const gameWeek = Number(schedule[n].week);
            const isWeek = gameWeek === week || gameWeek === week + 1; // Include next week for playoffs
            if (isSameDiv && isWeek) {
              if (schedule[n].gameType === 'Playoffs') {
                playoffGames.push(schedule[n]);
              } else {
                regularGames.push(schedule[n]);
              }
            }
          }
          if (regularGames.length !== 0) activeRegularDivs.push(regularGames);
          if (playoffGames.length !== 0) activePlayoffDivs.push(playoffGames);
        }
      } else {
        const regularGames = [];
        const playoffGames = [];
        for (let n = 0; n < schedule.length; n++) {
          const isSameDiv = (schedule[n].conf + ' ' + schedule[n].division1) === userDiv;
          const gameWeek = Number(schedule[n].week);
          const isWeek = gameWeek === week || gameWeek === week + 1; // Include next week for playoffs
          if (isSameDiv && isWeek) {
            if (schedule[n].gameType === 'Playoffs') {
              playoffGames.push(schedule[n]);
            } else {
              regularGames.push(schedule[n]);
            }
          }
        }
        if (regularGames.length !== 0) activeRegularDivs.push(regularGames);
        if (playoffGames.length !== 0) activePlayoffDivs.push(playoffGames);
      }
    }
    
    ///// SEPARATE INFORMATION INTO DIVISIONS /////

    // Track previously opened doc id so we can close it after the next opens
    let previousDocId = null;

    // Helper function to process a division with given stats and template
    const processDivision = async (divisionGames, isPlayoff) => {
      const statsToUse = isPlayoff ? playoffPlayerStats : playerStats;
      const goalieStatsToUse = isPlayoff ? playoffGoalieStats : goalieStats;
      const templateName = isPlayoff ? 'STATS_Playoffs' : DOC_ID;

      //create arrays for games in each division
      //define division 
      const confDiv = divisionGames[0].conf + ' ' + divisionGames[0].division1
      const division = divisionGames[0].division1

      //build player stat array
      const divPlayerStats = []

      //put division players into stat array
      for (let i=0; i<statsToUse.length; i++){
          if (statsToUse[i].div === confDiv){
              divPlayerStats.push(statsToUse[i])
          }
      }    

      if (divPlayerStats.length < 5)
          return; // Skip if not enough players

      //build goalie stat array
      const divGoalieStats = []
      
      //put division goalies into stat array
      for (let i=0; i<goalieStatsToUse.length; i++){
          if (goalieStatsToUse[i].div === confDiv){
              divGoalieStats.push(goalieStatsToUse[i])
          }
      }

      //convert division to abbreviations and tier
      let divAbb = null;
      let conf = null;
      for (let i=0; i < divs.length; i++){
          if (confDiv === divs[i].conf + " " + divs[i].div){
              divAbb = divs[i].abb
              conf = divs[i].conf
              break;
          }
      }


      //get conference info from confs array (location/timezone)
      let confTimeZone = null;
      let confLocation = null;
      for (let i=0; i < confs.length; i++){
          if (confs[i].conf === conf) {
              confTimeZone = confs[i].timeZone
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

      //DEFINE NULL PLAYER
      const nullPlayer = {
          firstName: null,
          lastName: null,
          teamName: null,
          div: null,
          goals: 0,
          assists: 0,
          points: 0,
          ppg: 0,
      }

      //SET UP TOP POINT SCORERS
      const topPoints = [nullPlayer, nullPlayer, nullPlayer, nullPlayer, nullPlayer]

      for (let m = 0; m < 5; m++) { // For each point slot
          for (let n = 0; n < divPlayerStats.length; n++) { // Cycle through all players and find the highest scorer

              const pointsGreater = Number(divPlayerStats[n].points) > Number(topPoints[m].points);
              const pointsEqual = Number(divPlayerStats[n].points) === Number(topPoints[m].points);
              const goalsGreater = Number(divPlayerStats[n].goals) > Number(topPoints[m].goals);
      
              let shouldAssign = true;
              for (let p = 0; p < m; p++) { // Check each previous point slot
                  if (divPlayerStats[n].fullName === topPoints[p].fullName) {
                      shouldAssign = false; // Player already exists in the top list
                      break; // Exit early if player is already in the list
                  }
              }

              if (shouldAssign) { // assign the player if they are better than the current one in slot m
                  if (pointsGreater || (pointsEqual && goalsGreater)) {
                      topPoints[m] = divPlayerStats[n];
                  }
              }
          }
      }

      //SET UP TOP GOAL SCORERS
      let topGoals = [nullPlayer, nullPlayer, nullPlayer]

      for (let m=0; m<3; m++){ //for each goal slot
          for (let n=0; n<divPlayerStats.length; n++){ //cycle through all players and replace goal slot with highest scorer
              if (Number(divPlayerStats[n].goals) > Number(topGoals[m].goals)){
                  if (m===0){
                      topGoals[m] = divPlayerStats[n]
                  }
                  else if (m===1){
                      if ( !(divPlayerStats[n].fullName === topGoals[0].fullName))
                          topGoals[m] = divPlayerStats[n]
                  }
                  else if (m===2){
                      if ( !(divPlayerStats[n].fullName === topGoals[0].fullName || divPlayerStats[n].fullName === topGoals[1].fullName))
                          topGoals[m] = divPlayerStats[n]
                  }
              }
          }
      }

      //SET UP TOP PPG SCORERS
      let topPPG = [nullPlayer, nullPlayer, nullPlayer]

      for (let m=0; m<3; m++){ //for each goal slot
          for (let n=0; n<divPlayerStats.length; n++){ //cycle through all players and replace goal slot with highest scorer
              if (Number(divPlayerStats[n].ppg) > Number(topPPG[m].ppg)){
                  if (m===0){
                      topPPG[m] = divPlayerStats[n]
                  }
                  else if (m===1){
                      if ( !(divPlayerStats[n].fullName === topPPG[0].fullName))
                          topPPG[m] = divPlayerStats[n]
                  }
                  else if (m===2){
                      if ( !(divPlayerStats[n].fullName === topPPG[0].fullName || divPlayerStats[n].fullName === topPPG[1].fullName))
                          topPPG[m] = divPlayerStats[n]
                  }
              }
          }
      }

      //SET UP TOP GAA
      //First, find max number of games played
      let GPmax = 0 //set initial max games played at 0

      for (let n=0; n<divGoalieStats.length; n++){ //cycle through div goalie stats, if a goalie has more GP than the previous, make it the new GP max
          if (Number(divGoalieStats[n].GP) > GPmax)
              GPmax = Number(divGoalieStats[n].GP)
          
      }
      const GPmin = Math.round(0.44*GPmax)

      //define null goalie
      const nullGoalie = {
          firstName: null,
          lastName: null,
          teamName: null,
          div: null,
          GA: 99,
          GAA: 99,
          GP: 0
      }

      //then set up top GAA based on min games played
      const topGAA = [nullGoalie, nullGoalie, nullGoalie]

      for (let m=0; m<3; m++){ //for each GAA slot
          for (let n=0; n<divGoalieStats.length; n++){ //cycle through all goalies in div
              if (Number(divGoalieStats[n].GAA) < Number(topGAA[m].GAA) && Number(divGoalieStats[n].GP) >= GPmin){
                  if (m===0){
                      topGAA[m] = divGoalieStats[n]
                  }
                  else if (m===1){
                      if ( !(divGoalieStats[n].fullName === topGAA[0].fullName))
                          topGAA[m] = divGoalieStats[n]
                  }
                  else if (m===2){
                      if ( !(divGoalieStats[n].fullName === topGAA[0].fullName || divGoalieStats[n].fullName === topGAA[1].fullName))
                          topGAA[m] = divGoalieStats[n]
                  }
              }
          }
      }

               
      // Navigate folder structure: Gameday Graphics inside league, or user selected Gameday Graphics directly
      let gamedayFolder;
      try {
        gamedayFolder = await baseFolder.getEntry('Gameday Graphics');
      } catch {
        gamedayFolder = baseFolder;
      }
      const templateFolder = await gamedayFolder.getEntry(DOC_ID);

      // Get the template file (playoff or regular)
      const templateFile = await templateFolder.getEntry(`${templateName}.psd`);
      
      // Create working files folder if it doesn't exist (BEFORE executeAsModal)
      let workingFolder;
      try {
          workingFolder = await templateFolder.getEntry('Working Files');
      } catch (err) {
          // Folder doesn't exist, create it
          workingFolder = await templateFolder.createFolder("Working Files");
      }
      
      // Create the save file entry (BEFORE executeAsModal)
      const workingFileName = `${divAbb}_${templateName}_working.psd`;
      const saveFile = await workingFolder.createFile(workingFileName, { overwrite: true });
      
      ///// PHOTOSHOP AUTOMATION /////
      
      statusEl.innerHTML = `Updating ${divAbb}${isPlayoff ? ' (Playoffs)' : ''}...`;

      await core.executeAsModal(async () => {
          await app.open(templateFile);

          // If running ALL, close the previous document after opening this one (with delay)
          if (userDiv === 'ALL' && previousDocId) {
              const prev = app.documents.find(docItem => docItem._id === previousDocId);
              if (prev) {
                  await delay(500);
                  await prev.close();
              }
              previousDocId = null;
          }

          // Define document and header
          const doc = app.activeDocument;
          // Save As immediately to avoid modifying/saving the template
          if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);
          const header = getByName(doc, 'HEADER');
          const sectionHeaders = getByName(doc, 'Section Headers')

          // Header Update
          const divisionText = getByName(header, 'DIVISION');
          const locationText = getByName(header, 'LOCATION');
          const divisionColorLayer = getByName(header, 'HEADER COLOR');

          divisionText.textItem.contents = division.toUpperCase();
          locationText.textItem.contents = confLocation.toUpperCase();
  
          // Division fill color
          await fillColor(divisionColorLayer, divColorHex);

          // POINTS Update - cycle through top 5 players
          const pointsFolder = getByName(doc, 'POINTS');
          for (let i = 0; i < 5; i++) {
              const j = i + 1;
              const pointsX = getByName(pointsFolder, 'POINTS ' + j);
              
              // Get all layer references
              const firstNameLayer = getByName(pointsX, 'FIRST NAME');
              const lastNameLayer = getByName(pointsX, 'LAST NAME');
              const teamNameLayer = getByName(pointsX, 'TEAM NAME');
              const goalsLayer = getByName(pointsX, 'G');
              const assistsLayer = getByName(pointsX, 'A');
              const pointsLayer = getByName(pointsX, 'PTS');
              const teamLogoLayer = getByName(pointsX, 'LOGO');
              const teamColorLayer = getByName(pointsX, 'TEAM COLOR');
              
              // Get team color from teams array
              let tColor = '000000';
              let tName = '';
              let tFull = '';
              for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === topPoints[i].teamName) {
                      tColor = teams[c].color1;
                      tName = teams[c].teamName;
                      tFull = teams[c].fullTeam;
                      break;
                  }
              }
              
              // Update team information
              await fillColor(teamColorLayer, tColor);
              const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(tFull)}.png`;
              let ok = await imageHandler.replaceLayerWithImage(teamLogoLayer, logoUrl);
              if (!ok) ok = await imageHandler.replaceLayerWithImage(teamLogoLayer, `LOGOS/TEAMS/${conf}/${divAbb}/${tFull}.png`, baseFolder);
              if (!ok) await imageHandler.replaceLayerWithImage(teamLogoLayer, "LOGOS/LeagueLogo.png", baseFolder);

              // Update text layers
              firstNameLayer.textItem.contents = topPoints[i].firstName.toUpperCase();
              lastNameLayer.textItem.contents = sanitizeLastName(topPoints[i].lastName).toUpperCase();
              teamNameLayer.textItem.contents = (() => { const u = String(topPoints[i].teamName).toUpperCase(); return u.length > 20 ? (u.slice(0, 20) + '...') : u; })();
              goalsLayer.textItem.contents = topPoints[i].goals;
              assistsLayer.textItem.contents = topPoints[i].assists;
              pointsLayer.textItem.contents = topPoints[i].points;
              
              // Set text colors based on background
              setTextColor(firstNameLayer, tColor);
              setTextColor(lastNameLayer, tColor);
              setTextColor(teamNameLayer, tColor);
          }

          // GOALS Update - cycle through top 3 goal scorers
          const goalsHeader = getByName(sectionHeaders, 'GOALS')
          if (goalsHeader.textItem.contents == 'PTS/GP')
              topGoals = topPPG;

          const goalsFolder = getByName(doc, 'GOALS');
          for (let i = 0; i < 3; i++) {
              const j = i + 1;
              const goalsX = getByName(goalsFolder, 'GOALS ' + j);
              
              // Get all layer references
              const firstNameLayer = getByName(goalsX, 'FIRST NAME');
              const lastNameLayer = getByName(goalsX, 'LAST NAME');
              const teamNameLayer = getByName(goalsX, 'TEAM NAME');
              const goalsLayer = getByName(goalsX, 'G');
              const teamLogoLayer = getByName(goalsX, 'LOGO');
              const teamColorLayer = getByName(goalsX, 'TEAM COLOR');
              
              // Get team color from teams array
              let tColor = 'ffffff';
              let tName = '';
              let tFull = '';
              for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === topGoals[i].teamName) {
                      tColor = teams[c].color1;
                      tName = teams[c].teamName;
                      tFull = teams[c].fullTeam;
                      break;
                  }
              }
              
              // Update team information
              await fillColor(teamColorLayer, tColor);
              const goalLogoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(tFull)}.png`;
              let goalOk = await imageHandler.replaceLayerWithImage(teamLogoLayer, goalLogoUrl);
              if (!goalOk) goalOk = await imageHandler.replaceLayerWithImage(teamLogoLayer, `LOGOS/TEAMS/${conf}/${divAbb}/${tFull}.png`, baseFolder);
              if (!goalOk) await imageHandler.replaceLayerWithImage(teamLogoLayer, "LOGOS/LeagueLogo.png", baseFolder);

              // Update text layers
              firstNameLayer.textItem.contents = topGoals[i].firstName.toUpperCase();
              lastNameLayer.textItem.contents = sanitizeLastName(topGoals[i].lastName).toUpperCase();
              teamNameLayer.textItem.contents = (() => { const u = String(topGoals[i].teamName).toUpperCase(); return u.length > 20 ? (u.slice(0, 20) + '...') : u; })();
              if (goalsHeader.textItem.contents == 'PTS/GP')
                  goalsLayer.textItem.contents = topGoals[i].ppg;
              else
                  goalsLayer.textItem.contents = topGoals[i].goals;
              
              // Adjust size if last name is too long 
              const fontSize = Number(lastNameLayer.textItem.characterStyle.size); 
              if (lastNameLayer.textItem.contents.length > 11)
                  lastNameLayer.textItem.characterStyle.size = 0.75 * fontSize;   
              
              // Set text colors based on background
              setTextColor(firstNameLayer, tColor);
              setTextColor(lastNameLayer, tColor);
              setTextColor(teamNameLayer, tColor);
          }

          // GAA Update - cycle through top 3 goalies
          const gaaFolder = getByName(doc, 'GAA');
          for (let i = 0; i < 3; i++) {
              const j = i + 1;
              const gaaX = getByName(gaaFolder, 'GAA ' + j);
              
              // Hide layer if no goalie data
              if (topGAA[i].GP === 0) {
                  gaaX.visible = false;
                  continue;
              } else {
                  gaaX.visible = true;
              }
              
              // Get all layer references
              const minimumLayer = getByName(gaaFolder, 'MIN GP');
              const firstNameLayer = getByName(gaaX, 'FIRST NAME');
              const lastNameLayer = getByName(gaaX, 'LAST NAME');
              const teamNameLayer = getByName(gaaX, 'TEAM NAME');
              const gaaLayer = getByName(gaaX, 'GAA');
              const teamLogoLayer = getByName(gaaX, 'LOGO');
              const teamColorLayer = getByName(gaaX, 'TEAM COLOR');
              
              // Get team color from teams array
              let tColor = 'ffffff';
              let tName = '';
              let tFull = '';
              for (let c = 0; c < teams.length; c++) {
                  if (teams[c].fullTeam === topGAA[i].teamName) {
                      tColor = teams[c].color1;
                      tName = teams[c].teamName;
                      tFull = teams[c].fullTeam;
                      break;
                  }
              }
              
              // Update team information
              await fillColor(teamColorLayer, tColor);
              const gaaLogoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(tFull)}.png`;
              let gaaOk = await imageHandler.replaceLayerWithImage(teamLogoLayer, gaaLogoUrl);
              if (!gaaOk) gaaOk = await imageHandler.replaceLayerWithImage(teamLogoLayer, `LOGOS/TEAMS/${conf}/${divAbb}/${tFull}.png`, baseFolder);
              if (!gaaOk) await imageHandler.replaceLayerWithImage(teamLogoLayer, "LOGOS/LeagueLogo.png", baseFolder);

              // Update text layers
              firstNameLayer.textItem.contents = topGAA[i].firstName.toUpperCase();
              lastNameLayer.textItem.contents = sanitizeLastName(topGAA[i].lastName).toUpperCase();
              teamNameLayer.textItem.contents = (() => { const u = String(topGAA[i].teamName).toUpperCase(); return u.length > 20 ? (u.slice(0, 20) + '...') : u; })();
              gaaLayer.textItem.contents = topGAA[i].GAA;
              minimumLayer.textItem.contents = `(MIN. ${GPmin}GP)`;
              
              // Adjust size if last name is too long 
              const fontSize = Number(lastNameLayer.textItem.characterStyle.size); 
              if (lastNameLayer.textItem.contents.length > 11)
                  lastNameLayer.textItem.characterStyle.size = 0.75 * fontSize;                
              
              // Set text colors based on background
              setTextColor(firstNameLayer, tColor);
              setTextColor(lastNameLayer, tColor);
              setTextColor(teamNameLayer, tColor);
          }
          
          // Export PNG to Exports/Week {week}/{DOC_EXPORT}
          const exportFile = await prepareStatsExport(gamedayFolder, week, divAbb, isPlayoff);
          const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, exportFile.name);
          await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);
          
          // If processing ALL, remember this doc to close after the next one opens
          if (userDiv === 'ALL') {
              previousDocId = doc._id;
          }

          await doc.save()
      }, { commandName: "Update Division" });
    };

    // Process regular season divisions
    for (let d=0; d<activeRegularDivs.length; d++){
        const divisionGames = activeRegularDivs[d];
        await processDivision(divisionGames, false);
    }

    // Process playoff divisions
    for (let d=0; d<activePlayoffDivs.length; d++){
        const divisionGames = activePlayoffDivs[d];
        await processDivision(divisionGames, true);
    }
    
    const totalDivsProcessed = activeRegularDivs.length + activePlayoffDivs.length;
    if (userDiv === 'ALL') {
        statusEl.innerHTML = `✅ Updated ${totalDivsProcessed} divisions (${activeRegularDivs.length} regular, ${activePlayoffDivs.length} playoff)`;
    } else {
        const regularCount = activeRegularDivs.length > 0 ? 1 : 0;
        const playoffCount = activePlayoffDivs.length > 0 ? 1 : 0;
        if (regularCount > 0 && playoffCount > 0) {
            statusEl.innerHTML = `✅ Updated ${userDiv} (regular & playoff)`;
        } else if (playoffCount > 0) {
            statusEl.innerHTML = `✅ Updated ${userDiv} (playoff)`;
        } else {
            statusEl.innerHTML = `✅ Updated ${userDiv}`;
        }
    }
      

  } catch (err) {
    statusEl.textContent = "⚠️ Error updating STATS";
    console.error("Error:", err);
  }
}

/////// FUNCTIONS /////////

function hexToRgb(hex) {
  const h = hex.replace(/^#/, "").trim();
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

async function fillColor(layer, hex) {
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay(
    [{
      _obj: "select",
      _target: [{ _ref: "layer", _id: layer._id }],
      makeVisible: false,
      selectionModifier: { _enum: "selectionModifierType", _value: "replaceSelection" },
      _isCommand: true
    }],
    { synchronousExecution: true }
  );
  await app.batchPlay(
    [{
      _obj: "set",
      _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }],
      to: {
        _obj: "solidColorLayer",
        color: { _obj: "RGBColor", red: r, green: g, blue: b }
      }
    }],
    { synchronousExecution: true }
  );
}

const getByName = (parent, name) => {
    const layers = parent.layers || parent;
    return layers.find(l => l.name === name);
};

const setTextColor = (layer, backgroundColor) => {
    const color = new app.SolidColor();
    if (backgroundColor == 'ffffff') {
        color.rgb.hexValue = '252525';
    } else {
        color.rgb.hexValue = 'ffffff';
    }
    layer.textItem.characterStyle.color = color;
};

// Export functions
module.exports = {
  handleStatsUpdate,
  fillColor,
  hexToRgb
};

// ===== Helpers (bottom of file) =====

function sanitizeLastName(lastName) {
    let s = String(lastName || '');
    s = s.replace(/\s*\((?:they|she|he)\s*\/\s*(?:them|her|him)\)\s*$/i, '');
    s = s.replace(/\s+(?:they|she|he)\s*\/\s*(?:them|her|him)\s*$/i, '');
    return s.trim();
}

async function ensureFolderPath(rootFolder, segments){
    let current = rootFolder;
    for (const segment of segments){
        try { current = await current.getEntry(segment); }
        catch { current = await current.createFolder(segment); }
    }
    return current;
}

async function prepareStatsExport(gamedayFolder, week, divAbb, isPlayoff = false){
    const weekFolderName = `Week ${week}`;
    const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName, DOC_EXPORT]);
    const suffix = isPlayoff ? '_Playoffs' : '';
    const exportFileName = `${divAbb}_${DOC_EXPORT}${suffix}.png`;
    return await exportFolder.createFile(exportFileName, { overwrite: true });
}

