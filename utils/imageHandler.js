// ========== IMAGE HANDLER ==========
// One function: replaceLayerWithImage(layer, pathOrUrl, baseFolder?)
// You choose the layer and the path/URL in your script; call when ready to replace.
//
// Examples (path rules set where you use them):
//   await imageHandler.replaceLayerWithImage(layer, "https://.../logo.png");
//   await imageHandler.replaceLayerWithImage(emblemLayer, `LOGOS/Division Emblems/${divAbb}_emblem.png`, baseFolder);
//   await imageHandler.replaceLayerWithImage(bgLayer, "BACKGROUNDS/weekly.png", baseFolder);

const photoshop = require("photoshop");
const app = photoshop.app;
const uxp = require("uxp");
const fs = uxp.storage.localFileSystem;
const storage = uxp.storage;

// CDN base URL — use when building URLs in your script (e.g. IMAGE_CDN_BASE + "/league/LOGOS/logo.png").
const IMAGE_CDN_BASE = "https://pub-3c06366d547445298c77e04b7c3c77ad.r2.dev";

const imageCache = {};

/**
 * Replace a Smart Object layer with an image.
 * @param {Layer} layer - The Smart Object layer to replace
 * @param {string} pathOrUrl - Either:
 *   - A full URL (e.g. "https://.../logo.png"), or
 *   - A relative path (e.g. "LOGOS/Division Emblems/MET_emblem.png") when baseFolder is provided
 * @param {FolderEntry} [baseFolder] - If pathOrUrl is a local path, the folder it's relative to (e.g. league folder)
 * @returns {Promise<boolean>} - true if replace succeeded, false otherwise
 */
async function replaceLayerWithImage(layer, pathOrUrl, baseFolder) {
  if (!layer || !pathOrUrl || !String(pathOrUrl).trim()) return false;

  const fileEntry = baseFolder != null
    ? await getFileFromPath(baseFolder, pathOrUrl)
    : await getFileFromUrl(pathOrUrl);

  if (!fileEntry) return false;

  return replaceLayerWithFile(layer, fileEntry);
}

// ---- Resolve image to a FileEntry (used by replaceLayerWithImage) ----

async function getFileFromUrl(url) {
  if (imageCache[url]) return imageCache[url];
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const dataFolder = await fs.getDataFolder();
    let tempFolder;
    try {
      tempFolder = await dataFolder.getEntry("temp_images");
    } catch {
      tempFolder = await dataFolder.createFolder("temp_images");
    }
    const safeName = (url.split("/").pop() || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_");
    const hash = Math.abs(url.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
    const file = await tempFolder.createFile(`${hash}_${safeName}`, { overwrite: true });
    await file.write(arrayBuffer, { format: storage.formats.binary });
    imageCache[url] = file;
    return file;
  } catch (err) {
    console.warn("ImageHandler: getFileFromUrl failed:", url, err.message);
    return null;
  }
}

async function getFileFromPath(baseFolder, relativePath) {
  const parts = String(relativePath).replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  try {
    let current = baseFolder;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getEntry(parts[i]);
    }
    const file = await current.getEntry(parts[parts.length - 1]);
    return file && file.isFile ? file : null;
  } catch {
    return null;
  }
}

// ---- The actual Photoshop replace (needs a FileEntry) ----

async function replaceLayerWithFile(layer, fileEntry) {
  if (!layer || !fileEntry) return false;
  const originalId = layer._id;
  const originalName = layer.name;
  const token = await fs.createSessionToken(fileEntry);

  await app.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: originalId }], makeVisible: true }], { synchronousExecution: true });
  await app.batchPlay([{ _obj: "placedLayerMakeCopy" }], { synchronousExecution: true });
  const copied = app.activeDocument.activeLayers[0];
  copied.name = originalName;
  await app.batchPlay([{ _obj: "placedLayerReplaceContents", _target: [{ _ref: "layer", _id: copied._id }], "null": { _path: token, _kind: "local" } }], { synchronousExecution: true });
  await app.batchPlay([{ _obj: "delete", _target: [{ _ref: "layer", _id: originalId }] }], { synchronousExecution: true });
  return true;
}

/** Clear URL cache and temp downloaded images (e.g. when switching leagues). */
async function clearCache() {
  for (const key in imageCache) delete imageCache[key];
  try {
    const dataFolder = await fs.getDataFolder();
    const tempFolder = await dataFolder.getEntry("temp_images");
    const entries = await tempFolder.getEntries();
    for (const entry of entries) {
      if (entry.isFile) try { await entry.delete(); } catch (_) {}
    }
  } catch (_) {}
}

module.exports = {
  IMAGE_CDN_BASE,
  replaceLayerWithImage,
  clearCache
};
