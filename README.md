# Personal Finance Dashboard

Static GitHub Pages dashboard connected directly to the Google Sheets `Transaction` tab.

Live site: https://capiepara.github.io/Finance_dashboard_AA/

## How data updates
- The page reads the Google Sheet live, so new rows show up without redeploying.
- It reloads the sheet every 5 minutes while the tab is open, and again when you switch back to the tab (`CONFIG.autoRefreshMinutes` in `app.js`).
- The top bar shows `Live · updated HH:MM`. If a background reload fails, the current data stays on screen and the status shows `Offline`.
- The sheet must stay shared as "Anyone with the link can view".

## V5.1 changes
- Automatic data refresh (every 5 minutes and on returning to the tab)
- Last-updated time in the status badge
- A failed background refresh keeps the current data instead of clearing it

## V5 changes
- Savings month filter now supports multiple months at the same time
- `Select All` and `Clear All` actions
- Savings summary cards aggregate the selected months
- Waterfall aggregates Income, Expense and Net Savings for the selected period
- Savings Allocation distributes the selected-period savings using 15% / 10% / 25% / 20% / 30%
- Monthly Allocation Table shows only the selected month columns and adds a Selected Total column
- Live Google Sheets only; no stale snapshot fallback
- Data labels on charts, Expense by Item pie chart, larger Expense by Category view
- Independent month filter on Transactions
- Nunito typography, square corners, Eggshell / Burnt Peach / Twilight Indigo / Muted Teal / Apricot palette

## Deploying code changes
Run `deploy.cmd` (or `deploy.ps1`) in the project folder. It copies `index.html`, `styles.css`, `app.js` and `README.md` to the `main` branch of `Capiepara/Finance_dashboard_AA` and pushes. GitHub Pages serves `main` / `(root)`.
