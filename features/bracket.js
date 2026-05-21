const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("../leagueConfig_200.js");
const imageHandler = require("../utils/imageHandler.js");
const exportHandler = require("../utils/exportHandler.js");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const DOC_ID = 'BRACKET';
const DOC_EXPORT = 'Bracket';

async function handleBracketUpdate(baseFolder) {
  const statusEl = document.getElementById("status");

  const exportToCloudCheckbox = document.getElementById("exportToCloudCheckbox");
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {
    statusEl.innerHTML = "Loading bracket data...";

    await leagueConfig.invalidateLeagueCache(baseFolder);

    const [leagueData, bracketRows] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadBracket(baseFolder),
    ]);

    const { divs, confs, teams } = leagueData;

    if (!bracketRows.length) {
      statusEl.innerHTML = "No bracket data found.";
      return;
    }

    // Get user division input
    const userDiv = leagueConfig.getUserDivision(divs);
    console.log(`Selected division for BRACKET: ${userDiv}`);

    // Group bracket rows by division
    const divMap = {};
    for (const row of bracketRows) {
      if (!divMap[row.division]) divMap[row.division] = [];
      divMap[row.division].push(row);
    }

    // Determine which divAbbs to process
    let targetAbbs;
    if (userDiv === 'ALL') {
      targetAbbs = Object.keys(divMap);
    } else {
      // userDiv is "CONF DIV" — find matching abb
      const meta = divs.find(d => (d.conf + ' ' + d.div) === userDiv);
      if (!meta) {
        statusEl.innerHTML = `Division "${userDiv}" not found.`;
        return;
      }
      targetAbbs = [meta.abb];
    }

    // Navigate to the BRACKET template folder
    let gamedayFolder;
    try { gamedayFolder = await baseFolder.getEntry('Gameday Graphics'); }
    catch { gamedayFolder = baseFolder; }

    const templateFolder = await gamedayFolder.getEntry(DOC_ID);

    let workingFolder;
    try { workingFolder = await templateFolder.getEntry('Working Files'); }
    catch { workingFolder = await templateFolder.createFolder('Working Files'); }

    let previousDocId = null;

    for (const divAbb of targetAbbs) {
      const divBracket = divMap[divAbb];
      if (!divBracket || !divBracket.length) continue;

      // Look up div metadata
      const divMeta = divs.find(d => d.abb === divAbb);
      if (!divMeta) {
        console.warn(`No division metadata found for abb "${divAbb}", skipping.`);
        continue;
      }

      const conf        = divMeta.conf;
      const division    = divMeta.div;
      const divColorHex = String(divMeta.color1 || 'ffffff');

      let confLocation = null;
      for (const c of confs) {
        if (c.conf === conf) { confLocation = c.location; break; }
      }

      // Template file — try division-specific bracket first, then default
      let templateFile;
      try { templateFile = await templateFolder.getEntry(`${divAbb}_${DOC_ID}.psd`); }
      catch { templateFile = await templateFolder.getEntry(`${DOC_ID}.psd`); }

      const workingFileName = `${divAbb}_${DOC_ID}_working.psd`;
      const saveFile = await workingFolder.createFile(workingFileName, { overwrite: true });

      statusEl.innerHTML = `Updating ${divAbb} Bracket...`;

      let newDocId = null;
      await core.executeAsModal(async () => {
        await app.open(templateFile);

        if (userDiv === 'ALL' && previousDocId) {
          const prev = app.documents.find(d => d._id === previousDocId);
          if (prev) { await delay(1000); await prev.close(); }
        }

        const doc = app.activeDocument;
        newDocId = doc._id;
        if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);

        // ── HEADER (same as standings-nbhl.js) ──────────────────────────
        const header           = getByName(doc, 'HEADER');
        const background       = getByName(doc, 'BACKGROUND');
        const sponsorsFolder   = getByName(doc, 'Sponsors');
        const sponsorBar       = sponsorsFolder ? getByName(sponsorsFolder, 'SPONSOR BAR') : null;
        const backgroundBlack  = background ? getByName(background, 'BLACK') : null;
        const backgroundWhite  = background ? getByName(background, 'WHITE') : null;

        const divisionText        = header ? getByName(header, 'DIVISION')     : null;
        const emblemLayer         = header ? getByName(header, 'EMBLEM')       : null;
        const divisionColorLayer  = header ? getByName(header, 'HEADER COLOR') : null;

        if (divisionText) divisionText.textItem.contents = (division + ' ' + conf).toUpperCase();

        const tierFolder = header ? getByName(header, 'TIER') : null;
        if (tierFolder) {
          for (let i = 0; i < tierFolder.layers.length; i++) {
            tierFolder.layers[i].visible = (tierFolder.layers[i].name === conf);
          }
        }

        if (emblemLayer) {
          await imageHandler.replaceLayerWithImage(emblemLayer, `LOGOS/Division Emblems/PNG/${divAbb}_emblem.png`, baseFolder);
        }

        const sponsorDir = 'LOGOS/Sponsor/Division Sponsors/Sponsor Bars/';
        let sponsorSuffix = '';
        if (backgroundBlack) sponsorSuffix = 'BLACK';
        else if (backgroundWhite) sponsorSuffix = 'WHITE';
        if (sponsorBar) {
          let ok = false;
          if (sponsorSuffix) {
            ok = await imageHandler.replaceLayerWithImage(sponsorBar, `${sponsorDir}${divAbb}_Sponsors_${sponsorSuffix}.psd`, baseFolder);
          }
          if (!ok) await imageHandler.replaceLayerWithImage(sponsorBar, `${sponsorDir}${divAbb}_Sponsors.psd`, baseFolder);
        }

        if (divisionColorLayer) await fillColor(divisionColorLayer, divColorHex);

        // ── BRACKET SLOTS ────────────────────────────────────────────────
        const bracketGroup = getByName(doc, 'BRACKET');

        if (bracketGroup) {
          // Build a quick lookup: slotName -> row data
          const slotDataMap = {};
          for (const row of divBracket) slotDataMap[row.slot] = row;

          // Returns true if the slot has at least one non-blank team
          const slotHasTeams = (slot) => {
            const r = slotDataMap[slot];
            return !!(r && (String(r.team1 || '').trim() || String(r.team2 || '').trim()));
          };

          // Visibility rules per slot type
          const shouldShowSlot = (slot) => {
            const s = String(slot).toUpperCase();
            if (s === 'F')  return true;  // Finals always visible
            if (s === 'SA') return slotHasTeams('SA') || slotHasTeams('QA1') || slotHasTeams('QA2');
            if (s === 'SB') return slotHasTeams('SB') || slotHasTeams('QB1') || slotHasTeams('QB2');
            // W* and Q* slots: only show when they have data
            return slotHasTeams(slot);
          };

          // Iterate every slot folder in the BRACKET group
          const slotFolders = bracketGroup.layers || [];
          for (const slotFolder of slotFolders) {
            const show = shouldShowSlot(slotFolder.name);

            if (!show) {
              slotFolder.visible = false;
              continue;
            }

            slotFolder.visible = true;
            const row = slotDataMap[slotFolder.name];

            const team1Folder = getByName(slotFolder, 'TEAM 1');
            const team2Folder = getByName(slotFolder, 'TEAM 2');

            const w1       = row ? Number(row.w1     || 0) : 0;
            const w2       = row ? Number(row.w2     || 0) : 0;
            const bestOf   = row ? Number(row.bestOf || 0) : 0;
            // BO1 → first team to 1 win advances; BO3 → first to 2
            const winsNeeded = bestOf >= 3 ? 2 : 1;
            // A team is eliminated when the opponent has reached winsNeeded
            const team1Elim = w2 >= winsNeeded;
            const team2Elim = w1 >= winsNeeded;

            await updateBracketTeam(team1Folder, row ? row.team1 : '', row ? row.seed1 : '', w1, team1Elim, bestOf, teams, conf, divAbb, baseFolder);
            await updateBracketTeam(team2Folder, row ? row.team2 : '', row ? row.seed2 : '', w2, team2Elim, bestOf, teams, conf, divAbb, baseFolder);
          }
        }

        // ── EXPORT ───────────────────────────────────────────────────────
        const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', DOC_EXPORT]);
        const exportFile   = await exportFolder.createFile(`${divAbb}_${DOC_EXPORT}.png`, { overwrite: true });
        const cdnPath      = exportHandler.buildCdnPath(baseFolder.name, '', DOC_EXPORT, exportFile.name);
        await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);

        await doc.save();
      }, { commandName: "Update BRACKET" });

      previousDocId = newDocId;
    }

    statusEl.innerHTML = "✅ Bracket update complete!";
  } catch (err) {
    statusEl.textContent = "⚠️ Error updating Bracket";
    console.error("Bracket error:", err);
    throw err;
  }
}

