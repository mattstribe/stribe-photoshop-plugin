const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

async function handleTeamsUpdate(baseFolder) {
  const statusEl = document.getElementById("status");
  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;
  try {
    await leagueConfig.invalidateLeagueCache(baseFolder);
    const leagueData = await leagueConfig.loadLeagueConfig(baseFolder);
    const { divs, confs, teams } = leagueData;

    const selected = leagueConfig.getUserDivision(divs);
    const activeDivs = buildActiveDivisions(divs, confs, selected);
    if (!activeDivs.length) {
      statusEl.textContent = "⚠️ No valid division selection for Teams Update.";
      return;
    }

    const activeDocName = String(app.activeDocument?.name || "");
    if (!/_TEMPLATE\.psd$/i.test(activeDocName)) {
      throw new Error('Active document must be named "{docType}_TEMPLATE.psd".');
    }
    const docType = getDocTypeFromTemplateName(activeDocName);
    const docTypeFolder = await getFolderPath(baseFolder, ["GRAPHICS", "2026", docType]);
    const templateFileName = `${docType}_TEMPLATE.psd`;
    try {
      await docTypeFolder.getEntry(templateFileName);
    } catch {
      throw new Error(`Template file not found at GRAPHICS/2026/${docType}/${templateFileName}`);
    }

    const activeTemplateDocId = app.activeDocument._id;
    const divLookup = {};
    for (let i = 0; i < divs.length; i++) {
      const key = `${divs[i].conf} ${divs[i].div}`;
      divLookup[key] = divs[i].abb;
    }

    const activeDivAbbs = new Set(activeDivs.map(d => d.abb));
    const filteredTeams = teams.filter(team => {
      const key = `${team.conf} ${team.div}`;
      const divAbb = divLookup[key];
      return !!divAbb && activeDivAbbs.has(divAbb);
    });

    if (!filteredTeams.length) {
      statusEl.textContent = "⚠️ No teams found for selected division filter.";
      return;
    }

    for (let i = 0; i < filteredTeams.length; i++) {
      const team = filteredTeams[i];
      const divAbb = divLookup[`${team.conf} ${team.div}`];
      const safeTeamName = sanitizeFilename(String(team.teamName || "TEAM").trim());
      const exportFileName = `${docType}_${safeTeamName}.png`;
      const statusName = `${team.teamCity || ""} ${team.teamName || ""}`.trim();
      statusEl.textContent = `Updating ${statusName} (${i + 1}/${filteredTeams.length})...`;

      await core.executeAsModal(async () => {
        const templateDoc = app.documents.find(d => d._id === activeTemplateDocId);
        if (!templateDoc) {
          throw new Error("Active template document is no longer available.");
        }
        const doc = templateDoc;

        const teamCityLayer = getByName(doc, "TEAM CITY");
        const teamNameLayer = getByName(doc, "TEAM NAME");
        const logoLayer = getByName(doc, "LOGO");
        const teamColorLayer = getByName(doc, "TEAM COLOR");
        const divisionLayer = getByName(doc, "DIVISION");
        const tierFolder = getByName(doc, "TIER");
        const tierColorsFolder = getByName(doc, "TIER COLOR");
        const tierTextLayer = getByName(doc, "TIER NAME");

        if (teamCityLayer && teamCityLayer.textItem) {
          teamCityLayer.textItem.contents = String(team.teamCity || "").toUpperCase();
        }
        if (teamNameLayer && teamNameLayer.textItem) {
          teamNameLayer.textItem.contents = String(team.teamName || "").toUpperCase();
        }
        if (divisionLayer && divisionLayer.textItem) {
          divisionLayer.textItem.contents = String(team.div || "").toUpperCase();
        }
        if (tierTextLayer && tierTextLayer.textItem) {
          tierTextLayer.textItem.contents = String(team.conf || "").toUpperCase();
        }
        if (teamColorLayer) {
          await fillColor(teamColorLayer, String(team.color1 || "000000"));
        }
        if (teamCityLayer && teamCityLayer.textItem) {
          setTextColor(teamCityLayer, String(team.color1 || "000000"));
        }
        if (teamNameLayer && teamNameLayer.textItem) {
          setTextColor(teamNameLayer, String(team.color1 || "000000"));
        }

        const teamTier = String(team.conf || "").trim().toUpperCase();
        if (tierFolder && Array.isArray(tierFolder.layers)) {
          for (let t = 0; t < tierFolder.layers.length; t++) {
            const layerName = String(tierFolder.layers[t].name || "").trim().toUpperCase();
            tierFolder.layers[t].visible = layerName === teamTier;
          }
        }
        if (tierColorsFolder && Array.isArray(tierColorsFolder.layers)) {
          for (let t = 0; t < tierColorsFolder.layers.length; t++) {
            const layerName = String(tierColorsFolder.layers[t].name || "").trim().toUpperCase();
            tierColorsFolder.layers[t].visible = layerName === teamTier;
          }
        }

        // Default these doc-level labels to white for non-Legends teams.
        setTextHex(divisionLayer, "ffffff");
        setTextHex(tierTextLayer, "ffffff");
        if (teamTier === "LEGENDS") {
          setTextHex(divisionLayer, "252525");
          setTextHex(tierTextLayer, "252525");
        }

        if (logoLayer) {
          const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(team.conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(team.fullTeam || "")}.png`;
          let logoOk = await imageHandler.replaceLayerWithImage(logoLayer, logoUrl);
          if (!logoOk) logoOk = await imageHandler.replaceLayerWithImage(logoLayer, `LOGOS/TEAMS/${team.conf}/${divAbb}/${team.fullTeam}.png`, baseFolder);
          if (!logoOk) await imageHandler.replaceLayerWithImage(logoLayer, "LOGOS/LeagueLogo.png", baseFolder);
        }

        const exportFile = await prepareTeamsExportFile(docTypeFolder, divAbb, exportFileName);
        const cdnPath = exportHandler.buildCdnPath(baseFolder.name, "Preseason", docType, exportFile.name);
        await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);
      }, { commandName: "Teams Update" });
    }

    statusEl.textContent = `✅ ${docType} updated for ${filteredTeams.length} teams (Exports folders ready in GRAPHICS/2026/${docType}/Exports)`;
  } catch (err) {
    console.error("Teams Update error:", err);
    statusEl.textContent = `⚠️ ${err.message || "Error running Teams Update"}`;
  }
}

function buildActiveDivisions(divs, confs, selected) {
  if (selected === "ALL") return divs.slice();

  const selectedDivs = [];
  for (let i = 0; i < divs.length; i++) {
    const confDiv = `${divs[i].conf} ${divs[i].div}`;
    if (confDiv === selected) {
      selectedDivs.push(divs[i]);
      return selectedDivs;
    }
  }

  for (let i = 0; i < confs.length; i++) {
    if (String(confs[i].conf || "").toUpperCase() !== String(selected || "").toUpperCase()) continue;
    for (let j = 0; j < divs.length; j++) {
      if (String(divs[j].conf || "").toUpperCase() === String(selected || "").toUpperCase()) {
        selectedDivs.push(divs[j]);
      }
    }
    break;
  }
  return selectedDivs;
}

function getDocTypeFromTemplateName(templateName) {
  return String(templateName).replace(/_TEMPLATE\.psd$/i, "");
}

async function getFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (const segment of segments) {
    current = await current.getEntry(segment);
  }
  return current;
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

async function prepareTeamsExportFile(docTypeFolder, divAbb, fileName) {
  const exportFolder = await ensureFolderPath(docTypeFolder, ["Exports", String(divAbb || "").trim()]);
  return await exportFolder.createFile(fileName, { overwrite: true });
}

function hexToRgb(hex) {
  const h = String(hex || "").replace(/^#/, "").trim();
  const r = parseInt(h.slice(0, 2) || "00", 16);
  const g = parseInt(h.slice(2, 4) || "00", 16);
  const b = parseInt(h.slice(4, 6) || "00", 16);
  return { r, g, b };
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

function getByName(parent, name) {
  const layers = parent.layers || parent;
  return layers.find(l => l.name === name);
}

function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "-")
    .replace(/\.+$/g, "");
}

function setTextColor(layer, backgroundColor) {
  if (!layer || !layer.textItem) return;
  const color = new app.SolidColor();
  const luminance = relativeLuminance(backgroundColor);
  color.rgb.hexValue = luminance >= 0.7 ? "252525" : "ffffff";
  layer.textItem.characterStyle.color = color;
}

function setTextHex(layer, hex) {
  if (!layer || !layer.textItem) return;
  const color = new app.SolidColor();
  color.rgb.hexValue = String(hex || "").replace(/^#/, "").toLowerCase();
  layer.textItem.characterStyle.color = color;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rs = r / 255;
  const gs = g / 255;
  const bs = b / 255;

  const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  const rl = toLinear(rs);
  const gl = toLinear(gs);
  const bl = toLinear(bs);

  return (0.2126 * rl) + (0.7152 * gl) + (0.0722 * bl);
}

module.exports = {
  handleTeamsUpdate
};
