# Personal Finance Dashboard V3

Static GitHub Pages dashboard with no JavaScript chart/parser CDN dependencies.

## Upload to GitHub
Upload these files to the repository root:
- index.html
- styles.css
- app.js
- README.md

Then enable Settings > Pages > Deploy from a branch > main > /(root).

## Data
The app first tries to read the Transaction sheet from Google Sheets. If live access fails, it automatically shows the embedded CSV snapshot so the dashboard never stays blank.

Current budget settings in app.js:
- Total: 19M
- Meal: 4M
- Unexpected: 1M
