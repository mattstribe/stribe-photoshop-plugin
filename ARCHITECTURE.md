# Plugin Architecture & Flow

This document provides a visual representation of the codebase structure and data flow.

## High-Level Architecture

```mermaid
graph TB
    Start[index.html] --> Init[main.js]
    Init --> License[licensing.js]
    License -->|Activated| UI[ui.js]
    License -->|Not Activated| LicenseScreen[License Screen]
    
    UI --> Storage[storage.js]
    Storage -->|Base Folder| Actions[Action Buttons]
    
    Actions -->|Schedule| ScheduleFlow[schedule.js]
    Actions -->|Standings| StandingsFlow[standings.js]
    Actions -->|Stats| StatsFlow[stats.js]
    
    ScheduleFlow --> LeagueConfig[leagueConfig_200.js]
    StandingsFlow --> LeagueConfig
    StatsFlow --> LeagueConfig
    
    ScheduleFlow --> LogoHandler[logoHandler.js]
    StandingsFlow --> LogoHandler
    StatsFlow --> LogoHandler
    
    ScheduleFlow --> ExportHandler[exportHandler.js]
    StandingsFlow --> ExportHandler
    StatsFlow --> ExportHandler
    
    StandingsFlow -->|Playoff Divisions| BracketFlow[bracket.js]
    BracketFlow --> LogoHandler
    BracketFlow --> ExportHandler
```

## Detailed Data Flow

### 1. Initialization Flow

```mermaid
sequenceDiagram
    participant User
    participant HTML as index.html
    participant Main as main.js
    participant License as licensing.js
    participant UI as ui.js
    participant Storage as storage.js
    
    User->>HTML: Opens Plugin
    HTML->>Main: Loads main.js
    Main->>License: checkLicenseAndLaunch()
    License->>License: Check License Status
    
    alt License Valid
        License->>UI: Show Main UI
        UI->>Storage: Get Base Folder
        Storage->>UI: Return Folder Path
        UI->>UI: initializeUI()
    else License Invalid
        License->>HTML: Show License Screen
        User->>License: Enter Credentials
        License->>License: Validate License
        License->>UI: Show Main UI
    end
```

### 2. Schedule Update Flow

```mermaid
flowchart TD
    Start[User Clicks Schedule Button] --> LoadData[Load League Config & Schedule]
    LoadData --> GetInput[Get Division Input]
    GetInput --> FilterGames[Filter Games by Week/Division]
    FilterGames --> GroupByConf[Group by Conference]
    GroupByConf --> GroupByDate[Group by Date]
    GroupByDate --> GroupByType[Group by GameType]
    
    GroupByType --> CheckPlayoffs{Is Playoffs?}
    CheckPlayoffs -->|Yes| OpenPlayoffTemplate[Open SCHEDULE_Playoffs.psd]
    CheckPlayoffs -->|No| OpenRegularTemplate[Open SCHEDULE.psd]
    
    OpenPlayoffTemplate --> ProcessGames[Process Each Game]
    OpenRegularTemplate --> ProcessGames
    
    ProcessGames --> UpdateHeader[Update Header]
    ProcessGames --> UpdateMatchups[Update Matchups]
    ProcessGames --> AddSeeds{Playoffs?}
    AddSeeds -->|Yes| AddSeedInfo[Add Seeds & Round]
    AddSeeds -->|No| SkipSeeds[Skip Seeds]
    
    AddSeedInfo --> UpdateTeams[Update Team Names/Logos/Colors]
    SkipSeeds --> UpdateTeams
    UpdateTeams --> ExportPNG[Export PNG]
    ExportPNG --> CloudCheck{Cloud Export?}
    CloudCheck -->|Yes| UploadCloud[Upload to Cloudflare R2]
    CloudCheck -->|No| SaveLocal[Save Locally]
    UploadCloud --> Done[Complete]
    SaveLocal --> Done
```

### 3. Standings Update Flow