// Update one team slot inside a bracket matchup folder
async function updateBracketTeam(teamFolder, teamName, seed, wins, isElim, bestOf, teams, conf, divAbb, baseFolder) {
  if (!teamFolder) return;

  const seedLayer    = getByName(teamFolder, 'SEED');
  const seedBoxLayer = getByName(teamFolder, 'SEED BOX');
  const elimLayer    = getByName(teamFolder, 'ELIM');
  const win1Layer    = getByName(teamFolder, 'W1');
  const win2Layer    = getByName(teamFolder, 'W2');
  const nameRaw      = String(teamName || '').trim();

  if (!nameRaw) {
    // No team assigned yet — hide seed indicators, elim, and win pips
    if (seedLayer)    seedLayer.visible    = false;
    if (seedBoxLayer) seedBoxLayer.visible = false;
    if (elimLayer)    elimLayer.visible    = false;
    if (win1Layer)    win1Layer.visible    = false;
    if (win2Layer)    win2Layer.visible    = false;
    return;
  }

  // Seed indicators — always show when team is assigned
  if (seedLayer)    seedLayer.visible    = true;
  if (seedBoxLayer) seedBoxLayer.visible = true;

  // ELIM overlay — reset first, then activate if eliminated
  if (elimLayer) elimLayer.visible = false;
  if (elimLayer) elimLayer.visible = isElim;

  // Win pip layers: reset both first, then activate based on wins
  if (win1Layer) win1Layer.visible = false;
  if (win2Layer) win2Layer.visible = false;
  if (win1Layer) win1Layer.visible = wins >= 1;
  if (win2Layer) win2Layer.visible = wins >= 2;

  const match = teams.find(t =>
    String(t.fullTeam  || '').trim().toUpperCase() === nameRaw.toUpperCase() ||
    String(t.teamName  || '').trim().toUpperCase() === nameRaw.toUpperCase()
  );

  const fullTeam = match ? String(match.fullTeam || nameRaw).trim() : nameRaw;
  const color1   = match ? String(match.color1   || 'ffffff').trim() : 'ffffff';

  const teamColorLayer = getByName(teamFolder, 'TEAM COLOR');
  const logoLayer      = getByName(teamFolder, 'TEAM LOGO');

  if (teamColorLayer) await fillColor(teamColorLayer, color1);

  if (seedLayer && seedLayer.textItem) {
    seedLayer.textItem.contents = String(seed || '');
  }

  if (logoLayer && fullTeam) {
    const logoUrl = `${imageHandler.IMAGE_CDN_BASE}/${encodeURIComponent(baseFolder.name)}/${encodeURIComponent(conf)}/${encodeURIComponent(divAbb)}/${encodeURIComponent(fullTeam)}.png`;
    let ok = await imageHandler.replaceLayerWithImageInPlace(logoLayer, logoUrl);
    if (!ok) ok = await imageHandler.replaceLayerWithImageInPlace(logoLayer, `LOGOS/TEAMS/${conf}/${divAbb}/${fullTeam}.png`, baseFolder);
    if (!ok) await imageHandler.replaceLayerWithImageInPlace(logoLayer, 'LOGOS/LeagueLogo.png', baseFolder);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '').replace(/^#/, '').trim();
  return {
    r: parseInt(h.slice(0, 2) || '00', 16),
    g: parseInt(h.slice(2, 4) || '00', 16),
    b: parseInt(h.slice(4, 6) || '00', 16)
  };
}

async function fillColor(layer, hex) {
  if (!layer) return;
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay([
    { _obj: "select", _target: [{ _ref: "layer", _id: layer._id }], makeVisible: false, selectionModifier: { _enum: "selectionModifierType", _value: "replaceSelection" }, _isCommand: true }
  ], { synchronousExecution: true });
  await app.batchPlay([
    { _obj: "set", _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: r, green: g, blue: b } } }
  ], { synchronousExecution: true });
}

const getByName = (parent, name) => {
  if (!parent) return null;
  const layers = parent.layers || parent;
  if (!layers || !layers.find) return null;
  return layers.find(l => l.name === name);
};

async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (const segment of segments) {
    try { current = await current.getEntry(segment); }
    catch { current = await current.createFolder(segment); }
  }
  return current;
}

module.exports = { handleBracketUpdate };
