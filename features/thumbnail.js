const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

const DOC_ID = "THUMBNAIL";
const DOC_EXPORT = "Thumbnails";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleThumbnailUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {
    await leagueConfig.invalidateLeagueCache(baseFolder);

    const [leagueData, scheduleData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadSchedule(baseFolder)
    ]);

    const { divs, confs, teams } = leagueData;
    const { schedule, week, year } = scheduleData;

    // Read user input (division abb, conference name, or ALL).
    const input = String(document.getElementById("divisionInput")?.value || "").trim().toUpperCase();
    let selectedConf = null;
    let selectedDivAbb = null;

    if (input && input !== "ALL") {
      const divMatch = divs.find((d) => input === String(d.abb || "").trim().toUpperCase());
      if (divMatch) {
        selectedDivAbb = String(divMatch.abb || "").trim();
      } else {
        const confMatch = confs.find((c) => input === String(c.conf || "").trim().toUpperCase());
        if (confMatch) selectedConf = String(confMatch.conf || "").trim();
      }
    }

    // Process all current-week games regardless of completion status.
    const finalGames = schedule.filter((g) => {
      const isCurrentWeek = Number(g.week) === Number(week);
      if (!isCurrentWeek) return false;

      const gameDivAbb = String(g.div1 || "").trim();
      const gameConf = String(g.conf || "").trim();
      if (selectedDivAbb && gameDivAbb !== selectedDivAbb) return false;
      if (selectedConf && !selectedDivAbb && gameConf !== selectedConf) return false;

      return true;
    });

    if (!finalGames.length) {
      const selectedTag = input && input !== "ALL" ? input : "ALL";
      statusEl.textContent = `⚠️ No games found for ${selectedTag} (Week ${week})`;
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

    for (let i = 0; i < finalGames.length; i++) {
      const game = finalGames[i];
      const divAbb = String(game.div1 || "").trim();
      const conf = String(game.conf || "").trim();
      const isPlayoff = String(game.gameType || "").toUpperCase() === "PLAYOFFS";
      const dateTextValue = isPlayoff
        ? `${String(game.round || "").trim()} - ${String(game.series || "").trim()}`.toUpperCase()
        : formatDateForThumbnail(game.date, year);
      const dateFileValue = isPlayoff
        ? `${formatDateForThumbnailFilename(game.date)}_Playoffs-${String(game.round || "").trim()}-${String(game.series || "").trim()}`
        : formatDateForThumbnailFilename(game.date);

      const templateInfo = await resolveThumbnailTemplate(gamedayFolder, divAbb, conf, isPlayoff);
      if (!templateInfo || !templateInfo.file) {
        console.warn(`No thumbnail template found for ${divAbb} (${isPlayoff ? "Playoffs" : "Regular"})`);
        continue;
      }

      const { folder: templateFolder, file: templateFile } = templateInfo;

      const workingFolder = await ensureFolderPath(templateFolder, ["Working Files"]);
      const workingFile = await workingFolder.createFile(
        sanitizeFilename(`${divAbb || "DIV"}_${DOC_ID}_${i + 1}_working.psd`),
        { overwrite: true }
      );

      const exportFolder = await ensureFolderPath(gamedayFolder, ["Exports", `Week ${week}`, DOC_EXPORT, divAbb || "UNKNOWN"]);
      const fullGameExport = await exportFolder.createFile(
        sanitizeFilename(`${dateFileValue}_${game.team1}_${game.team2}_FullGame.png`),
        { overwrite: true }
      );
      const highlightsExport = await exportFolder.createFile(
        sanitizeFilename(`${dateFileValue}_${game.team1}_${game.team2}_Highlights.png`),
        { overwrite: true }
      );

      statusEl.innerHTML = `Updating thumbnail ${i + 1}/${finalGames.length}...`;

      await core.executeAsModal(async () => {
        await app.open(templateFile);

        if (previousDocId) {
          const prev = app.documents.find((d) => d._id === previousDocId);
          if (prev) {
            await delay(300);
            await prev.close();
          }
          previousDocId = null;
        }

        const doc = app.activeDocument;
        if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(workingFile);

        const team1Folder = getByName(doc, "TEAM 1");
        const team2Folder = getByName(doc, "TEAM 2");
        const tierFolder = getByName(doc, "TIER");
        const emblemLayer = getByName(doc, "EMBLEM");
        const fullGameFolder = getByName(doc, "FULL GAME");
        const highlightsFolder = getByName(doc, "HIGHLIGHTS");

        const t1 = getTeamContext(game.team1, teams, divs, conf, divAbb, game.div1);
        const t2 = getTeamContext(game.team2, teams, divs, conf, divAbb, game.div2 || game.div1);

        await updateTeamFolder(team1Folder, t1, baseFolder);
        await updateTeamFolder(team2Folder, t2, baseFolder);

        if (emblemLayer && divAbb) {
          await imageHandler.replaceLayerWithImage(
            emblemLayer,
            `LOGOS/Division Emblems/PNG/${divAbb}_emblem.png`,
            baseFolder
          );
        }

        applyTierVisibility(tierFolder, conf);
        setDateLayers(fullGameFolder, highlightsFolder, dateTextValue);

        // Export FULL GAME
        if (fullGameFolder) fullGameFolder.visible = true;
        if (highlightsFolder) highlightsFolder.visible = false;
        const fullCdn = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, fullGameExport.name);
        await exportHandler.exportPng(doc, fullGameExport, fullCdn, cloudExportEnabled);

        // Export HIGHLIGHTS
        if (fullGameFolder) fullGameFolder.visible = false;
        if (highlightsFolder) highlightsFolder.visible = true;
        const highlightsCdn = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, highlightsExport.name);
        await exportHandler.exportPng(doc, highlightsExport, highlightsCdn, cloudExportEnabled);

        previousDocId = doc._id;
        await doc.save();
      }, { commandName: "Update THUMBNAIL" });

      processed += 1;
    }

    const selectedTag = input && input !== "ALL" ? input : "ALL";
    statusEl.innerHTML = `✅ Updated ${processed} thumbnails for ${selectedTag}`;
  } catch (err) {
    statusEl.textContent = "⚠️ Error updating THUMBNAIL";
    console.error("Error:", err);
  }
}

