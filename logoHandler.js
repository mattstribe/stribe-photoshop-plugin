// ========== LOGO HANDLER ==========
// Centralized logo handling for online and local logos
// Used by schedule.js, standings.js, and stats.js

const photoshop = require("photoshop");
const app = photoshop.app;
const uxp = require("uxp");
const fs = uxp.storage.localFileSystem;
const storage = uxp.storage;

// ===== ONLINE LOGO CONFIGURATION =====
const LOGO_BASE_URL = "https://pub-3c06366d547445298c77e04b7c3c77ad.r2.dev";

// In-memory cache for downloaded logos (key: URL, value: FileEntry)
const logoCache = {};

/**
 * Build logo source configuration (online vs local)
 * @param {FolderEntry} baseFolder - The league base folder
 * @param {string} conf - Conference name
 * @param {string} divAbb - Division abbreviation
 * @returns {Promise<{logoSource: Object|null, logosFolder: FolderEntry|null}>}
 */
async function buildLogoSource(baseFolder, conf, divAbb) {
  const leagueName = baseFolder.name;
  let logoSource = null; // Will be either { type: 'url', baseUrl, conf, divAbb } or { type: 'local', folder }
  let logosFolder = null; // For fallback to LeagueLogo
  let localDivLogosFolder = null; // For fallback to local disk logos when cloud fails
  
  // Always try to get local logos folder structure for fallback
  try {
    logosFolder = await baseFolder.getEntry('LOGOS');
    const teamsLogosFolder = await logosFolder.getEntry('TEAMS');
    try {
      const confLogosFolder = await teamsLogosFolder.getEntry(conf);
      localDivLogosFolder = await confLogosFolder.getEntry(divAbb);
    } catch (e) {
      // Local div folder doesn't exist, that's okay - we'll just use LeagueLogo fallback
    }
  } catch (e) {
    console.warn(`LOGO: Could not access LOGOS folder for fallback.`);
  }
  
  if (LOGO_BASE_URL && LOGO_BASE_URL.trim()) {
    // Use online logos, but include local folder for fallback
    logoSource = {
      type: 'url',
      baseUrl: LOGO_BASE_URL.trim().replace(/\/$/, ''), // Remove trailing slash
      leagueName: leagueName,
      conf: conf,
      divAbb: divAbb,
      localFallbackFolder: localDivLogosFolder // Add local folder for fallback
    };
  } else {
    // Use local filesystem (original behavior)
    if (localDivLogosFolder) {
      logoSource = { type: 'local', folder: localDivLogosFolder };
    } else {
      console.warn(`LOGO: No logo folder for conf="${conf}", div="${divAbb}". Skipping team-specific logos.`);
      logoSource = null;
    }
  }
  
  return { logoSource, logosFolder };
}

/**
 * Download a logo from a URL and cache it locally
 * @param {string} url - The logo URL
 * @returns {Promise<FileEntry|null>}
 */
