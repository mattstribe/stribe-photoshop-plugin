// ========== EXPORT HANDLER ==========
// Handles exporting graphics to local filesystem and optionally uploading to CDN (Cloudflare R2)
// Used by schedule.js, standings.js, and stats.js

const photoshop = require("photoshop");
const app = photoshop.app;
const uxp = require("uxp");
const fs = uxp.storage.localFileSystem;
const storage = uxp.storage;

// ===== CDN EXPORT CONFIGURATION =====
// Set these to enable automatic uploads to Cloudflare R2
// Leave null/empty to only export locally
const EXPORT_CDN_BASE_URL = "https://pub-3c06366d547445298c77e04b7c3c77ad.r2.dev"; // Your R2 public URL

/**
 * Check if cloud export is enabled via UI checkbox
 * @returns {boolean} - True if "Export to Cloud" checkbox is checked
 */
function isCloudExportEnabled() {
  try {
    const checkbox = document.getElementById("exportToCloudCheckbox");
    const isEnabled = checkbox && checkbox.checked === true;
    console.log(`Cloud export enabled: ${isEnabled} (checkbox found: ${!!checkbox}, checked: ${checkbox?.checked})`);
    return isEnabled;
  } catch (e) {
    console.error("Error checking cloud export checkbox:", e);
    return false;
  }
}

// Option 1: Use a serverless function/API endpoint as a proxy (RECOMMENDED)
// This is simpler and more secure than implementing S3 auth in the plugin
const EXPORT_UPLOAD_API_URL = "https://license-server-five-red.vercel.app/api/upload"; // e.g., "https://your-api.vercel.app/api/upload"

// Option 2: Direct R2 S3-compatible upload (requires AWS Signature v4 - complex)
// If you want to use this, you'll need to implement proper AWS Signature v4
// For now, this is a placeholder that you can enhance
const R2_ACCOUNT_ID = null; // Your Cloudflare R2 Account ID
const R2_ACCESS_KEY_ID = null; // Your R2 Access Key ID
const R2_SECRET_ACCESS_KEY = null; // Your R2 Secret Access Key
const R2_BUCKET_NAME = null; // Your R2 bucket name

/**
 * Upload a file to CDN via API endpoint (recommended approach)
 * @param {FileEntry} fileEntry - The local file to upload
 * @param {string} remotePath - The path/key in R2 (e.g., "exports/week1/standings.png")
 * @returns {Promise<string|null>} - The public CDN URL if successful, null otherwise
 */
async function uploadViaAPI(fileEntry, remotePath) {
  if (!EXPORT_UPLOAD_API_URL) {
    return null;
  }

  try {
    // Read the file as array buffer
    const fileData = await fileEntry.read({ format: storage.formats.binary });
    const arrayBuffer = new Uint8Array(fileData).buffer;

    // Create FormData-like structure (UXP doesn't have FormData, so we'll send as binary)
    const response = await fetch(EXPORT_UPLOAD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Path': remotePath, // Send path as header
        'X-File-Name': fileEntry.name
      },
      body: arrayBuffer
    });

    if (!response.ok) {
      console.error(`Failed to upload via API: HTTP ${response.status} - ${response.statusText}`);
      return null;
    }

    const result = await response.json();
    const publicUrl = result.url || `${EXPORT_CDN_BASE_URL}/${remotePath}`;
    console.log(`✅ Uploaded to CDN: ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.error(`Error uploading via API:`, err);
    return null;
  }
}

/**
 * Upload a file directly to R2 using S3-compatible API
 * NOTE: This requires proper AWS Signature v4 implementation for production use
 * @param {FileEntry} fileEntry - The local file to upload
 * @param {string} remotePath - The path/key in R2 (e.g., "exports/week1/standings.png")
 * @returns {Promise<string|null>} - The public CDN URL if successful, null otherwise
 */
async function uploadToR2Direct(fileEntry, remotePath) {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return null;
  }

  // TODO: Implement proper AWS Signature v4 for S3-compatible upload
  // For now, this is a placeholder
  console.warn('Direct R2 upload requires AWS Signature v4 implementation');
  return null;
}

/**
 * Upload a file to CDN (tries API first, then direct R2)
 * @param {FileEntry} fileEntry - The local file to upload
 * @param {string} remotePath - The path/key in R2
 * @returns {Promise<string|null>} - The public CDN URL if successful, null otherwise
 */
async function uploadToR2(fileEntry, remotePath) {
  // Check if cloud export is enabled via UI checkbox
  if (!isCloudExportEnabled()) {
    return null;
  }

  // Try API endpoint first (recommended)
  if (EXPORT_UPLOAD_API_URL) {
    return await uploadViaAPI(fileEntry, remotePath);
  }

  // Fallback to direct R2 upload (requires proper auth implementation)
  return await uploadToR2Direct(fileEntry, remotePath);
}

/**
 * Export document to PNG and optionally upload to CDN
 * @param {Document} doc - Photoshop document
 * @param {FileEntry} exportFile - Local file entry for export
 * @param {string} cdnPath - Optional CDN path for upload (e.g., "exports/week1/standings.png")
 * @param {boolean} cloudExportEnabled - Whether cloud export is enabled (pass this from outside executeAsModal)
 * @returns {Promise<string|null>} - CDN URL if uploaded, null otherwise
 */
async function exportPng(doc, exportFile, cdnPath = null, cloudExportEnabled = null) {
  // Export locally first
  if (doc.saveAs && doc.saveAs.png) {
    await doc.saveAs.png(exportFile);
  } else {
    await app.batchPlay([
      { 
        _obj: 'save', 
        as: { _obj: 'PNGFormat', interlaced: false }, 
        in: { _path: exportFile.nativePath, _kind: 'local' }, 
        copy: true, 
        lowerCase: true 
      }
    ], { synchronousExecution: true });
  }

  // Upload to CDN if enabled via checkbox
  // Use passed parameter if provided, otherwise try to read from DOM
  const shouldUpload = cloudExportEnabled !== null ? cloudExportEnabled : isCloudExportEnabled();
  
  if (cdnPath && shouldUpload) {
    console.log(`Starting cloud upload for: ${cdnPath}`);
    const cdnUrl = await uploadToR2(exportFile, cdnPath);
    if (cdnUrl) {
      console.log(`✅ Successfully uploaded to cloud: ${cdnUrl}`);
    } else {
      console.warn(`⚠️ Cloud upload failed for: ${cdnPath}`);
    }
    return cdnUrl;
  } else {
    if (!cdnPath) {
      console.log("No CDN path provided, skipping cloud upload");
    } else {
      console.log("Cloud export disabled (checkbox unchecked), skipping upload");
    }
  }

  return null;
}

/**
 * Build CDN path for an export
 * @param {string} leagueName - League name
 * @param {number} week - Week number
 * @param {string} type - Export type (e.g., "Standings", "Stats", "Schedule")
 * @param {string} filename - Filename (e.g., "VICM12_Standings_1.png")
 * @returns {string} - CDN path (e.g., "exports/VIBHL/week1/standings/VICM12_Standings_1.png")
 */
function buildCdnPath(leagueName, week, type, filename) {
  const safeLeague = encodeURIComponent(leagueName);
  const safeType = encodeURIComponent(type);
  const safeFilename = encodeURIComponent(filename);
  return `${safeLeague}/exports/Week-${week}/${safeType}/${safeFilename}`;
}

// Export functions
module.exports = {
  exportPng,
  buildCdnPath,
  uploadToR2
};

