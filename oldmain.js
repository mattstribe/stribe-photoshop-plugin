
// Import modules
const fs = require("uxp").storage.localFileSystem;
const leagueConfig = require("./leagueConfig.js");

// ========= LICENSING FLOW =========

// Vercel endpoint (replace if you change later)
const LICENSE_API_URL = "https://license-server-stribe.vercel.app/api/verify-license";

// Check local storage
const LICENSE_RECHECK_INTERVAL_DAYS = 7;

async function checkLicenseAndLaunch() {
  const email = localStorage.getItem("userEmail");
  const key = localStorage.getItem("licenseKey");
  const lastCheck = Number(localStorage.getItem("licenseValidatedAt")) || 0;

  if (!email || !key) {
    showLicenseScreen();
    return;
  }

  // If it's been less than 7 days since last validation, just launch
  if (Date.now() - lastCheck < LICENSE_RECHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000) {
    launchApp();
    // Trigger silent recheck in the background (doesn't block UI)
    verifyLicense(email, key).then(isValid => {
      if (!isValid) {
        alert("Your license is no longer valid. Please re-activate.");
        showLicenseScreen();
      }
    });
    return;
  }

  // Otherwise, validate now (foreground check)
  const isValid = await verifyLicense(email, key);
  if (isValid) {
    localStorage.setItem("licenseValidatedAt", Date.now());
    launchApp();
  } else {
    showLicenseScreen("License expired or revoked.");
  }
}


async function verifyLicense(email, licenseKey) {
  try {
    console.log("Sending to:", LICENSE_API_URL, { userEmail: email, licenseKey });

    const res = await fetch(LICENSE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: email, licenseKey })
    });

    const data = await res.json();

console.log("Response from server:", data);
    return data.valid === true;
  } catch (err) {
    console.error("License check failed:", err);
    return false;
  }
}

async function handleActivation() {
  const email = document.getElementById("emailInput").value.trim();
  const key = document.getElementById("keyInput").value.trim();
  const errorEl = document.getElementById("licenseError");

  if (!email || !key) {
    errorEl.textContent = "Please enter both email and license key.";
    return;
  }

  errorEl.textContent = "Checking license...";

  const isValid = await verifyLicense(email, key);
  if (isValid) {
    localStorage.setItem("userEmail", email);
    localStorage.setItem("licenseKey", key);
    localStorage.setItem("licenseValidatedAt", Date.now());
    launchApp();
  } else {
    errorEl.textContent = "Invalid license. Please try again.";
  }
}

function showLicenseScreen(message = "") {
  document.getElementById("license-screen").style.display = "block";
  document.getElementById("main-ui").style.display = "none";
  document.getElementById("licenseError").textContent = message;
}

function launchApp() {
  document.getElementById("license-screen").style.display = "none";
  document.getElementById("main-ui").style.display = "block";
  initializeUI(); // this was already your starting point
}

// Attach listener for activation button
document.getElementById("btnActivate").addEventListener("click", handleActivation);

// ===== LOGOUT HANDLER =====
document.getElementById("btnLogout").addEventListener("click", () => {
  localStorage.removeItem("userEmail");
  localStorage.removeItem("licenseKey");
  showLicenseScreen("You’ve been logged out.");
});


// ========== SHARED FOLDER MANAGEMENT ==========

// Loads saved base folder (if token exists and is valid)
async function loadSavedBaseFolder() {
  const dataFolder = await fs.getDataFolder();
  try {
    const jsonFile = await dataFolder.getEntry("folder-path.json");
    const jsonData = JSON.parse(await jsonFile.read());
    return await fs.getEntryForPersistentToken(jsonData.folderToken);
  } catch (e) {
    console.log("No valid saved base folder found. User will be prompted.");
    return null;
  }
}