function getTeamContext(teamLabel, teams, divs, defaultConf, defaultDivAbb, gameDivAbb) {
  const nameRaw = String(teamLabel || "").trim();
  let fullTeam = nameRaw;
  let teamName = nameRaw;
  let color1 = "4a4a4a";
  let divAbb = defaultDivAbb;
  let conf = defaultConf;
  const gameDiv = String(gameDivAbb || "").trim();

  // Prefer explicit game division first (handles cross-division matchups reliably).
  if (gameDiv) {
    const gameDivInfo = divs.find((d) => String(d.abb || "").trim() === gameDiv);
    if (gameDivInfo) {
      divAbb = gameDivInfo.abb || divAbb;
      conf = gameDivInfo.conf || conf;
    } else {
      divAbb = gameDiv;
    }
  }

  const match = teams.find((t) => {
    const full = String(t.fullTeam || "").trim().toUpperCase();
    const short = String(t.teamName || "").trim().toUpperCase();
    const needle = nameRaw.toUpperCase();
    return full === needle || short === needle;
  });

  if (match) {
    fullTeam = String(match.fullTeam || nameRaw).trim();
    teamName = String(match.teamName || nameRaw).trim();
    color1 = String(match.color1 || color1).trim();

    // Only update divAbb/conf from the matched team record if the game didn't
    // already supply an explicit division. When gameDiv is set (from div1/div2
    // on the schedule row), that division is authoritative — overriding it with
    // whatever division the teams list happens to store this team under causes
    // logos to be looked up under the wrong conf/divAbb folder.
    if (!gameDiv) {
      const fullDiv = leagueConfig.normalizeDivName(match.div, divs);
      const divInfo = divs.find((d) => `${d.conf} ${d.div}` === fullDiv);
      if (divInfo) {
        divAbb = divInfo.abb || divAbb;
        conf = divInfo.conf || conf;
      }
    }
  }

  return { fullTeam, teamName, color1, divAbb, conf };
}

