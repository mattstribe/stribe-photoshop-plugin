// ui.js
const leagueConfig = require("./leagueConfig_200.js");
const storage = require("./storage.js");

let hasFolderSelected = false;
let cachedDivisions = null;
let cachedWeek = null;
let cachedYear = null;
let cachedConfs = null;

async function loadFolderData(baseFolder) {
  const weekDisplayEl = document.getElementById("weekDisplay");
  const folderDisplayEl = document.getElementById("folderDisplay");

  if (baseFolder) {
    folderDisplayEl.textContent = `Folder: ${baseFolder.name}`;
    try {
      const [divisions, conferences, schedule] = await Promise.all([
        leagueConfig.loadDivisionInfo(baseFolder),
        leagueConfig.loadConferenceInfo(baseFolder),
        leagueConfig.loadSchedule(baseFolder)
      ]);

      cachedDivisions = divisions;
      cachedWeek = schedule.week;
      cachedYear = schedule.year;
      cachedConfs = {};

      for (const conf of conferences || []) {
        const fullName = (conf.conf || "").toUpperCase();
        if (!fullName) continue;
        const abb = fullName.length <= 4 ? fullName : fullName.slice(0, 3);
        cachedConfs[abb] = fullName;
      }

      if (weekDisplayEl) weekDisplayEl.textContent = `Week: ${cachedWeek} (${cachedYear})`;
      hasFolderSelected = true;
      updateActionButtons();
    } catch (err) {
      console.error("Error loading data:", err);
      if (weekDisplayEl) weekDisplayEl.textContent = "Week: -";
      hasFolderSelected = false;
      updateActionButtons();
    }
  } else {
    folderDisplayEl.textContent = "Folder: Please select your League Package folder";
    if (weekDisplayEl) weekDisplayEl.textContent = "Week: -";
    hasFolderSelected = false;
    updateActionButtons();
  }
}

function updateActionButtons() {
  const scheduleBtn = document.getElementById("btnSchedule");
  const standingsBtn = document.getElementById("btnStandings");
  const statsBtn = document.getElementById("btnStats");

  if (!hasFolderSelected) {
    scheduleBtn.disabled = standingsBtn.disabled = statsBtn.disabled = true;
    return;
  }

  const divisionInput = document.getElementById("divisionInput").value.trim().toUpperCase();
  const isAll = divisionInput === "ALL";
  const isValidDiv = cachedDivisions?.some(d => d.abb === divisionInput);
  const isValidConf = !!cachedConfs?.[divisionInput];
  const allDivsCheckbox = document.getElementById("allDivisionsCheckbox");
  const ignoreWeek = !!(allDivsCheckbox && allDivsCheckbox.checked);

  // Schedule can ONLY run when we're respecting the current week filter.
  if (ignoreWeek) {
    scheduleBtn.disabled = true;
  } else {
    scheduleBtn.disabled = !(isAll || isValidDiv || isValidConf);
  }
  standingsBtn.disabled = statsBtn.disabled = !(isAll || isValidDiv);
}

async function initializeUI() {
  const baseFolder = await storage.getBaseFolder();
  await loadFolderData(baseFolder);
}

function updateDivisionDisplay() {
  const divisionInput = document.getElementById("divisionInput").value.trim().toUpperCase();
  let displayText = "";

  if (divisionInput === "ALL") displayText = "ALL";
  else if (cachedDivisions && divisionInput.length > 0) {
    for (const div of cachedDivisions) {
      if (divisionInput === div.abb) {
        displayText = `${div.conf} ${div.div}`;
        break;
      }
    }
    if (!displayText && cachedConfs && cachedConfs[divisionInput])
      displayText = cachedConfs[divisionInput];
  }

  document.getElementById("divisionDisplay").textContent = displayText;
  updateActionButtons();
}

// ✅ Export only what’s needed
module.exports = {
  initializeUI,
  updateDivisionDisplay,
  updateActionButtons
};
