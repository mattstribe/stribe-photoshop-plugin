// ui.js
const leagueConfig = require("./leagueConfig_200.js");
const storage = require("./storage.js");
const uxpStorage = require("uxp").storage;

let hasFolderSelected = false;
let cachedDivisions = null;
let cachedWeek = null;
let cachedYear = null;
let cachedConfs = null;

/** Try to load league logo from baseFolder/LOGOS/leagueLogo.png (or LeagueLogo.png) and set as data URL on img. */
async function setLeagueLogo(baseFolder, imgEl) {
  if (!imgEl) return;
  imgEl.style.display = "none";
  imgEl.removeAttribute("src");
  try {
    const logosFolder = await baseFolder.getEntry("LOGOS");
    let fileEntry = null;
    try {
      fileEntry = await logosFolder.getEntry("leagueLogo.png");
    } catch {
      try {
        fileEntry = await logosFolder.getEntry("LeagueLogo.png");
      } catch {}
    }
    if (!fileEntry) return;
    const data = await fileEntry.read({ format: uxpStorage.formats.binary });
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    imgEl.src = `data:image/png;base64,${base64}`;
    imgEl.style.display = "";
  } catch (err) {
    console.log("League logo not found or unreadable:", err.message);
  }
}

async function loadFolderData(baseFolder) {
  const weekDisplayEl = document.getElementById("weekDisplay");
  const folderDisplayEl = document.getElementById("folderDisplay");
  const leagueLogoEl = document.getElementById("leagueLogo");

  if (baseFolder) {
    folderDisplayEl.textContent = `Folder: ${baseFolder.name}`;
    await setLeagueLogo(baseFolder, leagueLogoEl);
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
    if (leagueLogoEl) {
      leagueLogoEl.style.display = "none";
      leagueLogoEl.removeAttribute("src");
    }
    if (weekDisplayEl) weekDisplayEl.textContent = "Week: -";
    hasFolderSelected = false;
    updateActionButtons();
  }
}

function updateActionButtons() {
  const scheduleBtn = document.getElementById("btnSchedule");
  const standingsBtn = document.getElementById("btnStandings");
  const statsBtn = document.getElementById("btnStats");
  const divPreviewsBtn = document.getElementById("btnDivPreviews");

  if (!hasFolderSelected) {
    scheduleBtn.disabled = standingsBtn.disabled = statsBtn.disabled = true;
    if (divPreviewsBtn) divPreviewsBtn.disabled = true;
    return;
  }
  if (divPreviewsBtn) divPreviewsBtn.disabled = false;

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
