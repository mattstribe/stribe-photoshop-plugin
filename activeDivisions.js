const photoshop = require("photoshop");
const app = photoshop.app;
const core = photoshop.core;
const leagueConfig = require("./leagueConfig_200.js");
const exportHandler = require("./exportHandler.js");

// Document identifiers for this script
const DOC_ID = 'ACTIVE-DIVS';
const DOC_EXPORT = 'Active Divs';

// Normalize division display name for Pittsburgh and South Jersey variants
function normalizeDivisionDisplayName(divName) {
  const s = String(divName || '').trim();
  if (/^Pittsburgh(\s+(East|West))?$/i.test(s)) return 'Pittsburgh';
  if (/^(South Jersey|New Jersey)(\s+(East|West))?$/i.test(s)) return 'South Jersey';
  return s;
}

// Build list of divisions that have games in the target week.
// Divisions with the same normalized name are merged into one row.
// Each row includes activeTiers: all unique conf values from merged divisions.
function buildActiveDivisionsList(divs, schedule, targetWeek) {

  // Index divs by abb for quick lookup
  const divByAbb = {};
  for (let i = 0; i < divs.length; i++) {
    divByAbb[divs[i].abb] = divs[i];
  }

  // Collect unique abbs that have games in the target week, sorted A-Z
  const abbsSeen = {};
  const abbsWithGames = [];
  for (let i = 0; i < schedule.length; i++) {
    const g = schedule[i];
    if (String(g.week).trim() === '' || Number(g.week) !== Number(targetWeek)) continue;
    if (!g.div1) continue;
    if (abbsSeen[g.div1]) continue;
    abbsSeen[g.div1] = true;
    abbsWithGames.push(g.div1);
  }
  abbsWithGames.sort(function(a, b) { return String(a).localeCompare(String(b)); });

  // Merge abbs with the same normalized division name into one row
  const mergedKeys = [];
  const mergedRows = {};
  const tiersSeen = {};

  for (let i = 0; i < abbsWithGames.length; i++) {
    const row = divByAbb[abbsWithGames[i]];
    if (!row) continue;

    const displayDiv = normalizeDivisionDisplayName(row.div);
    const mKey = displayDiv.toUpperCase();

    // First abb for this key wins for color
    if (!mergedRows[mKey]) {
      mergedKeys.push(mKey);
      mergedRows[mKey] = {
        abb: row.abb,
        div: displayDiv,
        conf: row.conf,
        color1: row.color1,
        activeTiers: []
      };
      tiersSeen[mKey] = {};
    }

    // Add this abb's conf (tier) if not already collected
    const tier = String(row.conf || '').trim();
    if (tier && !tiersSeen[mKey][tier]) {
      tiersSeen[mKey][tier] = true;
      mergedRows[mKey].activeTiers.push(tier);
    }
  }

  // Sort each activeTiers array alphabetically
  for (let i = 0; i < mergedKeys.length; i++) {
    mergedRows[mergedKeys[i]].activeTiers.sort(function(a, b) {
      return String(a).localeCompare(String(b));
    });
  }

  // Build final rows array sorted by division name
  const rows = [];
  for (let i = 0; i < mergedKeys.length; i++) {
    rows.push(mergedRows[mergedKeys[i]]);
  }
  rows.sort(function(x, y) {
    const c = String(x.div || '').localeCompare(String(y.div || ''));
    if (c !== 0) return c;
    return String(x.abb).localeCompare(String(y.abb));
  });
  return rows;
}

// Build a lookup of all known tier/conf names from divs (normalized to uppercase)
function buildAllTierKeys(divs) {
  const tierKeys = {};
  for (let i = 0; i < divs.length; i++) {
    const c = String(divs[i].conf || '').trim();
    if (c) tierKeys[c.toUpperCase()] = true;
  }
  return tierKeys;
}

// Inside a DIV slot: show only the tier layers that are active for this division.
// DIVISION and DIVISION COLOR are always kept visible.
// Other layers (not a known tier name) are left unchanged.
function applyTierLayerVisibility(divSlot, activeTiers, allTierKeys) {
  if (!divSlot || !divSlot.layers) return;

  // Build lookup of active tier names for this row
  const activeTierKeys = {};
  for (let i = 0; i < activeTiers.length; i++) {
    activeTierKeys[activeTiers[i].toUpperCase()] = true;
  }

  for (let i = 0; i < divSlot.layers.length; i++) {
    const layer = divSlot.layers[i];
    const key = String(layer.name || '').trim().toUpperCase();
    if (key === 'DIVISION' || key === 'DIVISION COLOR') {
      layer.visible = true;
      continue;
    }
    if (allTierKeys[key]) {
      layer.visible = !!activeTierKeys[key];
    }
  }
}

