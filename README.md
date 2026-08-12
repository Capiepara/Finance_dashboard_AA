# Personal Finance Dashboard V2

A static personal finance dashboard designed for GitHub Pages.

## Data source

The site reads the `Transaction` tab directly from Google Sheets using its CSV export URL. There is no `data` folder.

## GitHub Pages setup

1. Upload `index.html`, `styles.css`, `app.js`, and `README.md` to the repository root.
2. Open **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Choose `main` and `/(root)`.
5. Save.

## Google Sheet access

The spreadsheet must be shared as **Anyone with the link → Viewer**.

## Budget settings

Edit the `CONFIG` object near the top of `app.js`:

- Total monthly expense budget: 19,000,000
- Meal budget: 4,000,000
- Unexpected budget: 1,000,000
- Savings allocation percentages

The remaining 14,000,000 is displayed under Fixed as an initial planning assumption. You can replace it with detailed category budgets later.
