const licensing = require("./licensing.js");
const storage = require("./storage.js");
const ui = require("./ui.js");

// License
document.getElementById("btnActivate").addEventListener("click", licensing.handleActivation);

// Folder selection
document.getElementById("btnSelectFolder").addEventListener("click", async () => {
  await storage.selectAndSaveBaseFolder();
  await ui.initializeUI();
});

// Refresh week
document.getElementById("btnRefreshWeek").addEventListener("click", async () => {
  await ui.initializeUI();
});

// Action buttons
document.getElementById("btnSchedule").addEventListener("click", async () => {
  await ui.initializeUI();
  const baseFolder = await storage.getBaseFolder();
  const scheduleModule = require("./schedule.js");
  await scheduleModule.handleScheduleUpdate(baseFolder);
});

document.getElementById("btnStandings").addEventListener("click", async () => {
  await ui.initializeUI();
  const baseFolder = await storage.getBaseFolder();
  const standingsModule = require("./standings.js");
  await standingsModule.handleStandingsUpdate(baseFolder);
});

document.getElementById("btnStats").addEventListener("click", async () => {
  await ui.initializeUI();
  const baseFolder = await storage.getBaseFolder();
  const statsModule = require("./stats.js");
  await statsModule.handleStatsUpdate(baseFolder);
});

// Division
document.getElementById("divisionInput").addEventListener("input", ui.updateDivisionDisplay);

// Ignore Week checkbox should immediately refresh button enable/disable state
const allDivsCheckbox = document.getElementById("allDivisionsCheckbox");
if (allDivsCheckbox) {
  allDivsCheckbox.addEventListener("change", ui.updateActionButtons);
}

// Settings Menu (3-dot menu)
const settingsMenuButton = document.getElementById("settingsMenuButton");
const settingsMenu = document.getElementById("settingsMenu");
const btnClearCache = document.getElementById("btnClearCache");

if (settingsMenuButton && settingsMenu) {
  // Toggle menu on button click
  settingsMenuButton.addEventListener("click", (e) => {
    e.stopPropagation();
    const isVisible = settingsMenu.style.display !== "none";
    settingsMenu.style.display = isVisible ? "none" : "block";
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!settingsMenuButton.contains(e.target) && !settingsMenu.contains(e.target)) {
      settingsMenu.style.display = "none";
    }
  });

  // Clear cache button
  if (btnClearCache) {
    btnClearCache.addEventListener("click", async () => {
      const logoHandler = require("./logoHandler.js");
      await logoHandler.clearLogoCache();
      settingsMenu.style.display = "none";
      
      // Show confirmation
      const statusEl = document.getElementById("status");
      if (statusEl) {
        statusEl.innerHTML = "✅ Logo cache cleared";
        setTimeout(() => {
          if (statusEl.innerHTML === "✅ Logo cache cleared") {
            statusEl.innerHTML = "";
          }
        }, 2000);
      }
    });
  }

  // Logout button (moved to settings menu)
  const btnLogout = document.getElementById("btnLogout");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      licensing.logoutUser();
      settingsMenu.style.display = "none";
    });
  }
}

// Export to Cloud checkbox
const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
if (exportToCloudCheckbox) {
  // Load saved preference
  const savedPreference = localStorage.getItem("exportToCloud");
  if (savedPreference !== null) {
    exportToCloudCheckbox.checked = savedPreference === "true";
  }

  // Save preference when changed
  exportToCloudCheckbox.addEventListener("change", () => {
    localStorage.setItem("exportToCloud", exportToCloudCheckbox.checked ? "true" : "false");
  });
}

// Initialize
licensing.checkLicenseAndLaunch();
