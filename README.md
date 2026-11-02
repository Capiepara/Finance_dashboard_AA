# Personal Finance Dashboard

Static GitHub Pages dashboard connected directly to the Google Sheets `Transaction` tab.

Live site: https://capiepara.github.io/Finance_dashboard_AA/

## How data updates
- The page reads the Google Sheet live, so new rows show up without redeploying.
- It reloads the sheet every 5 minutes while the tab is open, and again when you switch back to the tab (`CONFIG.autoRefreshMinutes` in `app.js`).
- The top bar shows `Live · updated HH:MM`. If a background reload fails, the current data stays on screen and the status shows `Offline`.
- The sheet must stay shared as "Anyone with the link can view".

## V5.4 changes
- Navy / slate theme: Smart Blue, Steel Azure, Regal Navy, Prussian Blue, Twilight Indigo, Blue Slate, Slate Grey, Cool Steel. Chart order Smart Blue → Cool Steel → Regal Navy → Blue Slate (neighbours checked for color-blind safety); coral only marks money going out / negatives
- Square bar ends

## V5.3 changes
- Green–blue theme (replaced in V5.4)
- **Goal plan** page: savings goal (default 500M in 5 years, 5% return), statistical model (1,000 bootstrap simulations of past months), what-if sliders, suggested plan (≥70% chance), call-to-action list and a statistics table
- Savings page: monthly result (income − expense), balance over time, deposits vs withdrawals, balance per bucket
- Transactions page: totals for the current month/search (income, expense, net, count, average, biggest expense) and a split by category
- Hover tooltips on all charts, round axis steps, page links (e.g. `#plan`, `#savings`)

## V5.2 changes
- Reads the `transaction` tab through the export link, so filters switched on in the sheet no longer hide rows
- **Data check** page: rows left out of totals (e.g. empty Type) and rows to review, with their sheet row numbers
- Savings page shows real money from the `saving` tab: moved per bucket and running balance; months that spent more than they earned show as negative
- Monthly budget comes from the `budget` tab (falls back to 19M if the tab is missing)
- The current month is marked "in progress" (period runs to the 22nd; salary day rule = 23rd)

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
