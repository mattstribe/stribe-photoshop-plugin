const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

// Document identifiers for this script
const DOC_ID = "TOP PLAYS";   // folder + template basename (e.g., TOP PLAYS/TOP PLAYS.psd)
const DOC_EXPORT = "Top Plays";

async function handleTopPlaysUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {
    await leagueConfig.invalidateLeagueCache(baseFolder);

    const [leagueData, topPlaysData, scheduleData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadTopPlays(baseFolder),
      leagueConfig.loadSchedule(baseFolder)
    ]);

    const { teams, divs } = leagueData;
    const week = Number(topPlaysData.week || scheduleData.week || 0);
    const rows = topPlaysData.rows || [];

    if (!rows.length) {
      statusEl.textContent = "⚠️ No TOP PLAYS rows found";
      return;
    }

    let gamedayFolder;
    try {
      gamedayFolder = await baseFolder.getEntry("Gameday Graphics");
    } catch {
      gamedayFolder = baseFolder;
    }

    const topPlaysFolder = await gamedayFolder.getEntry(DOC_ID);
    const templateFile = await topPlaysFolder.getEntry(`${DOC_ID}.psd`);

    let previousDocId = null;
    let processed = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const teamCtx = getTopPlaysTeamContext(row, teams, divs);
      if (!teamCtx) {
        console.warn("[TOP PLAYS] Skipping row: team/div not resolved", row);
        continue;
      }

      const exportFolder = await ensureFolderPath(gamedayFolder, ["Exports", `Week ${week}`, DOC_EXPORT]);
      const exportFile = await exportFolder.createFile(
        sanitizeFilename(`Top-Plays_${row.rank}_${row.teamName}.png`),
        { overwrite: true }
      );

      statusEl.innerHTML = `Updating TOP PLAYS ${i + 1}/${rows.length}...`;

      await core.executeAsModal(async () => {
        if (previousDocId) {
          const prev = app.documents.find((d) => d._id === previousDocId);
          if (prev) await prev.close();
          previousDocId = null;
        }

        const opened = await app.open(templateFile);
        const doc = Array.isArray(opened) ? opened[0] : opened;

        const rankLayer = getByNameDeep(doc, "RANK");
        const namesLayer = getByNameDeep(doc, "NAMES");
        const teamDivTierLayer = getByNameDeep(doc, "TEAM DIV TIER");
        const logoLayer = getByNameDeep(doc, "LOGO");

        if (rankLayer && rankLayer.textItem) rankLayer.textItem.contents = `#${String(row.rank || "").trim()}`;
        if (namesLayer && namesLayer.textItem) namesLayer.textItem.contents = String(row.names || "").toUpperCase();
        if (teamDivTierLayer && teamDivTierLayer.textItem) {
          teamDivTierLayer.textItem.contents = `${teamCtx.fullTeam} - ${teamCtx.division} ${teamCtx.conf}`.toUpperCase();
        }

        if (logoLayer) {
          const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(teamCtx.conf)}/${encodeURIComponent(teamCtx.divAbb)}/${encodeURIComponent(teamCtx.fullTeam)}.png`;
          let ok = await imageHandler.replaceLayerWithImage(logoLayer, logoUrl);
          if (!ok) ok = await imageHandler.replaceLayerWithImage(logoLayer, `LOGOS/TEAMS/${teamCtx.conf}/${teamCtx.divAbb}/${teamCtx.fullTeam}.png`, baseFolder);
          if (!ok) await imageHandler.replaceLayerWithImage(logoLayer, "LOGOS/LeagueLogo.png", baseFolder);
        }

        const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, exportFile.name);
        await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);

        await doc.save();
        previousDocId = doc._id;
      }, { commandName: "Update TOP PLAYS" });

      processed += 1;
    }

    statusEl.innerHTML = `✅ Updated ${processed} TOP PLAYS graphics`;
  } catch (err) {
    statusEl.textContent = "⚠️ Error updating TOP PLAYS";
    console.error("Error:", err);
  }
}

function getTopPlaysTeamContext(row, teams, divs) {
  const needle = normalizeTeamKey(row.teamName);
  if (!needle) return null;

  let team = teams.find((t) => normalizeTeamKey(t.fullTeam) === needle);
  if (!team) team = teams.find((t) => normalizeTeamKey(t.teamName) === needle);
  if (!team) return null;

  let divInfo = null;
  const rowDivAbb = String(row.divAbb || "").trim().toUpperCase();
  if (rowDivAbb) {
    divInfo = divs.find((d) => String(d.abb || "").trim().toUpperCase() === rowDivAbb);
  }

  if (!divInfo) {
    const fullDiv = leagueConfig.normalizeDivName(team.div, divs);
    divInfo = divs.find((d) => `${d.conf} ${d.div}` === fullDiv);
  }
  if (!divInfo) return null;

  return {
    fullTeam: String(team.fullTeam || team.teamName || row.teamName || "").trim(),
    conf: String(divInfo.conf || "").trim(),
    division: String(divInfo.div || "").trim(),
    divAbb: String(divInfo.abb || rowDivAbb || "").trim()
  };
}

function normalizeTeamKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/’/g, "'")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (const segment of segments) {
    try {
      current = await current.getEntry(segment);
    } catch {
      current = await current.createFolder(segment);
    }
  }
  return current;
}

function sanitizeFilename(name) {
  return String(name || "Top-Plays.png")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getByNameDeep(parent, targetName) {
  if (!parent) return null;
  const stack = [...(parent.layers || [])];
  while (stack.length) {
    const layer = stack.shift();
    if (!layer) continue;
    if (layer.name === targetName) return layer;
    if (layer.layers && layer.layers.length) {
      for (let i = 0; i < layer.layers.length; i++) stack.push(layer.layers[i]);
    }
  }
  return null;
}

module.exports = {
  handleTopPlaysUpdate
};
