## 2.4.1
- Folder structure: Gameday Graphics is now expected directly inside the league folder (no Automations folder)

## 2.4.0
- Added Bracket feature
- Added Playoff Stats feature
- master CSV sheet reads columns by header, not order

## 2.3.1 - Jan 23 2026
- Fixed gameType vs season grouping, playoff games are on separate graphic now

## 2.3.0 - Jan 21 2026
- Added playoff template support for Schedule (SCHEDULE_Playoffs.psd) when gameType is "Playoffs"
    - Added seed display in team names for playoff games (format: "#SEED Team Name")
    - Added ROUND layer update for playoff games
    - Changed Schedule header to "PLAYOFFS" when gameType is "Playoffs"
- Offloaded Standings sorting to online spreadsheet
- Added "TBD" fallback for blank team names in Schedule

## 2.2.0 - Dec 20 2025
- Added option for cloud export to Cloudflare CDN
- Logos can now be pulled from Cloudflare CDN if present instead of locally
- Option to ignore week for current stats and standings of all division

## 2.1.0 - Dec 15 2025
- Improved standings chunking logic to support very large divisions, splitting them into multiple balanced pages (e.g., 12 teams → 6+6, 19 teams → 7+7+5) without duplicating or dropping teams
- Hid unused `TEAM` rows on partial pages so second/third standings pages only show the number of teams they actually contain
- Relaxed logo handling in Schedule/Standings/Stats so missing conference/division logo folders or PNGs no longer cause errors and simply leave the existing logo in place
- Made team color fills optional (when a color is missing in Sheets, PSD defaults are preserved instead of forced to gray/black)
- Updated panel status messages to show how many teams are in each division while updating standings and how many games are on each schedule graphic

## 2.0.0 - Nov 22 2025
- Switched league configuration and all CSV data sources (Divisions, Teams, Schedule, Standings, Player & Goalie Stats) to live Google Sheets CSV links per league
- Added master league mapping sheet support, keyed by league folder name, so each export type can use its own published CSV URL
- Updated plugin manifest network permissions to allow fetching data from `https://docs.google.com`
- Refreshed plugin UI with a darker background, card-style panels, and updated button/field styling

## 1.1.4 - Nov 21 2025
- Use division-specific header color; schedule uses conference color unless a division is selected
- Save As working file immediately after opening to avoid editing templates
- Added OTW in standings; improved missing-layer logging and fallbacks

## 1.1.3 - Nov 19 2025
- Added option for division-specific standings file in same folder

## 1.1.2 - Nov 18 2025
- Trim pronouns off of names in Stats
- Option to sort standings by PT% if header is ordered first in Table Headers, otherwise sort by Points

## 1.1.1 - Nov 13 2025
- Fixed standings exports overwriting by appending chunk index to file name

## 1.1.0 - Nov 10 2025
- Added dynamic subsection stats update, Points per Game capabilities
- Filtered out "Backup Goalie" from stats
- Fixed logo file search to look for 'fullTeam' instead of only 'teamName'
- Added 'divShort' to use shortened versions of division names in case of limited space (final scores)
- Removed "Division" at the end of division labels
- Updated standings scaling for more than 6 teams
- Schedule working files now created per day of the week

## 1.0.2 – Nov 8 2025
- Fixed text color not updating on white backgrounds

## 1.0.1 – Oct 30 2025
- Added dynamic font resizing

## 1.0.0 - Oct 20 2025
- Initial release