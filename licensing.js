// licensing.js
const ui = require("./ui.js");

const LICENSE_API_URL = "https://license-server-five-red.vercel.app/api/verify-license";
const LICENSE_RECHECK_INTERVAL_DAYS = 7;

// ---- Verify License ----
async function verifyLicense(email, licenseKey) {
  try {
    const res = await fetch(LICENSE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: email, licenseKey })
    });
    const data = await res.json();
    return data.valid === true;
  } catch (err) {
    console.error("License check failed:", err);
    return false;
  }
}

// ---- Initial Check (TEMPORARILY BYPASSED: always launch) ----
async function checkLicenseAndLaunch() {
  launchApp();
}

// ---- Manual Activation (no-op while license disabled) ----
async function handleActivation() {
  launchApp();
}

// ---- Logout ----
function logoutUser() {
  localStorage.removeItem("userEmail");
  localStorage.removeItem("licenseKey");
  localStorage.removeItem("licenseValidatedAt");
  // License screen disabled
  // showLicenseScreen("You’ve been logged out.");
}

// ---- UI Helpers ----
function showLicenseScreen(_message = "") {
  // No-op while license disabled
}

function launchApp() {
  const licenseEl = document.getElementById("license-screen");
  const mainEl = document.getElementById("main-ui");
  if (licenseEl) licenseEl.style.display = "none";
  if (mainEl) mainEl.style.display = "block";
  ui.initializeUI();
}

module.exports = {
checkLicenseAndLaunch,
handleActivation,
logoutUser
};
  
