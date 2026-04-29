const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

const TEMPLATE_FILES = ["POWER-RANKINGS.psd", "POWER-RANKINGS_SIDE-BAR.psd"];
const TEMPLATE_PATH_SEGMENTS = ["GRAPHICS", "2026", "NHLN Broadcast"];

async function handlePowerRankingsUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {
    await leagueConfig.invalidateLeagueCache(baseFolder);
    const leagueData = await leagueConfig.loadLeagueConfig(baseFolder);
    const { divs, teams } = leagueData;

    const tierNames = getTierNamesFromDivs(divs);
    if (!tierNames.length) {
      statusEl.textContent = "⚠️ No tiers found in divs config.";
      return;
    }

    const divAbbByConfDiv = {};
    for (let i = 0; i < divs.length; i++) {
      divAbbByConfDiv[`${divs[i].conf} ${divs[i].div}`] = String(divs[i].abb || "").trim();
    }

    const tierPlans = tierNames.map((tierName) => ({
      tierName,
      rankedTeams: buildRankedTierTeams(teams, tierName)
    }));
    const nonEmptyTierPlans = tierPlans.filter((p) => p.rankedTeams.length > 0);

    if (!nonEmptyTierPlans.length) {
      statusEl.textContent = "⚠️ No ranked teams found in any tier (PR column is empty).";
      return;
    }

    const templateFolder = await resolveTemplateFolder(baseFolder);
    const outputFolder = await ensureFolderPath(templateFolder, ["POWER RANKINGS"]);
    const pngOutputFolder = await ensureFolderPath(outputFolder, ["PNG"]);
    const templateFiles = [];
    for (let i = 0; i < TEMPLATE_FILES.length; i++) {
      templateFiles.push(await templateFolder.getEntry(TEMPLATE_FILES[i]));
    }

    for (let i = 0; i < nonEmptyTierPlans.length; i++) {
      const tierName = nonEmptyTierPlans[i].tierName;
      const rankedTeams = nonEmptyTierPlans[i].rankedTeams;
      statusEl.textContent = `POWER-RANKINGS: ${tierName} (${i + 1}/${nonEmptyTierPlans.length})...`;

      for (let t = 0; t < templateFiles.length; t++) {
        const templateFile = templateFiles[t];

        await core.executeAsModal(async () => {
          await app.open(templateFile);
          const doc = app.activeDocument;
          const outputBaseName = `${String(templateFile.name || "").replace(/\.psd$/i, "")}_${sanitizeFilename(tierName)}`;

          const outputFile = await outputFolder.createFile(
            `${outputBaseName}.psd`,
            { overwrite: true }
          );
          if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(outputFile);

          const header = getByName(doc, "HEADER");
          const tierFolder = header ? getByName(header, "TIER") : null;
          applyTierVisibility(tierFolder, tierName);
          if (!/SIDE-BAR/i.test(String(templateFile.name || ""))) {
            updateOutOfTeamsText(header, rankedTeams.length);
          }

          const topTen = rankedTeams.slice(0, 10);
          const overflow = rankedTeams.slice(10);

          const tenTeamFolder = getByName(doc, "10 team");
          const fifteenTeamFolder = getByName(doc, "15 team");
          if (tenTeamFolder && rankedTeams.length <= 5) {
            await translate(tenTeamFolder, 400, 0);
          }

          await updateTeamSlots(tenTeamFolder, topTen, divAbbByConfDiv, baseFolder);
          await updateTeamSlots(fifteenTeamFolder, overflow, divAbbByConfDiv, baseFolder);

          const pngFile = await pngOutputFolder.createFile(`${outputBaseName}.png`, { overwrite: true });
          await exportHandler.exportPng(doc, pngFile, null, cloudExportEnabled);

          await doc.save();
          await doc.close();
        }, { commandName: `${String(templateFile.name || "").replace(/\.psd$/i, "")} ${tierName}` });
      }
    }

    statusEl.textContent = `✅ POWER-RANKINGS updated for ${nonEmptyTierPlans.length} tiers`;
  } catch (err) {
    console.error("Power rankings update error:", err);
    statusEl.textContent = `⚠️ ${err.message || "Error running POWER-RANKINGS update"}`;
  }
}

