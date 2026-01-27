// ========== LEAGUE CONFIGURATION ==========
// Reads and parses all league data. CSVs are now loaded from Google Sheets.
// Master league → sheet URL mapping:
// https://docs.google.com/spreadsheets/d/e/2PACX-1vSbCy1pnMHPC-i_MU3x2U8ESVtSeDu7M8RrDbNxl0D-aT-TFlJJ9o7KDMyugap2vlQgTCF8y5FSwLT2/pub?output=csv

const MASTER_LEAGUE_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSbCy1pnMHPC-i_MU3x2U8ESVtSeDu7M8RrDbNxl0D-aT-TFlJJ9o7KDMyugap2vlQgTCF8y5FSwLT2/pub?output=csv";

// Simple in‑memory caches so we don’t refetch the same data repeatedly
// leagueName -> {
//   divisionUrl, teamUrl, scheduleUrl,
//   standingsUrl, goalieUrl, playerUrl
// }
const leagueUrlCache = {};
const brandingSheetCache = {};  // leagueName -> { "Divisions": [...], "All Teams": [...] }

/**
 * Parse CSV content into an array of arrays
 * Handles quoted values that contain commas
 */
function parseCSV(csvContent) {
    const lines = csvContent.replace(/\r/g, "").split("\n");
    const result = [];

    for (const line of lines) {
        if (!line.trim()) continue; // Skip empty rows

        const csvArray = [];
        let currentValue = "", inQuotes = false;

        for (let char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            csvArray.push(currentValue.trim());
            currentValue = "";
        } else {
            currentValue += char;
        }
        }

        csvArray.push(currentValue.trim());
        result.push(csvArray);
    }

    return result;
}