```mermaid
flowchart TD
    Start[User Clicks Standings Button] --> LoadData[Load League Config, Standings & Schedule]
    LoadData --> GetInput[Get Division Input]
    GetInput --> BuildActiveDivs[Build Active Divisions]
    
    BuildActiveDivs --> CheckWeek{All Divisions<br/>Checkbox?}
    CheckWeek -->|Yes| AllDivs[Include All Divisions]
    CheckWeek -->|No| CurrentWeek[Current Week Only]
    
    AllDivs --> LoopDivs[Loop Each Division]
    CurrentWeek --> LoopDivs
    
    LoopDivs --> CheckPlayoffs{Has Playoff Games<br/>Current/Next Week?}
    CheckPlayoffs -->|Yes| RunBracket[Run bracket.js]
    CheckPlayoffs -->|No| SkipBracket[Skip Bracket]
    
    RunBracket --> CheckRegular{Has Regular Season<br/>Games Current Week?}
    SkipBracket --> CheckRegular
    
    CheckRegular -->|Yes| RunStandings[Run Standings Processing]
    CheckRegular -->|No| SkipStandings[Skip Standings]
    
    RunStandings --> SortTeams[Sort Teams by Rank]
    SortTeams --> ChunkTeams[Chunk Teams if >9]
    ChunkTeams --> OpenTemplate[Open STANDINGS.psd]
    OpenTemplate --> UpdateHeader[Update Header]
    UpdateHeader --> UpdateTable[Update Table Rows]
    UpdateTable --> UpdateStats[Update Team Stats]
    UpdateStats --> ExportPNG[Export PNG]
    ExportPNG --> NextChunk{More Chunks?}
    NextChunk -->|Yes| ChunkTeams
    NextChunk -->|No| Done[Complete]
```

### 4. Stats Update Flow

```mermaid
flowchart TD
    Start[User Clicks Stats Button] --> LoadData[Load League Config, Player Stats, Goalie Stats & Schedule]
    LoadData --> GetInput[Get Division Input]
    GetInput --> BuildActiveDivs[Build Active Divisions]
    
    BuildActiveDivs --> LoopDivs[Loop Each Division]
    LoopDivs --> FilterPlayers[Filter Players by Division]
    FilterPlayers --> CalculateTop[Calculate Top Scorers]
    
    CalculateTop --> TopPoints[Top 5 Points]
    CalculateTop --> TopGoals[Top 3 Goals]
    CalculateTop --> TopPPG[Top 3 Points/Game]
    CalculateTop --> TopGAA[Top 3 Goalies GAA]
    
    TopPoints --> OpenTemplate[Open STATS.psd]
    TopGoals --> OpenTemplate
    TopPPG --> OpenTemplate
    TopGAA --> OpenTemplate
    
    OpenTemplate --> UpdateHeader[Update Header]
    UpdateHeader --> UpdatePoints[Update POINTS Section]
    UpdatePoints --> UpdateGoals[Update GOALS Section]
    UpdateGoals --> UpdateGAA[Update GAA Section]
    
    UpdatePoints --> UpdateTeamInfo[Update Team Colors/Logos]
    UpdateGoals --> UpdateTeamInfo
    UpdateGAA --> UpdateTeamInfo
    
    UpdateTeamInfo --> ExportPNG[Export PNG]
    ExportPNG --> Done[Complete]
```

## Module Dependencies

```mermaid
graph LR
    subgraph "Core Modules"
        Main[main.js]
        UI[ui.js]
        Storage[storage.js]
        License[licensing.js]
    end
    
    subgraph "Data Layer"
        LeagueConfig[leagueConfig_200.js]
        MasterSheet[Master League Sheet CSV]
    end
    
    subgraph "Processing Modules"
        Schedule[schedule.js]
        Standings[standings.js]
        Stats[stats.js]
        Bracket[bracket.js]
    end
    
    subgraph "Support Modules"
        LogoHandler[logoHandler.js]
        ExportHandler[exportHandler.js]
    end
    
    Main --> UI
    Main --> Storage
    Main --> License
    Main --> Schedule
    Main --> Standings
    Main --> Stats
    
    Schedule --> LeagueConfig
    Standings --> LeagueConfig
    Stats --> LeagueConfig
    Bracket --> LeagueConfig
    
    LeagueConfig --> MasterSheet
    
    Schedule --> LogoHandler
    Standings --> LogoHandler
    Stats --> LogoHandler
    Bracket --> LogoHandler
    
    Schedule --> ExportHandler
    Standings --> ExportHandler
    Stats --> ExportHandler
    Bracket --> ExportHandler
    
    Standings --> Bracket
```