function getTierNamesFromDivs(divs) {
  const seen = {};
  const tiers = [];
  for (let i = 0; i < divs.length; i++) {
    const tierName = String(divs[i].conf || "").trim();
    if (!tierName) continue;
    const key = tierName.toUpperCase();
    if (seen[key]) continue;
    seen[key] = true;
    tiers.push(tierName);
  }
  return tiers;
}

function buildRankedTierTeams(teams, tierName) {
  const targetTier = String(tierName || "").trim().toUpperCase();
  return teams
    .filter((t) => {
      if (String(t.conf || "").trim().toUpperCase() !== targetTier) return false;
      return parsePowerRanking(t.powerRanking) !== null;
    })
    .slice()
    .sort((a, b) => {
      const pa = parsePowerRanking(a.powerRanking);
      const pb = parsePowerRanking(b.powerRanking);
      if (pa !== pb) return pa - pb;
      return String(a.teamName || "").localeCompare(String(b.teamName || ""));
    });
}

async function updateTeamSlots(parentFolder, rankedTeams, divAbbByConfDiv, baseFolder) {
  if (!parentFolder || !parentFolder.layers) return;

  const teamFolders = parentFolder.layers
    .filter((l) => /^TEAM\s+\d+$/i.test(String(l.name || "")))
    .sort((a, b) => extractTeamIndex(a.name) - extractTeamIndex(b.name));

  for (let i = 0; i < teamFolders.length; i++) {
    const teamFolder = teamFolders[i];
    const team = rankedTeams[i];
    if (!team) {
      teamFolder.visible = false;
      continue;
    }
    teamFolder.visible = true;
    await updateTeamFolder(teamFolder, team, divAbbByConfDiv, baseFolder, i + 1);
  }
}