/**
 * Fetch text from a URL (Google Sheets CSV)
 */
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching ${url}`);
  }
  return await res.text();
}

/**
 * Look up the per‑league URLs (branding, schedule, stats) from the master sheet
 * using the selected base folder name as the LEAGUE key.
 */
async function getLeagueCsvUrls(baseFolder) {
  const leagueName = String(baseFolder?.name || "").trim();
  if (!leagueName) {
    throw new Error("Base folder name is missing – cannot resolve league row in master sheet.");
  }

  if (leagueUrlCache[leagueName]) {
    return leagueUrlCache[leagueName];
  }

  const masterCsv = await fetchText(MASTER_LEAGUE_SHEET_URL);
  const rows = parseCSV(masterCsv);

  if (rows.length === 0) {
    throw new Error("Master league sheet is empty.");
  }

  // Create header map from first row
  const headerRow = rows[0];
  const headerMap = createHeaderMap(headerRow);

  let divisionUrl = "";
  let teamUrl = "";
  let scheduleUrl = "";
  let standingsUrl = "";
  let goalieUrl = "";
  let playerUrl = "";

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const leagueCell = String(getValue(row, "LEAGUE", headerMap) || "").trim();
    if (!leagueCell) continue;
    if (leagueCell.toLowerCase() === leagueName.toLowerCase()) {
      divisionUrl  = String(getValue(row, "DIVISION INFO", headerMap) || "").trim();
      teamUrl      = String(getValue(row, "TEAM INFO", headerMap) || "").trim();
      scheduleUrl  = String(getValue(row, "SCHEDULE", headerMap) || "").trim();
      standingsUrl = String(getValue(row, "STANDINGS", headerMap) || "").trim();
      goalieUrl    = String(getValue(row, "GOALIE STATS", headerMap) || "").trim();
      playerUrl    = String(getValue(row, "PLAYER STATS", headerMap) || "").trim();
      break;
    }
  }

  if (!divisionUrl || !teamUrl || !scheduleUrl || !standingsUrl || !goalieUrl || !playerUrl) {
    throw new Error(`League "${leagueName}" not found or URLs missing in master league sheet.`);
  }

  const urls = { divisionUrl, teamUrl, scheduleUrl, standingsUrl, goalieUrl, playerUrl };
  leagueUrlCache[leagueName] = urls;
  return urls;
}

/**
 * Get and cache branding sheets for this league
 *  - "Divisions"  -> Division Info URL
 *  - "All Teams"  -> Team Info URL
 */
async function getBrandingSheet(baseFolder, sheetName) {
  const leagueName = String(baseFolder?.name || "").trim();
  if (!leagueName) {
    throw new Error("Base folder name is missing – cannot load branding sheet.");
  }

  if (!brandingSheetCache[leagueName]) {
    brandingSheetCache[leagueName] = {};
  }
  if (brandingSheetCache[leagueName][sheetName]) {
    return brandingSheetCache[leagueName][sheetName];
  }

  const { divisionUrl, teamUrl } = await getLeagueCsvUrls(baseFolder);
  let targetUrl = "";
  if (sheetName === "Divisions") {
    targetUrl = divisionUrl;
  } else if (sheetName === "All Teams") {
    targetUrl = teamUrl;
  } else {
    throw new Error(`Unknown branding sheet name "${sheetName}"`);
  }

  const csvText = await fetchText(targetUrl);
  const parsed = parseCSV(csvText);
  brandingSheetCache[leagueName][sheetName] = parsed;
  return parsed;
}

/**
 * Convenience helper for schedule sheet (SCHEDULE column)
 */
async function getScheduleSheet(baseFolder /*, sheetNameIgnored */) {
  const { scheduleUrl } = await getLeagueCsvUrls(baseFolder);
  const csvText = await fetchText(scheduleUrl);
  return parseCSV(csvText);
}

/**
 * Convenience helper for stats sheets (STANDINGS / GOALIE STATS / PLAYER STATS columns)
 */
async function getStatsSheet(baseFolder, sheetName) {
  const { standingsUrl, goalieUrl, playerUrl } = await getLeagueCsvUrls(baseFolder);

  let targetUrl = "";
  if (sheetName === "STANDINGS") {
    targetUrl = standingsUrl;
  } else if (sheetName === "GOALIE STATS") {
    targetUrl = goalieUrl;
  } else if (sheetName === "PLAYER STATS") {
    targetUrl = playerUrl;
  } else {
    throw new Error(`Unknown stats sheet name "${sheetName}"`);
  }

  const csvText = await fetchText(targetUrl);
  return parseCSV(csvText);
}

/**
 * Build a header map (column name -> index) from the first CSV row
 */
function createHeaderMap(headerRow) {
  const headerMap = {};
  for (let i = 0; i < headerRow.length; i++) {
    headerMap[headerRow[i]] = i;
  }
  return headerMap;
}

/**
 * Safe getter from a CSV row using a header map
 */
function getValue(row, columnName, headerMap) {
  const idx = headerMap[columnName];
  return typeof idx === "number" ? row[idx] : "";
}

/**
 * Read and parse Division Info from Google Sheets ("Divisions" tab)
 * Returns array of division objects
 */
async function loadDivisionInfo(baseFolder) {
  try {
    const divInfo = await getBrandingSheet(baseFolder, "Divisions");
    
    // SETUP DIVISION INFO
    const divs = [];
    
    for (let n = 1; n < divInfo.length; n++) {
      const divObject = {
        conf: divInfo[n][0],
        div: divInfo[n][1],
        abb: divInfo[n][2],
        color1: divInfo[n][3],
        color2: divInfo[n][4],
        divShort: divInfo[n][6]
      };
      divs.push(divObject);
    }
    
    console.log(`✅ Loaded ${divs.length} divisions`);
    return divs;
  } catch (error) {
    console.error("Error loading division info:", error);
    return [];
  }
}

/**
 * Read and parse Conference Info from Google Sheets ("Divisions" tab)
 * Returns array of unique conference objects
 */
async function loadConferenceInfo(baseFolder) {
  try {
    const divInfo = await getBrandingSheet(baseFolder, "Divisions");
    
    // SETUP CONFERENCE INFO
    const confs = [];
    
    for (let n = 1; n < divInfo.length; n++) {
      const confName = divInfo[n][0];
      let isUnique = true;
      
      // Manual check for uniqueness
      for (let k = 0; k < confs.length; k++) {
        if (confs[k].conf === confName) {
          isUnique = false;
          break;
        }
      }
      
      if (isUnique) {
        const confObject = {
          conf: divInfo[n][0],
          color: divInfo[n][3],
          timeZone: divInfo[n][4],
          location: divInfo[n][5]
        };
        confs.push(confObject);
      }
    }
    
    console.log(`✅ Loaded ${confs.length} conferences`);
    return confs;
  } catch (error) {
    console.error("Error loading conference info:", error);
    return [];
  }
}

/**
 * Read and parse Team Info from Google Sheets ("All Teams" tab)
 * Returns array of team objects
 */
async function loadTeamInfo(baseFolder) {
  try {
    const teamInfo = await getBrandingSheet(baseFolder, "All Teams");
    
    // SETUP TEAM INFO
    const teams = [];
    
    for (let n = 1; n < teamInfo.length; n++) {
      const teamObject = {
        conf: teamInfo[n][0],
        div: teamInfo[n][1],
        abb: teamInfo[n][2],
        teamCity: teamInfo[n][3],
        teamName: teamInfo[n][4],
        fullTeam: teamInfo[n][7],
        color1: teamInfo[n][5],
        color2: teamInfo[n][6]
      };
      teams.push(teamObject);
    }
    
    console.log(`✅ Loaded ${teams.length} teams`);
    return teams;
  } catch (error) {
    console.error("Error loading team info:", error);
    return [];
  }
}

/**
 * Load player stats from Google Sheets ("PLAYER STATS" tab)
 * Returns array of parsed player stats
 */
async function loadPlayerStats(baseFolder) {
  try {
    const playerStatRead = await getStatsSheet(baseFolder, "PLAYER STATS");

    const headerMap = createHeaderMap(playerStatRead[0]);

    const allPlayerStats = [];
    for (let n = 1; n < playerStatRead.length; n++) {
      const row = playerStatRead[n];
      
      const playerStatline = {
        firstName: getValue(row, 'First Name', headerMap),
        lastName: getValue(row, 'Last Name', headerMap),
        teamName: getValue(row, 'Team', headerMap),
        div: getValue(row, 'Division', headerMap),
        goals: Number(getValue(row, 'G', headerMap)),
        assists: Number(getValue(row, 'A', headerMap)),
        points: Number(getValue(row, 'PTS', headerMap)),
        ppg: getValue(row, 'PTS/GP', headerMap),
      }
      playerStatline.fullName = playerStatline.firstName + ' ' + playerStatline.lastName

      if (!playerStatline.teamName) continue
      
      allPlayerStats.push(playerStatline);    
    }
    console.log(`✅ Built ${allPlayerStats.length} player stat objects`);
    return allPlayerStats;
  } catch (error) {
    console.error("Error loading player stats:", error);
    return [];
  }
}

/**
 * Load goalie stats from Google Sheets ("GOALIE STATS" tab)
 * Returns array of parsed goalie stats
 */
async function loadGoalieStats(baseFolder) {
  try {
    const goalieStatRead = await getStatsSheet(baseFolder, "GOALIE STATS");

    const headerMap = createHeaderMap(goalieStatRead[0]);

    const allGoalieStats = [];
    for (let n = 1; n < goalieStatRead.length; n++) {
      const row = goalieStatRead[n];

      const goalieStatline = {
        firstName: getValue(row, 'First Name', headerMap),
        lastName: getValue(row, 'Last Name', headerMap),
        teamName: getValue(row, 'Team', headerMap),
        div: getValue(row, 'Division', headerMap),
        GA: getValue(row, 'GA', headerMap),
        GAA: getValue(row, 'GAA', headerMap),
        GP: getValue(row, 'GP', headerMap),
      }
      goalieStatline.fullName = goalieStatline.firstName + ' ' + goalieStatline.lastName

      // Filter out placeholder entries like "Backup Goalie"
      const fullNameNormalized = String(goalieStatline.fullName || '').trim().toLowerCase();
      if (fullNameNormalized == 'backup goalie') continue;

      if (!goalieStatline.teamName) continue

      allGoalieStats.push(goalieStatline);
    }
    console.log(`✅ Built ${allGoalieStats.length} goalie stat objects`);
    return allGoalieStats;
  } catch (error) {
    console.error("Error loading goalie stats:", error);
    return [];
  }
}

/**
 * Load standings from Google Sheets ("STANDINGS" tab)
 * Returns array of parsed standings data
 */
async function loadStandings(baseFolder) {
  try {
    const standingsRead = await getStatsSheet(baseFolder, "STANDINGS");

    if (!standingsRead || standingsRead.length === 0) {
      console.log("Loaded 0 standings rows");
      return [];
    }

    const headerMap = createHeaderMap(standingsRead[0]);

    const teamStats = [];
    for (let n = 1; n < standingsRead.length; n++) {
      const row = standingsRead[n];
      if (!row || row.length === 0) continue;

      const teamStatline = {
        fullTeam: getValue(row, 'Team Name', headerMap),
        teamCity: null,
        teamName: null,
        div: getValue(row, 'Division', headerMap),
        gp: getValue(row, 'GP', headerMap),
        w: getValue(row, 'W', headerMap),
        otw: getValue(row, 'OTW', headerMap),
        otl: getValue(row, 'OTL', headerMap),
        l: getValue(row, 'L', headerMap),
        pts: getValue(row, 'PTS', headerMap),
        diff: getValue(row, 'DIFF', headerMap),
        pct: getValue(row, 'P%', headerMap),
        gf: getValue(row, 'GF', headerMap),
        ga: getValue(row, 'GA', headerMap),
        rank: getValue(row, 'RANK', headerMap),
      };

      if (teamStatline.pct === '#DIV/0!') teamStatline.pct = '0.000';
      if (!teamStatline.fullTeam) continue;
      teamStats.push(teamStatline);
    }

    console.log(`✅ Built ${teamStats.length} standings objects`);
    return teamStats;
    
  } catch (error) {
    console.error("Error loading standings:", error);
    return [];
  }
}

/**
 * Load schedule from Google Sheets ("ALL GAMES" tab) and build structured game objects joined with division info
 * Returns { scheduleData: Game[], week, year }
 */
async function loadSchedule(baseFolder) {
  try {
    const scheduleRead = await getScheduleSheet(baseFolder, "ALL GAMES");

    // Extract week and year using original index-based logic
    const week = Number(scheduleRead[1][2]);
    const year = Number(scheduleRead[1][3]);

    const headerMap = createHeaderMap(scheduleRead[2]);
    const divs = await loadDivisionInfo(baseFolder);

    const schedule = [];
    for (let n = 2; n < scheduleRead.length; n++) {
      const row = scheduleRead[n];
      if (!row || row.length === 0) continue;

      const gameWeekNum = Number(getValue(row, 'Week', headerMap));
      if (isNaN(gameWeekNum) || gameWeekNum < 0) continue;

      const div1Full = getValue(row, 'Div 1', headerMap);
      const div2Full = getValue(row, 'Div 2', headerMap);

      let div1name = '', div1conf = '', div1abb = '';
      let div2name = '', div2conf = '', div2abb = '';

      for (let i = 0; i < divs.length; i++) {
        const fullName = divs[i].conf + ' ' + divs[i].div;
        if (!div1abb && div1Full === fullName) {
          div1name = divs[i].div;
          div1conf = divs[i].conf;
          div1abb = divs[i].abb;
        }
        if (!div2abb && div2Full === fullName) {
          div2name = divs[i].div;
          div2conf = divs[i].conf;
          div2abb = divs[i].abb;
        }
        if (div1abb && div2abb) break;
      }

      const game = {
        week: getValue(row, 'Week', headerMap),
        gameType: getValue(row, 'Game Type', headerMap),
        season: getValue(row, 'Season', headerMap),
        date: getValue(row, 'Date', headerMap),
        dateShort: getValue(row, 'Date Short', headerMap),
        day: getValue(row, 'Day', headerMap),
        time: getValue(row, 'Time', headerMap),
        team1: getValue(row, 'Team 1', headerMap),
        div1: div1abb,
        division1: div1name,
        conf: div1conf,
        score1: getValue(row, 'Score 1', headerMap),
        team2: getValue(row, 'Team 2', headerMap),
        div2: div2abb,
        division2: div2name,
        score2: getValue(row, 'Score 2', headerMap),
        status: getValue(row, 'Final', headerMap),
        location: getValue(row, 'Location', headerMap),
        divOverall: div1abb,
        seed1: getValue(row, 'Seed 1', headerMap),
        seed2: getValue(row, 'Seed 2', headerMap),
        round: getValue(row, 'Round', headerMap),
      };

      schedule.push(game);
    }

    console.log(`✅ Built ${schedule.length} schedule objects (Week ${week}, Year ${year})`);
    return {
      schedule,
      week,
      year
    };
  } catch (error) {
    console.error("Error loading schedule:", error);
    return {
      schedule: [],
      week: 0,
      year: 0
    };
  }
}

/**
 * Load all league configuration data at once
 * Returns object with divs, confs, and teams
 */
async function loadLeagueConfig(baseFolder) {
  console.log("📋 Loading league configuration...");
  
  const [divs, confs, teams] = await Promise.all([
    loadDivisionInfo(baseFolder),
    loadConferenceInfo(baseFolder),
    loadTeamInfo(baseFolder)
  ]);
  
  return {
    divs,
    confs,
    teams
  };
}

/**
 * Invalidate cached URLs + branding sheets for the current league.
 * Call this once at the start of a run so each request sees fresh data,
 * while still avoiding repeated fetches inside a single run.
 */
async function invalidateLeagueCache(baseFolder) {
  const leagueName = String(baseFolder?.name || "").trim();
  if (!leagueName) return;
  delete leagueUrlCache[leagueName];
  delete brandingSheetCache[leagueName];
}

/**
 * Get user division selection from UI and convert abbreviation if needed
 * Returns the full division string (e.g., "CENTRAL CENTRAL") or "ALL"
 */
function getUserDivision(divs) {
  const divisionInput = document.getElementById("divisionInput").value.trim().toUpperCase();
  let userDiv = divisionInput === "" ? "ALL" : divisionInput;
  
  // Convert abbreviation to full "conf div" format
  for (let i = 0; i < divs.length; i++) {
    if (userDiv === divs[i].abb) {
      userDiv = divs[i].conf + ' ' + divs[i].div;
      break;
    }
  }
  
  return userDiv;
}

// Export functions
module.exports = {
  parseCSV,
  invalidateLeagueCache,
  loadDivisionInfo,
  loadConferenceInfo,
  loadTeamInfo,
  loadPlayerStats,
  loadGoalieStats,
  loadStandings,
  loadSchedule,
  loadLeagueConfig,
  getUserDivision
};
