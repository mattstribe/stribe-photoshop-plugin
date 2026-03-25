const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

const DOC_ID = "HAVE-A-DAY";
const DOC_EXPORT = "Have-A-Day";
const PLAYER_TEMPLATE = "HAVE-A-DAY-PLAYER.psd";
const GOALIE_TEMPLATE = "HAVE-A-DAY-GOALIE.psd";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleHaveADayUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {
    await leagueConfig.invalidateLeagueCache(baseFolder);

    const [leagueData, haveADayPlayerData, haveADayGoalieData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadHaveADayPlayers(baseFolder),
      leagueConfig.loadHaveADayGoalies(baseFolder)
    ]);

    const { teams, divs } = leagueData;
    const week = Number(haveADayPlayerData.week || haveADayGoalieData.week || 0);

    const activePlayerRows = (haveADayPlayerData.rows || [])
      .filter((r) => Number(r.week) === week)
      .map((r, idx) => ({
        ...r,
        role: "PLAYER",
        sourceSheet: "HAVE A DAY PLAYER",
        sourceIndex: idx,
        templateName: PLAYER_TEMPLATE,
        stat1: r.goals,
        stat2: r.points,
        stat3: r.wins
      }));

    const playerIdentitySet = new Set(
      activePlayerRows.map((r) => `${normalizeTeamKey(r.fullName)}|${normalizeTeamKey(r.teamName)}`)
    );

    const activeGoalieRows = (haveADayGoalieData.rows || [])
      .filter((r) => Number(r.week) === week)
      .map((r, idx) => ({
        ...r,
        role: "GOALIE",
        sourceSheet: "HAVE A DAY GOALIE",
        sourceIndex: idx,
        templateName: GOALIE_TEMPLATE,
        stat1: r.gp,
        stat2: r.gaa,
        stat3: r.wins
      }))
      // If the same person/team is already featured on the PLAYER sheet for this week,
      // prefer the player graphic and skip the goalie duplicate.
      .filter((r) => !playerIdentitySet.has(`${normalizeTeamKey(r.fullName)}|${normalizeTeamKey(r.teamName)}`));

    const activeRows = [...activePlayerRows, ...activeGoalieRows];
    console.log(`[HAVE-A-DAY] league=${baseFolder?.name} week=${week} playerRows=${activePlayerRows.length} goalieRows=${activeGoalieRows.length} activeRows=${activeRows.length}`);
    if (activeRows.length) {
      console.log("[HAVE-A-DAY] sample rows:", activeRows.slice(0, 5).map((r) => ({
        role: r.role,
        sourceSheet: r.sourceSheet,
        sourceIndex: r.sourceIndex,
        week: r.week,
        teamName: r.teamName,
        fullName: r.fullName,
        stat1: r.stat1,
        stat2: r.stat2,
        stat3: r.stat3
      })));
    }

    if (!activeRows.length) {
      statusEl.textContent = `⚠️ No HAVE-A-DAY rows for Week ${week}`;
      return;
    }

    let gamedayFolder;
    try {
      gamedayFolder = await baseFolder.getEntry("Gameday Graphics");
    } catch {
      gamedayFolder = baseFolder;
    }

    let previousDocId = null;
    let processed = 0;
    let skippedNoTeam = 0;
    let skippedNoTemplate = 0;

    for (let i = 0; i < activeRows.length; i++) {
      const row = activeRows[i];
      const teamCtx = getTeamContext(row.teamName, row.division, teams, divs);
      if (!teamCtx) {
        skippedNoTeam += 1;
        console.warn(`[HAVE-A-DAY] Skipping row ${i + 1}/${activeRows.length}: team not found`, {
          teamName: row.teamName,
          fullName: row.fullName,
          division: row.division
        });
        continue;
      }

      const templateInfo = await resolveHaveADayTemplate(gamedayFolder, row.templateName);
      if (!templateInfo || !templateInfo.file) {
        skippedNoTemplate += 1;
        console.warn(`[HAVE-A-DAY] No template found`, {
          sourceSheet: row.sourceSheet,
          sourceIndex: row.sourceIndex,
          role: row.role,
          teamName: row.teamName,
          fullName: row.fullName,
          templateName: row.templateName
        });
        continue;
      }
      const { file: templateFile, folder: templateFolder } = templateInfo;

      const exportFolder = await ensureFolderPath(gamedayFolder, ["Exports", `Week ${week}`, DOC_EXPORT]);
      const exportFile = await exportFolder.createFile(
        sanitizeFilename(`${teamCtx.teamName}_${row.lastName}_${row.role}_Have-A-Day.png`),
        { overwrite: true }
      );
      console.log(`[HAVE-A-DAY] Row ${i + 1}/${activeRows.length} -> export=${exportFile.name}`, {
        role: row.role,
        sourceSheet: row.sourceSheet,
        sourceIndex: row.sourceIndex,
        template: row.templateName,
        templateFolder: templateFolder?.name,
        templateNativePath: templateFile?.nativePath,
        team: teamCtx.fullTeam,
        conf: teamCtx.conf,
        divAbb: teamCtx.divAbb,
        colors: { c1: teamCtx.color1, c2: teamCtx.color2, c3: teamCtx.color3 },
        stats: { stat1: row.stat1, stat2: row.stat2, stat3: row.stat3, number: row.number }
      });

      statusEl.innerHTML = `Updating HAVE-A-DAY ${i + 1}/${activeRows.length}...`;

      await core.executeAsModal(async () => {
        // Close the previous processed doc first so it cannot steal focus
        // after we open the next template.
        if (previousDocId) {
          const prev = app.documents.find((d) => d._id === previousDocId);
          if (prev) {
            await delay(200);
            await prev.close();
          }
          previousDocId = null;
        }

        console.log(`[HAVE-A-DAY] Opening template`, {
          sourceSheet: row.sourceSheet,
          sourceIndex: row.sourceIndex,
          role: row.role,
          requestedTemplate: row.templateName,
          fileName: templateFile?.name,
          filePath: templateFile?.nativePath
        });
        const opened = await app.open(templateFile);
        const doc = Array.isArray(opened) ? opened[0] : opened;
        console.log(`[HAVE-A-DAY] Active document after open`, {
          sourceSheet: row.sourceSheet,
          sourceIndex: row.sourceIndex,
          role: row.role,
          docTitle: doc?.title,
          docId: doc?._id
        });

        const header = getByName(doc, "HEADER");
        const stats = getByName(doc, "STATS");
        const player = getByName(doc, "PLAYER");
        const jersey = getByName(doc, "JERSEY");
        const teamColorStats = getByName(doc, "TEAM COLOR STATS");

        // PLAYER
        const playerLastName = player ? getByName(player, "LAST NAME") : null;
        const playerNumber = player ? getByName(player, "#") : null;
        if (playerLastName && playerLastName.textItem) playerLastName.textItem.contents = String(row.lastName || "").toUpperCase();
        if (playerNumber && playerNumber.textItem) playerNumber.textItem.contents = String(row.number || "");

        // STATS
        await updateStatFolder(stats, "Stat 1", row.stat1);
        await updateStatFolder(stats, "Stat 2", row.stat2);
        await updateStatFolder(stats, "Stat 3", row.stat3);

        // TEAM COLORS
        if (teamColorStats) await fillColor(teamColorStats, teamCtx.color2);
        if (jersey) {
          const jerseyColor1 = getByName(jersey, "TEAM COLOR");
          const jerseyColor2 = getByName(jersey, "TEAM COLOR 2");
          const jerseyColor3 = getByName(jersey, "TEAM COLOR 3");
          if (jerseyColor1) await fillColor(jerseyColor1, teamCtx.color1);
          if (jerseyColor2) await fillColor(jerseyColor2, teamCtx.color2);
          if (jerseyColor3) await fillColor(jerseyColor3, teamCtx.color3);
        }

        // HEADER
        if (header) {
          const tierFolder = getByName(header, "TIER");
          const sponsorsBlack = getByName(header, "BLACK Sponsors");
          const sponsorsWhite = getByName(header, "WHITE Sponsors");
          const logoLayer = getByName(header, "LOGO");
          const emblemLayer = getByName(header, "EMBLEM");

          applyTierVisibility(tierFolder, teamCtx.conf);

          if (logoLayer) {
            const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(teamCtx.conf)}/${encodeURIComponent(teamCtx.divAbb)}/${encodeURIComponent(teamCtx.fullTeam)}.png`;
            let ok = await imageHandler.replaceLayerWithImage(logoLayer, logoUrl);
            if (!ok) ok = await imageHandler.replaceLayerWithImage(logoLayer, `LOGOS/TEAMS/${teamCtx.conf}/${teamCtx.divAbb}/${teamCtx.fullTeam}.png`, baseFolder);
            if (!ok) await imageHandler.replaceLayerWithImage(logoLayer, "LOGOS/LeagueLogo.png", baseFolder);
          }

          if (emblemLayer) {
            await imageHandler.replaceLayerWithImage(emblemLayer, `LOGOS/Division Emblems/PNG/${teamCtx.divAbb}_emblem.png`, baseFolder);
          }

          const light = relativeLuminance(teamCtx.color1) > 0.7;
          if (sponsorsBlack) sponsorsBlack.visible = light;
          if (sponsorsWhite) sponsorsWhite.visible = !light;
        }

        // Text contrast based on TEAM COLOR luminance
        if (playerLastName && playerLastName.textItem) setTextColor(playerLastName, teamCtx.color1);
        if (playerNumber && playerNumber.textItem) setTextColor(playerNumber, teamCtx.color1);
        setStatTextColors(stats, teamCtx.color1);

        const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, exportFile.name);
        await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);
        console.log(`[HAVE-A-DAY] Exported: ${exportFile.name}`);

        // User requested template can be saved directly (no per-row working files)
        await doc.save();
        previousDocId = doc._id;
      }, { commandName: "Update HAVE-A-DAY" });

      processed += 1;
    }

    console.log("[HAVE-A-DAY] Run summary", {
      activeRows: activeRows.length,
      processed,
      skippedNoTeam,
      skippedNoTemplate
    });
    statusEl.innerHTML = `✅ Updated ${processed} HAVE-A-DAY graphics`;
  } catch (err) {
    statusEl.textContent = "⚠️ Error updating HAVE-A-DAY";
    console.error("Error:", err);
  }
}

async function updateStatFolder(statsRoot, statFolderName, value) {
  if (!statsRoot) return;
  const statFolder = getByName(statsRoot, statFolderName);
  if (!statFolder) return;
  const numberLayer = getByName(statFolder, "#");
  if (numberLayer && numberLayer.textItem) {
    numberLayer.textItem.contents = String(value ?? "");
  }
}

function setStatTextColors(statsRoot, teamColor) {
  if (!statsRoot || !statsRoot.layers) return;
  for (let i = 0; i < statsRoot.layers.length; i++) {
    const statFolder = statsRoot.layers[i];
    const numberLayer = getByName(statFolder, "#");
    const statLabelLayer = getByName(statFolder, "STAT");
    if (numberLayer && numberLayer.textItem) setTextColor(numberLayer, teamColor);
    if (statLabelLayer && statLabelLayer.textItem) setTextColor(statLabelLayer, teamColor);
  }
}

function getTeamContext(teamName, rowDivision, teams, divs) {
  const teamNeedle = normalizeTeamKey(teamName);
  if (!teamNeedle) return null;

  // Strict matching only (user guarantees exact names in sheet).
  // Prefer exact Full Team match first, then exact Team Name match.
  let team = teams.find((t) => normalizeTeamKey(t.fullTeam) === teamNeedle);
  if (!team) {
    team = teams.find((t) => normalizeTeamKey(t.teamName) === teamNeedle);
  }
  if (!team) return null;

  const fullDiv = leagueConfig.normalizeDivName(team.div, divs);
  let divInfo = divs.find((d) => `${d.conf} ${d.div}` === fullDiv);

  // Fallback: many team sheets store division as abbreviation (e.g. "PHI2")
  // rather than "CONF DIV" full string.
  if (!divInfo) {
    const teamDivAbb = String(team.div || "").trim().toUpperCase();
    if (teamDivAbb) {
      divInfo = divs.find((d) => String(d.abb || "").trim().toUpperCase() === teamDivAbb);
    }
  }

  // Final fallback: use row-provided division value from HAVE-A-DAY sheet.
  if (!divInfo) {
    const rowDivAbb = String(rowDivision || "").trim().toUpperCase();
    if (rowDivAbb) {
      divInfo = divs.find((d) => String(d.abb || "").trim().toUpperCase() === rowDivAbb);
    }
  }
  if (!divInfo) return null;

  const color1 = pickColor(team.color1, "000000");
  const color2 = pickColor(team.color2, color1);
  const color3 = pickColor(team.color3, color2, color1);

  return {
    teamName: String(team.teamName || "").trim(),
    fullTeam: String(team.fullTeam || team.teamName || "").trim(),
    conf: String(divInfo.conf || "").trim(),
    divAbb: String(divInfo.abb || "").trim(),
    color1,
    color2,
    color3
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

function pickColor(...candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const c = String(candidates[i] || "").trim();
    if (c) return c;
  }
  return "000000";
}

async function resolveHaveADayTemplate(gamedayFolder, templateName) {
  const root = await tryGetFolder(gamedayFolder, DOC_ID);
  if (!root) return null;
  const file = await tryGetFile(root, templateName);
  if (!file) return null;
  return { folder: root, file };
}

function applyTierVisibility(tierFolder, conf) {
  if (!tierFolder || !tierFolder.layers) return;
  const target = normalizeLabel(conf);
  for (let i = 0; i < tierFolder.layers.length; i++) {
    const layer = tierFolder.layers[i];
    layer.visible = normalizeLabel(layer.name) === target;
  }
}

function normalizeLabel(value) {
  return String(value || "").toUpperCase().replace(/’/g, "'").replace(/\s+/g, " ").trim();
}

function hexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "").trim();
  return {
    r: parseInt(h.slice(0, 2) || "00", 16),
    g: parseInt(h.slice(2, 4) || "00", 16),
    b: parseInt(h.slice(4, 6) || "00", 16)
  };
}

async function fillColor(layer, hex) {
  if (!layer) return;
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay(
    [
      {
        _obj: "select",
        _target: [{ _ref: "layer", _id: layer._id }],
        makeVisible: false,
        selectionModifier: { _enum: "selectionModifierType", _value: "replaceSelection" },
        _isCommand: true
      }
    ],
    { synchronousExecution: true }
  );
  await app.batchPlay(
    [
      {
        _obj: "set",
        _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "solidColorLayer",
          color: { _obj: "RGBColor", red: r, green: g, blue: b }
        }
      }
    ],
    { synchronousExecution: true }
  );
}

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

function setTextColor(layer, backgroundColor) {
  if (!layer || !layer.textItem) return;
  const color = new app.SolidColor();
  const luminance = relativeLuminance(backgroundColor);
  color.rgb.hexValue = luminance >= 0.7 ? "252525" : "ffffff";
  layer.textItem.characterStyle.color = color;
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

async function tryGetFolder(parent, name) {
  if (!parent) return null;
  try {
    return await parent.getEntry(name);
  } catch {
    return null;
  }
}

async function tryGetFile(parent, name) {
  if (!parent) return null;
  try {
    return await parent.getEntry(name);
  } catch {
    return null;
  }
}

function sanitizeFilename(name) {
  return String(name || "have-a-day.png")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

const getByName = (parent, name) => {
  if (!parent) return null;
  const layers = parent.layers || parent;
  if (!layers || !layers.find) return null;
  return layers.find((l) => l.name === name);
};

module.exports = {
  handleHaveADayUpdate
};