async function updateTeamFolder(teamFolder, team, divAbbByConfDiv, baseFolder, rankNumber) {
  const rankLayer = getByName(teamFolder, "RANK");
  const divisionLayer = getByName(teamFolder, "DIVISION");
  const teamCityLayer = getByName(teamFolder, "TEAM CITY");
  const teamNameLayer = getByName(teamFolder, "TEAM NAME");
  const logoLayer = getByName(teamFolder, "LOGO");
  const teamColorLayer = getByName(teamFolder, "TEAM COLOR");

  const conf = String(team.conf || "").trim();
  const div = String(team.div || "").trim();
  const confDiv = `${conf} ${div}`;
  const divAbb = String(divAbbByConfDiv[confDiv] || "").trim();
  const teamColor = String(team.color1 || "000000").trim();
  const powerRank = parsePowerRanking(team.powerRanking);

  if (rankLayer && rankLayer.textItem) {
    rankLayer.textItem.contents = powerRank !== null ? String(powerRank) : String(rankNumber);
  }
  if (divisionLayer && divisionLayer.textItem) {
    divisionLayer.textItem.contents = divAbb.toUpperCase();
  }
  if (teamCityLayer && teamCityLayer.textItem) {
    teamCityLayer.textItem.contents = String(team.teamCity || "").toUpperCase();
  }
  if (teamNameLayer && teamNameLayer.textItem) {
    teamNameLayer.textItem.contents = String(team.teamName || "").toUpperCase();
  }
  if (teamColorLayer) {
    await fillColor(teamColorLayer, teamColor);
  }
  // Match standings-nbhl luminance behavior for black/white text on team color bars.
  if (divisionLayer && divisionLayer.textItem) setTextColor(divisionLayer, teamColor);
  if (teamCityLayer && teamCityLayer.textItem) setTextColor(teamCityLayer, teamColor);
  if (teamNameLayer && teamNameLayer.textItem) setTextColor(teamNameLayer, teamColor);
  if (logoLayer) {
    const fullTeam = String(team.fullTeam || "").trim();
    const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(fullTeam)}.png`;
    let ok = await imageHandler.replaceLayerWithImage(logoLayer, logoUrl);
    if (!ok) ok = await imageHandler.replaceLayerWithImage(logoLayer, `LOGOS/TEAMS/${conf}/${divAbb}/${fullTeam}.png`, baseFolder);
    if (!ok) await imageHandler.replaceLayerWithImage(logoLayer, "LOGOS/LeagueLogo.png", baseFolder);
  }
}

function applyTierVisibility(tierFolder, tierName) {
  if (!tierFolder || !tierFolder.layers) return;
  const target = normalizeLabel(tierName);
  for (let i = 0; i < tierFolder.layers.length; i++) {
    const layer = tierFolder.layers[i];
    layer.visible = normalizeLabel(layer.name) === target;
  }
}

function updateOutOfTeamsText(headerFolder, teamCount) {
  if (!headerFolder) return;
  const layer = findOutOfTeamsLayer(headerFolder);
  if (layer && layer.textItem) {
    layer.textItem.contents = `OUT OF ${Number(teamCount) || 0} TEAMS`;
  }
}

function findOutOfTeamsLayer(rootLayer) {
  const queue = [rootLayer];
  while (queue.length) {
    const node = queue.shift();
    const children = node && node.layers ? node.layers : [];
    for (let i = 0; i < children.length; i++) {
      const layer = children[i];
      if (isOutOfTeamsLayer(layer)) return layer;
      if (layer.layers && layer.layers.length) queue.push(layer);
    }
  }
  return null;
}

function isOutOfTeamsLayer(layer) {
  if (!layer || !layer.textItem) return false;
  const name = String(layer.name || "").toUpperCase().trim();
  const text = String(layer.textItem.contents || "").toUpperCase().trim();
  if (name === "OUT OF" || name === "OUT OF TEAMS") return true;
  return text.includes("OUT OF") && text.includes("TEAMS");
}

async function resolveTemplateFolder(baseFolder) {
  try {
    return await getFolderPath(baseFolder, TEMPLATE_PATH_SEGMENTS);
  } catch {
    return await getFolderPath(baseFolder, [baseFolder.name, ...TEMPLATE_PATH_SEGMENTS]);
  }
}

async function getFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (let i = 0; i < segments.length; i++) {
    current = await current.getEntry(segments[i]);
  }
  return current;
}

async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (let i = 0; i < segments.length; i++) {
    try {
      current = await current.getEntry(segments[i]);
    } catch {
      current = await current.createFolder(segments[i]);
    }
  }
  return current;
}

function extractTeamIndex(name) {
  const m = String(name || "").match(/TEAM\s+(\d+)/i);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function parsePowerRanking(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normalizeLabel(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getByName(parent, name) {
  if (!parent) return null;
  const layers = parent.layers || parent;
  if (!layers || !layers.find) return null;
  return layers.find((l) => l.name === name);
}

function hexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "").trim();
  return {
    r: parseInt(h.slice(0, 2) || "00", 16),
    g: parseInt(h.slice(2, 4) || "00", 16),
    b: parseInt(h.slice(4, 6) || "00", 16)
  };
}

const setTextColor = (layer, backgroundColor) => {
  const color = new app.SolidColor();
  const luminance = relativeLuminance(backgroundColor);
  color.rgb.hexValue = luminance >= 0.7 ? "252525" : "ffffff";
  layer.textItem.characterStyle.color = color;
};

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rs = r / 255;
  const gs = g / 255;
  const bs = b / 255;
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const rl = toLinear(rs);
  const gl = toLinear(gs);
  const bl = toLinear(bs);
  return (0.2126 * rl) + (0.7152 * gl) + (0.0722 * bl);
}

async function fillColor(layer, hex) {
  if (!layer) return;
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: layer._id }], makeVisible: false }],
    { synchronousExecution: true }
  );
  await app.batchPlay(
    [{ _obj: "set", _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: r, green: g, blue: b } } }],
    { synchronousExecution: true }
  );
}

async function translate(layer, deltaX, deltaY) {
  const dx = Math.round(Number(deltaX) || 0);
  const dy = Math.round(Number(deltaY) || 0);
  if (!dx && !dy) return;
  await app.batchPlay(
    [
      {
        _obj: "select",
        _target: [{ _ref: "layer", _id: layer._id }],
        makeVisible: true
      },
      {
        _obj: "transform",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: dx },
          vertical: { _unit: "pixelsUnit", _value: dy }
        }
      }
    ],
    { synchronousExecution: true }
  );
}

module.exports = {
  handlePowerRankingsUpdate
};