async function downloadLogoFromUrl(url) {
  // Check cache first
  if (logoCache[url]) {
    return logoCache[url];
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Logo not found at URL: ${url}`);
      } else {
        console.warn(`Failed to download logo from ${url}: HTTP ${response.status}`);
      }
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    
    // Get plugin data folder for temp storage
    const dataFolder = await fs.getDataFolder();
    let tempFolder;
    try {
      tempFolder = await dataFolder.getEntry('temp_logos');
    } catch {
      tempFolder = await dataFolder.createFolder('temp_logos');
    }

    // Create a safe filename from the URL (use hash of URL to avoid collisions)
    const urlHash = url.split('').reduce((acc, char) => {
      const hash = ((acc << 5) - acc) + char.charCodeAt(0);
      return hash & hash;
    }, 0);
    const urlParts = url.split('/');
    const originalFilename = urlParts[urlParts.length - 1] || `logo.png`;
    const safeFilename = `${Math.abs(urlHash)}_${originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    
    // Create temp file and write the array buffer
    const tempFile = await tempFolder.createFile(safeFilename, { overwrite: true });
    await tempFile.write(arrayBuffer, { format: storage.formats.binary });
    
    // Cache it
    logoCache[url] = tempFile;
    return tempFile;
  } catch (err) {
    console.error(`Error downloading logo from ${url}:`, err);
    return null;
  }
}

/**
 * Build logo URL from base URL and team info
 * @param {Object} logoSource - Logo source config with baseUrl, leagueName, conf, divAbb
 * @param {string} teamName - Full team name
 * @returns {string} - The complete logo URL
 */
function buildLogoUrl(logoSource, teamName) {
  const { baseUrl, leagueName, conf, divAbb } = logoSource;
  // URL encode all parts (team name will be encoded with proper capitalization)
  const encodedLeague = encodeURIComponent(leagueName);
  const encodedConf = encodeURIComponent(conf);
  const encodedDiv = encodeURIComponent(divAbb);
  const encodedTeam = encodeURIComponent(teamName);
  
  // Single URL format: team name is URL-encoded with original capitalization
  return `${baseUrl}/${encodedLeague}/${encodedConf}/${encodedDiv}/${encodedTeam}.png`;
}

/**
 * Replace Smart Object contents with a team logo
 * Supports both online (URL) and local filesystem logos
 * @param {Layer} layer - The Photoshop layer (Smart Object) to replace
 * @param {Object|null} logoSource - Logo source config (from buildLogoSource) or null
 * @param {string} teamName - Full team name
 * @param {FolderEntry|null} fallbackLogosFolder - Optional fallback folder for LeagueLogo.png
 * @param {string} context - Optional context string for logging (e.g., "STANDINGS", "STATS", "SCHEDULE")
 */
async function replaceLogo(layer, logoSource, teamName, fallbackLogosFolder = null, context = 'LOGO') {
  try {
    if (!layer || !teamName) return;

    let logoFileEntry = null;

    if (logoSource && logoSource.type === 'url') {
      // Online logo: build URL with proper encoding
      const logoUrl = buildLogoUrl(logoSource, teamName);
      logoFileEntry = await downloadLogoFromUrl(logoUrl);
      
      // If cloud logo not found, try local disk logos as fallback
      if (!logoFileEntry && logoSource.localFallbackFolder) {
        const divLogosFolder = logoSource.localFallbackFolder;
        const candidates = [
          `${teamName}.png`,
          `${teamName.replace(/\s+/g, ' ')}.png`,
          `${teamName.replace(/\s+/g, '_')}.png`,
          `${teamName.replace(/\s+/g, '-')}.png`,
          `${teamName.toUpperCase()}.png`,
          `${teamName.toLowerCase()}.png`
        ];

        for (const name of candidates) {
          try { logoFileEntry = await divLogosFolder.getEntry(name); if (logoFileEntry) break; } catch {}
        }
        if (!logoFileEntry) {
          const entries = await divLogosFolder.getEntries();
          const match = entries.find(e => e.isFile && e.name.toLowerCase().startsWith(teamName.toLowerCase()) && e.name.toLowerCase().endsWith('.png'));
          if (match) logoFileEntry = match;
        }
        
        if (logoFileEntry) {
          console.log(`${context}: Using local disk logo for "${teamName}" (cloud logo not found).`);
        }
      }
      
      // Final fallback to LeagueLogo if both cloud and local disk logos fail
      if (!logoFileEntry && fallbackLogosFolder) {
        try {
          logoFileEntry = await fallbackLogosFolder.getEntry('LeagueLogo.png');
          console.warn(`${context}: Using fallback LeagueLogo for "${teamName}" (cloud and local logos not found).`);
        } catch (e) {
          console.warn(`${context}: Could not find logo for "${teamName}" (cloud, local, and LeagueLogo all failed).`);
        }
      } else if (!logoFileEntry) {
        console.warn(`${context}: Could not download logo for "${teamName}" from URL and no local fallback available.`);
      }
    } else if (logoSource && logoSource.type === 'local') {
      // Local filesystem (original behavior)
      const divLogosFolder = logoSource.folder;
      const candidates = [
        `${teamName}.png`,
        `${teamName.replace(/\s+/g, ' ')}.png`,
        `${teamName.replace(/\s+/g, '_')}.png`,
        `${teamName.replace(/\s+/g, '-')}.png`,
        `${teamName.toUpperCase()}.png`,
        `${teamName.toLowerCase()}.png`
      ];

      for (const name of candidates) {
        try { logoFileEntry = await divLogosFolder.getEntry(name); if (logoFileEntry) break; } catch {}
      }
      if (!logoFileEntry) {
        const entries = await divLogosFolder.getEntries();
        const match = entries.find(e => e.isFile && e.name.toLowerCase().startsWith(teamName.toLowerCase()) && e.name.toLowerCase().endsWith('.png'));
        if (match) logoFileEntry = match;
      }
      
      // Fallback to LeagueLogo if team logo not found
      if (!logoFileEntry && fallbackLogosFolder) {
        try {
          logoFileEntry = await fallbackLogosFolder.getEntry('LeagueLogo.png');
          console.warn(`${context}: Using fallback LeagueLogo for "${teamName}" (team logo not found).`);
        } catch (e) {
          // No fallback available
        }
      }
    } else if (!logoSource && fallbackLogosFolder) {
      // No logo source configured, try fallback directly
      try {
        logoFileEntry = await fallbackLogosFolder.getEntry('LeagueLogo.png');
      } catch (e) {
        // No fallback available
      }
    }

    if (!logoFileEntry) return;

    const originalLayerId = layer._id;
    const originalName = layer.name;
    const token = await fs.createSessionToken(logoFileEntry);
    await app.batchPlay([{ _obj: 'select', _target: [{ _ref: 'layer', _id: originalLayerId }], makeVisible: true }], { synchronousExecution: true });
    await app.batchPlay([{ _obj: 'placedLayerMakeCopy' }], { synchronousExecution: true });
    const copiedLayer = app.activeDocument.activeLayers[0];
    copiedLayer.name = originalName;
    await app.batchPlay([{ _obj: 'placedLayerReplaceContents', _target: [{ _ref: 'layer', _id: copiedLayer._id }], 'null': { _path: token, _kind: 'local' } }], { synchronousExecution: true });
    await app.batchPlay([{ _obj: 'delete', _target: [{ _ref: 'layer', _id: originalLayerId }] }], { synchronousExecution: true });
  } catch (err) {
    console.error(`${context}: replaceLogo error for "${teamName}":`, err);
  }
}

/**
 * Clear logo cache (both in-memory and temp files on disk)
 */
async function clearLogoCache() {
  // Clear in-memory cache
  for (const key in logoCache) {
    delete logoCache[key];
  }
  
  // Clear temp files on disk
  try {
    const dataFolder = await fs.getDataFolder();
    try {
      const tempFolder = await dataFolder.getEntry('temp_logos');
      const entries = await tempFolder.getEntries();
      for (const entry of entries) {
        if (entry.isFile) {
          try {
            await entry.delete();
          } catch (e) {
            console.warn(`Could not delete temp file: ${entry.name}`, e);
          }
        }
      }
    } catch (e) {
      // temp_logos folder doesn't exist, nothing to clear
    }
  } catch (err) {
    console.error('Error clearing logo cache:', err);
  }
}

// Export functions
module.exports = {
  buildLogoSource,
  replaceLogo,
  clearLogoCache
};

