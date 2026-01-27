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

// ---- Initial Check ----
async function checkLicenseAndLaunch() {
  const email = localStorage.getItem("userEmail");
  const key = localStorage.getItem("licenseKey");
  const lastCheck = Number(localStorage.getItem("licenseValidatedAt")) || 0;

  if (!email || !key) {
    showLicenseScreen();
    return;
  }

  // ✅ Recent validation (cached)
  if (Date.now() - lastCheck < LICENSE_RECHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000) {
    launchApp();
    // silent background recheck
    verifyLicense(email, key).then(isValid => {
      if (!isValid) {
        alert("Your license is no longer valid. Please re-activate.");
        showLicenseScreen();
      }
    });
    return;
  }

  // ⏳ Full validation (7+ days)
  const isValid = await verifyLicense(email, key);
  if (isValid) {
    localStorage.setItem("licenseValidatedAt", Date.now());
    launchApp();
  } else {
    showLicenseScreen("License expired or revoked.");
  }
}

// ---- Manual Activation ----
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

// ---- Logout ----
function logoutUser() {
  localStorage.clear();
  showLicenseScreen("You’ve been logged out.");
}

// ---- UI Helpers ----
function showLicenseScreen(message = "") {
  document.getElementById("license-screen").style.display = "block";
  document.getElementById("main-ui").style.display = "none";
  document.getElementById("licenseError").textContent = message;
}

function launchApp() {
  document.getElementById("license-screen").style.display = "none";
  document.getElementById("main-ui").style.display = "block";
  ui.initializeUI()}

module.exports = {
checkLicenseAndLaunch,
handleActivation,
logoutUser
};
  