async function updateTeamFolder(teamFolder, teamCtx, baseFolder) {
  if (!teamFolder) return;

  const teamNameLayer = getByName(teamFolder, "TEAM NAME");
  const logoLayer = getByName(teamFolder, "LOGO");
  const teamColorLayer = getByName(teamFolder, "TEAM COLOR");

  if (teamColorLayer) await fillColor(teamColorLayer, teamCtx.color1);

  if (logoLayer) {
    const localPath = `LOGOS/TEAMS/${teamCtx.conf}/${teamCtx.divAbb}/${teamCtx.fullTeam}.png`;
    const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(teamCtx.conf)}/${encodeURIComponent(teamCtx.divAbb)}/${encodeURIComponent(teamCtx.fullTeam)}.png`;
    console.log(`[LOGO] conf="${teamCtx.conf}" divAbb="${teamCtx.divAbb}" fullTeam="${teamCtx.fullTeam}" → ${localPath}`);
    let ok = await imageHandler.replaceLayerWithImage(logoLayer, logoUrl);
    if (!ok) {
      ok = await imageHandler.replaceLayerWithImage(logoLayer, localPath, baseFolder);
    }
    if (!ok) {
      console.warn(`[LOGO] Not found, falling back to LeagueLogo: ${localPath}`);
      await imageHandler.replaceLayerWithImage(logoLayer, "LOGOS/LeagueLogo.png", baseFolder);
    }
  }

  if (teamNameLayer && teamNameLayer.textItem) {
    teamNameLayer.textItem.contents = String(teamCtx.teamName || "").toUpperCase();
  }
}

function applyTierVisibility(tierFolder, conf) {
  if (!tierFolder || !tierFolder.layers) return;
  const target = normalizeLabel(conf);
  for (let i = 0; i < tierFolder.layers.length; i++) {
    const layer = tierFolder.layers[i];
    layer.visible = normalizeLabel(layer.name) === target;
  }
}

function setDateLayers(fullGameFolder, highlightsFolder, value) {
  const fullDate = fullGameFolder ? getByName(fullGameFolder, "DATE") : null;
  const highlightsDate = highlightsFolder ? getByName(highlightsFolder, "DATE") : null;
  const text = String(value || "").toUpperCase();
  if (fullDate && fullDate.textItem) fullDate.textItem.contents = text;
  if (highlightsDate && highlightsDate.textItem) highlightsDate.textItem.contents = text;
}

async function resolveThumbnailTemplate(gamedayFolder, divAbb, conf, isPlayoff) {
  const templateRoot = await tryGetFolder(gamedayFolder, DOC_ID);
  if (!templateRoot) return null;

  // Same naming convention as stats/schedule: {DOC_ID}_Playoffs.psd in the DOC_ID folder,
  // falling back to the regular template if no playoff-specific file exists.
  const namesToTry = isPlayoff
    ? [`${DOC_ID}_Playoffs.psd`, `${DOC_ID}.psd`]
    : [`${DOC_ID}.psd`];

  for (const name of namesToTry) {
    const file = await tryGetFile(templateRoot, name);
    if (file) return { folder: templateRoot, file };
  }

  return null;
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

function formatDateForThumbnail(dateValue, year) {
  const raw = String(dateValue || "").trim();
  if (!raw) return String(year || "").trim();
  if (/\b\d{4}\b/.test(raw)) return raw.toUpperCase();
  const suffix = String(year || "").trim();
  return suffix ? `${raw}, ${suffix}`.toUpperCase() : raw.toUpperCase();
}

function formatDateForThumbnailFilename(dateValue) {
  // Example target: "Monday-June-16"
  // - Proper case for day/month words
  // - No year
  const raw = String(dateValue || "").trim();
  if (!raw) return "";

  // Remove a trailing/comma year like ", 2026" or " 2026".
  const withoutYear = raw.replace(/[\s,]*\b\d{4}\b/g, " ").replace(/\s+/g, " ").trim();

  const parts = withoutYear
    .split(/[\s,/-]+/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      // Keep numbers as-is.
      if (/^\d+$/.test(p)) return p;
      const lower = p.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });

  return parts.join("-");
}

function normalizeLabel(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFilename(name) {
  return String(name || "thumbnail.png")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
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

const getByName = (parent, name) => {
  if (!parent) return null;
  const layers = parent.layers || parent;
  if (!layers || !layers.find) return null;
  return layers.find((l) => l.name === name);
};

module.exports = {
  handleThumbnailUpdate
};
