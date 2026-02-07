// ========== LEAGUE CONFIGURATION ==========
// Reads and parses all CSV files for divisions, conferences, teams, etc.

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
 * Read and parse Division Info CSV
 * Returns array of division objects
 */
async function loadDivisionInfo(baseFolder) {
  try {
    const divCSV = await baseFolder.getEntry("Automations/References/DivisionInfo.csv");
    const divContent = await divCSV.read();
    const divInfo = parseCSV(divContent);
    
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
 * Read and parse Conference Info from Division CSV
 * Returns array of unique conference objects
 */
async function loadConferenceInfo(baseFolder) {
  try {
    const divCSV = await baseFolder.getEntry("Automations/References/DivisionInfo.csv");
    const divContent = await divCSV.read();
    const divInfo = parseCSV(divContent);
    
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
 * Read and parse Team Info CSV
 * Returns array of team objects
 */
async function loadTeamInfo(baseFolder) {
  try {
    const teamCSV = await baseFolder.getEntry("Automations/References/TeamInfo.csv");
    const teamContent = await teamCSV.read();
    const teamInfo = parseCSV(teamContent);
    
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
 * Load player stats CSV
 * Returns array of parsed player stats
 */
async function loadPlayerStats(baseFolder) {
  try {
    const playerStatCSV = await baseFolder.getEntry("Automations/References/stats - PLAYER STATS.csv");
    const playerStatRead = parseCSV(await playerStatCSV.read());

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
 * Load goalie stats CSV
 * Returns array of parsed goalie stats
 */
async function loadGoalieStats(baseFolder) {
  try {
    const goalieStatCSV = await baseFolder.getEntry("Automations/References/stats - GOALIE STATS.csv");
    const goalieStatRead = parseCSV(await goalieStatCSV.read());

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
 * Load standings CSV
 * Returns array of parsed standings data
 */
async function loadStandings(baseFolder) {
  try {
    const standingsCSV = await baseFolder.getEntry("Automations/References/stats - STANDINGS.csv");
    const standingsRead = parseCSV(await standingsCSV.read());

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
        ga: getValue(row, 'GA', headerMap)
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
 * Load schedule CSV and build structured game objects joined with division info
 * Returns { scheduleData: Game[], week, year }
 */
async function loadSchedule(baseFolder) {
  try {
    const scheduleCSV = await baseFolder.getEntry("Automations/References/schedules - ALL GAMES.csv");
    const scheduleRead = parseCSV(await scheduleCSV.read());

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
        divOverall: div1abb
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