// Prompts user to pick base folder and saves token for future use
async function selectAndSaveBaseFolder() {
  const baseFolder = await fs.getFolder({ prompt: "Select your League Package base folder" });
  const token = await fs.createPersistentToken(baseFolder);

  const dataFolder = await fs.getDataFolder();
  const jsonFile = await dataFolder.createFile("folder-path.json", { overwrite: true });

  await jsonFile.write(JSON.stringify({ folderToken: token }, null, 2));
  console.log("✅ Base folder saved successfully.");

  return baseFolder;
}

// Confirms CSV exists in the selected folder
async function confirmCsvExistsOrRePrompt(baseFolder) {
  const relativePath = "Automations/References/DivisionInfo.csv";

  try {
    await baseFolder.getEntry(relativePath);
    console.log("✅ CSV confirmed at:", relativePath);
    return baseFolder;
  } catch {
    console.warn("⚠️ CSV not found in selected folder. Reprompting user...");
    return null;
  }
}

// Main getter that loads stored folder or asks user on first run
async function getBaseFolder() {
  // 1️⃣ Try to load saved folder
  let baseFolder = await loadSavedBaseFolder();

  // 2️⃣ Confirm CSV exists, otherwise set baseFolder to null
  if (baseFolder) {
    baseFolder = await confirmCsvExistsOrRePrompt(baseFolder);
  }

  return baseFolder;
}

// Track folder state
let hasFolderSelected = false;

// Enable or disable action buttons based on folder state and division input validity
function updateActionButtons() {
  const scheduleBtn = document.getElementById("btnSchedule");
  const standingsBtn = document.getElementById("btnStandings");
  const statsBtn = document.getElementById("btnStats");

  if (!hasFolderSelected) {
    scheduleBtn.disabled = true;
    standingsBtn.disabled = true;
    statsBtn.disabled = true;
    return;
  }

  const divisionInput = document.getElementById("divisionInput").value.trim().toUpperCase();
  const isAll = divisionInput === "ALL";
  const isValidDiv = isValidDivisionAbb(divisionInput);
  const isValidConf = isValidConferenceAbb(divisionInput);

  // Schedule allowed for valid conference OR valid division OR ALL
  scheduleBtn.disabled = !(isAll || isValidDiv || isValidConf);
  // Standings/Stats allowed for valid division OR ALL
  const enableDivOnly = (isAll || isValidDiv);
  standingsBtn.disabled = !enableDivOnly;
  statsBtn.disabled = !enableDivOnly;
}

function isValidDivisionAbb(abb) {
  if (!cachedDivisions || !abb) return false;
  for (let i = 0; i < cachedDivisions.length; i++) {
    if (abb === (cachedDivisions[i].abb || "").toUpperCase()) return true;
  }
  return false;
}

function isValidConferenceAbb(abb) {
  if (!cachedConfs || !abb) return false;
  return !!cachedConfs[abb];
}

// Load folder data and update UI
async function loadFolderData(baseFolder) {
  const weekDisplayEl = document.getElementById("weekDisplay");
  const folderDisplayEl = document.getElementById("folderDisplay");
  
  if (baseFolder) {
    folderDisplayEl.textContent = `Folder: ${baseFolder.name}`;
    
    // Load divisions, conferences and schedule for conversion lookup
    try {
      const [divisions, conferences, schedule] = await Promise.all([
        leagueConfig.loadDivisionInfo(baseFolder),
        leagueConfig.loadConferenceInfo(baseFolder),
        leagueConfig.loadSchedule(baseFolder)
      ]);
      
      cachedDivisions = divisions;
      cachedWeek = schedule.week;
      cachedYear = schedule.year;
      // Build conference abbreviation lookup (PAC -> PACIFIC, EAST -> EAST, etc.)
      cachedConfs = {};
      if (conferences && conferences.length) {
        for (let i = 0; i < conferences.length; i++) {
          const fullName = (conferences[i].conf || "").toUpperCase();
          if (!fullName) continue;
          // Prefer exact 3-letter or 4-letter abbs from conference name
          const abb = fullName.length <= 4 ? fullName : fullName.slice(0, 3);
          cachedConfs[abb] = fullName;
        }
      }
      
      weekDisplayEl.textContent = `Week: ${cachedWeek} (${cachedYear})`;
      console.log(`Loaded ${cachedDivisions.length} divisions and Week ${cachedWeek}`);
      
      hasFolderSelected = true;
      await updateDivisionDisplay();
      updateActionButtons();
    } catch (err) {
      console.log("Could not preload data:", err);
      weekDisplayEl.textContent = "Week: -";
      hasFolderSelected = false;
      updateActionButtons();
    }
  } else {
    folderDisplayEl.textContent = "Folder: Please select your League Package folder";
    weekDisplayEl.textContent = "Week: -";
    hasFolderSelected = false;
    updateActionButtons();
  }
}

