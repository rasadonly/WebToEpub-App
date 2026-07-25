# Hosting on GitHub Pages

This project is configured to build and deploy to GitHub Pages automatically.

## What was configured

- `vite.config.ts` uses `base: './'` so bundled asset URLs work under any subpath (e.g. `https://<user>.github.io/<repo>/`).
- `src/App.tsx` uses `HashRouter` instead of `BrowserRouter`. GitHub Pages has no server-side SPA rewrite; hash routes (`/#/route`) work on any subpath without extra config.
- `public/.nojekyll` is included so Vite's `assets/` folder isn't stripped by Jekyll.
- `.github/workflows/deploy-pages.yml` builds and deploys on every push to `main`.
- The workflow copies `index.html` to `404.html` as an extra SPA safety net.

## One-time setup

1. Push this repository to GitHub.
2. In the GitHub repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions**, add three repository secrets (copy the values from your local `.env`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`

   These are public keys (the anon key + project URL) — safe to bake into a client bundle. Row-level security in the backend protects the data.
4. Push to `main`. The workflow will build and publish the site to `https://<user>.github.io/<repo>/`.

## Backend still works

The backend (database, edge functions, auth) is hosted on Lovable Cloud and reachable from any origin, including GitHub Pages. No backend changes are required.