// Function to handle ACTIVE DIVS update
async function handleActiveDivisionsUpdate(baseFolder) {
  const statusEl = document.getElementById('status');

  // Read cloud export checkbox state BEFORE entering executeAsModal
  const exportToCloudCheckbox = document.getElementById('exportToCloudCheckbox');
  const cloudExportEnabled = exportToCloudCheckbox && exportToCloudCheckbox.checked === true;

  try {

    /////INITIALIZE ALL INFORMATION/////

    // Clear cached URLs/branding for this league so each run sees fresh sheet data
    await leagueConfig.invalidateLeagueCache(baseFolder);

    // Load league config and schedule data
    const [leagueData, scheduleData] = await Promise.all([
      leagueConfig.loadLeagueConfig(baseFolder),
      leagueConfig.loadSchedule(baseFolder)
    ]);

    const { divs } = leagueData;
    const { schedule, week, year } = scheduleData;
    const upcomingWeek = Number(week) + 1;

    // Build divisions with games next week (one row per unique division name)
    const activeDivisions = buildActiveDivisionsList(divs, schedule, upcomingWeek);
    const allTierKeys = buildAllTierKeys(divs);
    const numSlots = activeDivisions.length;

    if (numSlots === 0) {
      statusEl.textContent = 'No divisions with games in upcoming week ' + upcomingWeek + ' (' + year + ')';
      return;
    }

    // Navigate to template folder (Gameday Graphics inside league, or league folder directly)
    let gamedayFolder;
    try {
      gamedayFolder = await baseFolder.getEntry('Gameday Graphics');
    } catch {
      gamedayFolder = baseFolder;
    }

    const templateFolder = await gamedayFolder.getEntry(DOC_ID);
    const templateFile = await templateFolder.getEntry(DOC_ID + '.psd');

    // Create Working Files folder if it doesn't exist
    let workingFolder;
    try {
      workingFolder = await templateFolder.getEntry('Working Files');
    } catch {
      workingFolder = await templateFolder.createFolder('Working Files');
    }

    const workingFileName = DOC_ID + '_working_Week' + upcomingWeek + '.psd';
    const saveFile = await workingFolder.createFile(sanitizeFilename(workingFileName), { overwrite: true });

    statusEl.textContent = 'ACTIVE DIVS: Week ' + upcomingWeek + ' (' + numSlots + ' divisions)...';

    /////PHOTOSHOP AUTOMATION/////

    await core.executeAsModal(async () => {
      await app.open(templateFile);

      const doc = app.activeDocument;
      if (doc.saveAs && doc.saveAs.psd) await doc.saveAs.psd(saveFile);

      // Update week label
      const weekLayer = getByName(doc, 'WEEK');
      if (weekLayer && weekLayer.textItem) {
        weekLayer.textItem.contents = 'WEEK ' + String(upcomingWeek);
      }

      // Get AREA layer from BACKGROUND group to measure available space
      const background = getByName(doc, 'BACKGROUND');
      const areaLayer = getByName(background, 'AREA');
      if (!areaLayer) throw new Error('AREA layer not found in BACKGROUND group');

      // Find DIV 1 inside the DIVS group (or top-level if no group)
      const divsGroup = getByName(doc, 'DIVS') || getByName(doc, 'DIVISIONS') || getByName(doc, 'ACTIVE DIVS');
      let divParent = null;
      let div1 = null;
      if (divsGroup) {
        div1 = getByName(divsGroup, 'DIV 1');
        if (div1) divParent = divsGroup;
      }
      if (!div1) {
        div1 = getByName(doc, 'DIV 1');
      }
      if (!div1) throw new Error('Folder "DIV 1" not found in document');

      // Calculate layout — same AREA + scale + step + translate pattern as schedule.js
      const areaBounds = areaLayer.boundsNoEffects;
      const maxAreaHeight = Math.abs(areaBounds.bottom - areaBounds.top);

      const div1Bounds = div1.boundsNoEffects;
      const boxHeight = Math.abs(div1Bounds.bottom - div1Bounds.top);

      const defaultSpacing = boxHeight * 0.15;
      const totalHeight = (boxHeight * numSlots) + (defaultSpacing * (numSlots - 1));

      let scale = 100;
      let spacing = defaultSpacing;
      if (totalHeight > maxAreaHeight) {
        scale = (maxAreaHeight / totalHeight) * 100;
        spacing = defaultSpacing * (scale / 100);
      }

      await scaleLayer(div1, scale, 'top');

      const step = Math.round((scale / 100) * (spacing + boxHeight));

      // Duplicate DIV 1 for each additional slot
      const parentForDivs = divParent || doc;
      for (let p = 1; p < numSlots; p++) {
        const src = getByName(parentForDivs, 'DIV ' + p);
        if (!src) break;
        await duplicate(src, 'DIV ' + (p + 1), 0, step);
      }

      // Position the DIVS group within AREA after all duplications.
      // When scale is 100 (slots fit), offset 1/3 down from AREA top.
      // When scale < 100 (slots were shrunk to fit), align to AREA top.
      // Always uses absolute positioning so it works wherever DIVS currently sits.
      if (divParent) {
        const divsBounds = divParent.boundsNoEffects;
        const divsTop = divsBounds.top;
        const divsHeight = Math.abs(divsBounds.bottom - divsBounds.top);
        let targetTop = areaBounds.top;
        if (scale === 100) {
          targetTop = areaBounds.top + Math.round((maxAreaHeight - divsHeight) / 3);
        }
        const deltaY = targetTop - divsTop;
        console.log('ACTIVE-DIVS centering: scale=' + scale + ' areaTop=' + areaBounds.top + ' divsTop=' + divsTop + ' divsH=' + divsHeight + ' areaH=' + maxAreaHeight + ' targetTop=' + targetTop + ' dy=' + deltaY);
        if (deltaY !== 0) await translate(divParent, 0, deltaY);
      } else {
        console.log('ACTIVE-DIVS: divParent is null — DIVS group not found, centering skipped');
      }

      // Update each slot with division name, color, and tier visibility
      for (let i = 0; i < numSlots; i++) {
        const divSlot = getByName(parentForDivs, 'DIV ' + (i + 1));
        if (!divSlot) continue;

        const row = activeDivisions[i];
        const divName = row.div ? String(row.div) : '';
        const divColorHex = row.color1 ? row.color1 : 'ffffff';

        // Update division name text
        const divisionText = getByName(divSlot, 'DIVISION');
        if (divisionText && divisionText.textItem) {
          divisionText.textItem.contents = divName.toUpperCase();
        }

        // Update division color fill
        const divisionColorLayer = getByName(divSlot, 'DIVISION COLOR');
        if (divisionColorLayer) await fillColor(divisionColorLayer, divColorHex);

        // Show only the tier layers that are active for this division
        applyTierLayerVisibility(divSlot, row.activeTiers, allTierKeys);
      }

      await doc.save();

      // Export PNG to Exports/Week {week}/ with upcoming week in filename
      const exportFile = await prepareActiveDivsExport(gamedayFolder, week, upcomingWeek);
      const cdnPath = exportHandler.buildCdnPath(baseFolder.name, week, DOC_EXPORT, exportFile.name);
      await exportHandler.exportPng(doc, exportFile, cdnPath, cloudExportEnabled);

    }, { commandName: 'Update ' + DOC_ID + ' Week ' + upcomingWeek });

    statusEl.textContent = '✅ ' + DOC_ID + ': ' + numSlots + ' divisions, upcoming week ' + upcomingWeek;

  } catch (err) {
    console.error('Active divisions error:', err);
    statusEl.textContent = '⚠️ ' + (err && err.message ? err.message : String(err));
  }
}

