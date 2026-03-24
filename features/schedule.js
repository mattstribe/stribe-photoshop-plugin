const defaultScheduleModule = require("./schedule-default.js");
const nbhlScheduleModule = require("./schedule-nbhl.js");

function normalizeLeagueName(baseFolder) {
  return String(baseFolder?.name || "").trim().toUpperCase();
}

function getScheduleHandler(baseFolder) {
  const leagueName = normalizeLeagueName(baseFolder);

  // Add future league-specific handlers here:
  // e.g. "XYZ": require("./schedule-xyz.js")
  const leagueModules = {
    NBHL: nbhlScheduleModule
  };

  const selectedModule = leagueModules[leagueName] || defaultScheduleModule;
  const handler = selectedModule?.handleScheduleUpdate;

  if (typeof handler !== "function") {
    throw new Error(`Schedule handler missing for league "${leagueName || "UNKNOWN"}".`);
  }

  return handler;
}

async function handleScheduleUpdate(baseFolder) {
  const handler = getScheduleHandler(baseFolder);
  return handler(baseFolder);
}

module.exports = {
  handleScheduleUpdate
};
