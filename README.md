# Money Dash PWA

A simple dark-theme, mobile-first progressive web app for tracking expenses in two separate accounts plus free-form money notes.

## Features

- **3 tabs/pages**
  - Personal dashboard
  - Business dashboard
  - Money Notes
- **Dashboard UI**
  - Circular segmented spending chart with month-to-date total in the center
  - Recent transactions list
  - Floating `+` button to add expenses
- **Separate local data stores**
  - `money.pwa.personal.v1`
  - `money.pwa.business.v1`
  - `money.pwa.notes.v1`
- **PWA support**
  - Manifest + install metadata
  - Offline cache via service worker
  - iPhone home-screen friendly configuration
- **Free GitHub Pages static hosting** via Actions

## Tech Stack

- React 19 + TypeScript
- Vite 8
- vite-plugin-pwa

## Local Development

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 43123
```

Then open the shown URL in your browser.

## Build

```bash
npm run build
```

The production files are emitted to `dist/`.

## Deploy to GitHub Pages

1. Push this project to GitHub.
2. In GitHub repo settings, go to **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Ensure the workflow `.github/workflows/deploy-pages.yml` is present on the default branch.
5. Push to `main` (or run the workflow manually) to deploy.
6. Your app will publish at:
   `https://<your-user-or-org>.github.io/<repo-name>/`

### Why this works with any repo name

The Vite `base` path is computed from `GITHUB_REPOSITORY` during the Actions build, so links/assets resolve correctly for repository-scoped Pages URLs.

## iPhone Install Notes

1. Open the deployed site in Safari.
2. Tap **Share** → **Add to Home Screen**.
3. Launch from the home-screen icon for a standalone app-like experience.

## Data Durability Caveats

- Data is stored on-device in `localStorage` (simple and fast, no external services).
- Data stays separate between Personal/Business/Notes stores.
- iOS may clear site storage in low-storage conditions or after long inactivity.
- Clearing Safari website data or uninstalling browser/app context removes local records.

For stronger durability across devices, add an explicit export/import or cloud sync in a future version.
