const defaultStandingsModule = require("./standings-default.js");
const nbhlStandingsModule = require("./standings-nbhl.js");

function normalizeLeagueName(baseFolder) {
  return String(baseFolder?.name || "").trim().toUpperCase();
}

function getStandingsHandler(baseFolder) {
  const leagueName = normalizeLeagueName(baseFolder);

  // Add future league-specific handlers here:
  // e.g. "XYZ": require("./standings-xyz.js")
  const leagueModules = {
    NBHL: nbhlStandingsModule
  };

  const selectedModule = leagueModules[leagueName] || defaultStandingsModule;
  const handler = selectedModule?.handleStandingsUpdate;

  if (typeof handler !== "function") {
    throw new Error(`Standings handler missing for league "${leagueName || "UNKNOWN"}".`);
  }

  return handler;
}

async function handleStandingsUpdate(baseFolder) {
  const handler = getStandingsHandler(baseFolder);
  return handler(baseFolder);
}

module.exports = {
  handleStandingsUpdate
};
