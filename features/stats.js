const defaultStatsModule = require("./stats-default.js");
const nbhlStatsModule = require("./stats-nbhl.js");
const lugStatsModule = require("./stats-lug.js");

function normalizeLeagueName(baseFolder) {
  return String(baseFolder?.name || "").trim().toUpperCase();
}

function getStatsHandler(baseFolder) {
  const leagueName = normalizeLeagueName(baseFolder);

  // Add future league-specific handlers here:
  // e.g. "XYZ": require("./stats-xyz.js")
  const leagueModules = {
    NBHL: nbhlStatsModule,
    LUG: lugStatsModule
  };

  const selectedModule = leagueModules[leagueName] || defaultStatsModule;
  const handler = selectedModule?.handleStatsUpdate;

  if (typeof handler !== "function") {
    throw new Error(`Stats handler missing for league "${leagueName || "UNKNOWN"}".`);
  }

  return handler;
}

async function handleStatsUpdate(baseFolder) {
  const handler = getStatsHandler(baseFolder);
  return handler(baseFolder);
}

module.exports = {
  handleStatsUpdate
};