## Data Sources

```mermaid
graph TB
    MasterSheet[Master League Sheet<br/>Contains League URLs] --> LeagueConfig
    
    LeagueConfig --> DivisionCSV[Division Info CSV]
    LeagueConfig --> TeamCSV[Team Info CSV]
    LeagueConfig --> ScheduleCSV[Schedule CSV]
    LeagueConfig --> StandingsCSV[Standings CSV]
    LeagueConfig --> PlayerCSV[Player Stats CSV]
    LeagueConfig --> GoalieCSV[Goalie Stats CSV]
    
    DivisionCSV --> Schedule[schedule.js]
    DivisionCSV --> Standings[standings.js]
    DivisionCSV --> Stats[stats.js]
    
    TeamCSV --> Schedule
    TeamCSV --> Standings
    TeamCSV --> Stats
    
    ScheduleCSV --> Schedule
    ScheduleCSV --> Standings
    
    StandingsCSV --> Standings
    
    PlayerCSV --> Stats
    GoalieCSV --> Stats
```

## Key Functions by Module

### main.js
- Entry point
- Event listeners for UI buttons
- Routes to Schedule/Standings/Stats modules

### leagueConfig_200.js
- `getLeagueCsvUrls()` - Gets URLs from master sheet
- `loadLeagueConfig()` - Loads division/team/conference data
- `loadSchedule()` - Loads schedule data
- `loadStandings()` - Loads standings data
- `loadPlayerStats()` - Loads player stats
- `loadGoalieStats()` - Loads goalie stats
- `getUserDivision()` - Converts division input

### schedule.js
- `handleScheduleUpdate()` - Main schedule processing
- Groups games by conference/date/type
- Handles playoff vs regular season templates
- Updates team names, logos, scores, seeds

### standings.js
- `handleStandingsUpdate()` - Main standings processing
- Detects playoff divisions
- Routes to bracket.js for playoffs
- Processes regular season standings
- Chunks large divisions

### bracket.js
- `handleBracketUpdate()` - Bracket processing
- Opens BRACKET.psd template
- Updates header information
- Exports bracket graphics

### stats.js
- `handleStatsUpdate()` - Main stats processing
- Calculates top scorers/goalies
- Updates POINTS, GOALS, GAA sections

### logoHandler.js
- `buildLogoSource()` - Determines logo source (CDN vs local)
- `replaceLogo()` - Replaces logos in Photoshop
- `clearLogoCache()` - Clears cached logos

### exportHandler.js
- `exportPng()` - Exports PNG files
- `buildCdnPath()` - Builds CDN path
- `uploadToR2()` - Uploads to Cloudflare R2

### ui.js
- `initializeUI()` - Initializes UI state
- `updateDivisionDisplay()` - Updates division display
- `updateActionButtons()` - Enables/disables buttons

### storage.js
- `selectAndSaveBaseFolder()` - Folder selection
- `getBaseFolder()` - Gets saved folder

### licensing.js
- `checkLicenseAndLaunch()` - License validation
- `handleActivation()` - License activation
- `logoutUser()` - User logout

## Viewing This Diagram

You can view these Mermaid diagrams in:
1. **GitHub/GitLab** - Renders automatically in markdown
2. **VS Code** - Install "Markdown Preview Mermaid Support" extension
3. **Online** - Copy diagram code to https://mermaid.live/
4. **Documentation tools** - Most markdown renderers support Mermaid

## Notes

- All three main workflows (Schedule, Standings, Stats) share the same data loading pattern
- Standings can route to Bracket for playoff divisions
- Logo handling supports both CDN and local file sources
- Export can go to local filesystem or Cloudflare R2
- League configuration is cached for performance
- Division input supports abbreviations, full names, or "ALL"