// ===== Helpers =====

function hexToRgb(hex) {
  const h = (hex || '').replace(/^#/, '').trim();
  const r = parseInt(h.slice(0, 2) || '00', 16);
  const g = parseInt(h.slice(2, 4) || '00', 16);
  const b = parseInt(h.slice(4, 6) || '00', 16);
  return { r, g, b };
}

async function fillColor(layer, hex) {
  const { r, g, b } = hexToRgb(hex);
  await app.batchPlay([
    { _obj: 'select', _target: [{ _ref: 'layer', _id: layer._id }], makeVisible: false, selectionModifier: { _enum: 'selectionModifierType', _value: 'replaceSelection' }, _isCommand: true }
  ], { synchronousExecution: true });
  await app.batchPlay([
    { _obj: 'set', _target: [{ _ref: 'contentLayer', _enum: 'ordinal', _value: 'targetEnum' }], to: { _obj: 'solidColorLayer', color: { _obj: 'RGBColor', red: r, green: g, blue: b } } }
  ], { synchronousExecution: true });
}

const getByName = (parent, name) => {
  const layers = parent.layers || parent;
  return layers.find(l => l.name === name);
};

async function translate(layer, deltaX, deltaY) {
  const dx = Math.round(deltaX);
  const dy = Math.round(deltaY);
  await app.batchPlay([
    {
      _obj: 'select',
      _target: [{ _ref: 'layer', _id: layer._id }],
      makeVisible: true
    },
    {
      _obj: 'transform',
      _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
      freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
      offset: {
        _obj: 'offset',
        horizontal: { _unit: 'pixelsUnit', _value: dx },
        vertical: { _unit: 'pixelsUnit', _value: dy }
      }
    }
  ], { synchronousExecution: true });
}

async function scaleLayer(layer, percent, anchor) {
  const value = Number(percent);
  if (!isFinite(value) || value <= 0) return;
  const anchorMap = {
    'top': 'QCSTop',
    'center': 'QCSAverage',
    'bottom': 'QCSBottom'
  };
  const centerState = anchorMap[anchor] || 'QCSAverage';
  await app.batchPlay([
    {
      _obj: 'select',
      _target: [{ _ref: 'layer', _id: layer._id }],
      makeVisible: true
    },
    {
      _obj: 'transform',
      _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
      freeTransformCenterState: { _enum: 'quadCenterState', _value: centerState },
      width: { _unit: 'percentUnit', _value: value },
      height: { _unit: 'percentUnit', _value: value }
    }
  ], { synchronousExecution: true });
}

async function duplicate(group, newName, deltaX = 0, deltaY = 0) {
  // Select source group
  await app.batchPlay(
    [{ _obj: 'select', _target: [{ _ref: 'layer', _id: group._id }], makeVisible: false }],
    { synchronousExecution: true }
  );

  // Duplicate (new group becomes active)
  await app.batchPlay(
    [{ _obj: 'duplicate', _target: [{ _ref: 'layer', _id: group._id }] }],
    { synchronousExecution: true }
  );

  const dup = app.activeDocument.activeLayers[0];

  // Rename duplicated group
  try { dup.name = newName; } catch {}

  // Recursively strip " copy" suffixes from dup and all descendants
  const stripSuffix = n => n.replace(/\s+copy(?:\s*\d+)?$/i, '');
  const scrubNamesRecursively = (layerLike) => {
    try {
      if (layerLike.name) {
        const cleaned = stripSuffix(layerLike.name);
        if (cleaned !== layerLike.name) layerLike.name = cleaned;
      }
    } catch {}
    if (layerLike.layers && layerLike.layers.length) {
      for (const child of layerLike.layers) scrubNamesRecursively(child);
    }
  };
  scrubNamesRecursively(dup);

  // Move to position if offset given
  if (deltaX !== 0 || deltaY !== 0) {
    await app.batchPlay(
      [{
        _obj: 'transform',
        _target: [{ _ref: 'layer', _id: dup._id }],
        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
        offset: {
          _obj: 'offset',
          horizontal: { _unit: 'pixelsUnit', _value: deltaX },
          vertical:   { _unit: 'pixelsUnit', _value: deltaY }
        }
      }],
      { synchronousExecution: true }
    );
  }

  return dup;
}

// Ensure a chain of folders exists under rootFolder, creating any that are missing
async function ensureFolderPath(rootFolder, segments) {
  let current = rootFolder;
  for (let i = 0; i < segments.length; i++) {
    try { current = await current.getEntry(segments[i]); }
    catch { current = await current.createFolder(segments[i]); }
  }
  return current;
}

// Prepare and return a FileEntry for the Active Divs PNG export
async function prepareActiveDivsExport(gamedayFolder, week, upcomingWeek) {
  const weekFolderName = 'Week ' + week;
  const exportFolder = await ensureFolderPath(gamedayFolder, ['Exports', weekFolderName]);
  const exportFileName = DOC_ID + '_Week' + upcomingWeek + '.png';
  return await exportFolder.createFile(exportFileName, { overwrite: true });
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-')
    .replace(/\.+$/g, '');
}

module.exports = {
  handleActiveDivisionsUpdate
};