// ========== UI DISPLAY FUNCTIONS ==========

// Cache loaded divisions and week info
let cachedDivisions = null;
let cachedWeek = null;
let cachedYear = null;
let cachedConfs = null;

// Update division display when input changes (only on exact matches)
async function updateDivisionDisplay() {
  const divisionInput = document.getElementById("divisionInput").value.trim().toUpperCase();

  // Show nothing by default while typing
  let displayText = "";

  if (divisionInput === "ALL") {
    displayText = "ALL";
  } else if (cachedDivisions && divisionInput.length > 0) {
    // Only show when input exactly matches a known division abbreviation
    for (let i = 0; i < cachedDivisions.length; i++) {
      if (divisionInput === cachedDivisions[i].abb) {
        displayText = cachedDivisions[i].conf + ' ' + cachedDivisions[i].div;
        break;
      }
    }
    // Or when it matches a known conference abbreviation
    if (!displayText && cachedConfs && cachedConfs[divisionInput]) {
      displayText = cachedConfs[divisionInput];
    }
  }

  document.getElementById("divisionDisplay").textContent = displayText;
  updateActionButtons();
}

// Initialize UI on load
async function initializeUI() {
  const baseFolder = await getBaseFolder();
  await loadFolderData(baseFolder);
}

// ========== EVENT LISTENERS ==========

// Select folder button
document.getElementById("btnSelectFolder").addEventListener("click", async () => {
  const statusEl = document.getElementById("status");
  try {
    const newFolder = await selectAndSaveBaseFolder();
    const validFolder = await confirmCsvExistsOrRePrompt(newFolder);
    
    if (validFolder) {
      await loadFolderData(validFolder);
      statusEl.textContent = "✅ Folder selected successfully!";
    } else {
      statusEl.textContent = "⚠️ Selected folder doesn't contain required CSV files. Please select the correct League Package folder.";
    }
  } catch (err) {
    statusEl.textContent = "⚠️ Folder selection cancelled";
    console.error(err);
  }
});

// Event listeners for action buttons
document.getElementById("btnSchedule").addEventListener("click", async () => {
  const statusEl = document.getElementById("status");
  const baseFolder = await getBaseFolder();
  
  if (!baseFolder) {
    statusEl.textContent = "⚠️ Please select your League Package folder first";
    return;
  }
  const scheduleModule = require("./schedule.js");
  await scheduleModule.handleScheduleUpdate(baseFolder);
});

document.getElementById("btnStandings").addEventListener("click", async () => {
  const statusEl = document.getElementById("status");
  const baseFolder = await getBaseFolder();
  
  if (!baseFolder) {
    statusEl.textContent = "⚠️ Please select your League Package folder first";
    return;
  }
  const standingsModule = require("./standings.js");
  await standingsModule.handleStandingsUpdate(baseFolder);
});

document.getElementById("btnStats").addEventListener("click", async () => {
  const statusEl = document.getElementById("status");
  const baseFolder = await getBaseFolder();
  
  if (!baseFolder) {
    statusEl.textContent = "⚠️ Please select your League Package folder first";
    return;
  }
  const statsModule = require("./stats.js");
  await statsModule.handleStatsUpdate(baseFolder);
});

// Listen for division input changes
document.getElementById("divisionInput").addEventListener("input", updateDivisionDisplay);

// Initialize UI on page load
checkLicenseAndLaunch();