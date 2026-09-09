# Deployment

This repo is a **monorepo** with two independently deployed apps:

| App | Lives in | Host | Config |
|---|---|---|---|
| Backend — FastAPI | repo root (`app/`, `alembic/`) | **Render** (web service) | `render.yaml` |
| Frontend — React + Vite | `frontend/` | **Vercel** | `frontend/vercel.json` |
| Database — PostgreSQL | — | **Neon** (external, permanent free tier) | provisioned separately; connection string pasted into Render |

Render hosts only the web service. The database is a **Neon** PostgreSQL
instance you provision yourself — Render's own managed Postgres is deliberately
not used (its free tier is deleted 30 days after creation). `render.yaml` has no
`databases:` block.

```
 Browser ── https://<project>.vercel.app ──► Vercel (static build of frontend/dist)
                     │
                     │  fetch(VITE_API_BASE_URL + "/api/...")   [cross-origin]
                     ▼
        https://expense-splitting-api.onrender.com ──► Render web service (uvicorn)
                     │
                     │  DATABASE_URL (Neon connection string, set by hand in Render)
                     ▼
                Neon PostgreSQL (external)
```

Everything you can't script — creating accounts, the GitHub OAuth handshake,
pasting secrets into dashboards — is spelled out below. **Do the parts in
order:** the frontend build needs the backend's URL, and the backend's CORS
setting needs the frontend's URL, so there is one deliberate loop back at the
end.

Nothing here changes local development — that still runs off `.env` and the Vite
dev-server proxy (see the repo `README.md`).

---

## What in the repo makes this deployable

These were added/changed alongside this guide; you don't need to touch them, but
know they exist:

- **`app/main.py`** now adds `CORSMiddleware` when `CORS_ALLOW_ORIGINS` is set.
  Origins come from that env var — nothing is hardcoded. Unset (local dev) = no
  CORS middleware, because the Vite proxy makes requests same-origin.
- **`app/config.py`** has a new `cors_allow_origins` setting (env
  `CORS_ALLOW_ORIGINS`, comma-separated).
- **`app/database.py`** normalizes the DB URL scheme to `postgresql+psycopg://`,
  accepting both `postgresql://` (what Neon hands out) and the bare `postgres://`
  some hosts inject. Neon's `?sslmode=require` query string is preserved as-is.
- **`frontend/src/lib/api.ts`** already reads the API base from
  `import.meta.env.VITE_API_BASE_URL` (falls back to `""` for the dev proxy) — no
  change needed, just set the var in Vercel.
- **`render.yaml`** runs `alembic upgrade head` in the start command, before
  uvicorn, on every boot.

---

## Prerequisites

- The repo is pushed to GitHub and you can log in to that GitHub account.
- `main` is the branch you want deployed.
- Python available locally (for generating the JWT secret in Part 1, step 3).
- A **Neon** PostgreSQL database already provisioned. Have its connection string
  ready — from the Neon console, **Connection Details → connection string**,
  including `?sslmode=require`. It looks like
  `postgresql://<user>:<password>@<host>.neon.tech/<db>?sslmode=require`.

---

## Part 1 — Backend on Render

### 1.1 Create the account

1. Go to <https://render.com> → **Get Started** → sign up **with GitHub** (makes
   the repo connection in the next step one click).
2. Approve Render's email verification if prompted.

### 1.2 Create the Blueprint

1. Render dashboard → **New +** (top right) → **Blueprint**.
2. **Connect a repository** → authorize Render for your GitHub account →
   pick this repo. If you don't see it, use **Configure account** on GitHub to
   grant Render access to it specifically.
3. Render finds `render.yaml` at the repo root and shows what it will create:
   **one web service**, `expense-splitting-api` (no database — `render.yaml`
   has no `databases:` block).
4. Give the blueprint a name (anything) and click **Apply**.

### 1.3 Set the secrets it prompts for

On first apply, Render shows the three `sync: false` variables as empty fields
to fill in by hand:

| Variable | What to enter |
|---|---|
| `DATABASE_URL` | The **Neon** connection string from Prerequisites, in full, including `?sslmode=require`. Paste it verbatim — the app rewrites only the scheme. |
| `JWT_SECRET` | A **fresh** production secret — **do not reuse the dev value from `.env`**. Generate one now (see below) and paste it. |
| `CORS_ALLOW_ORIGINS` | Leave **blank** for now. You'll set it in Part 3 once the Vercel URL exists. |

Generate the JWT secret locally and paste the output — it is never stored in
this repo:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

`JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES` and `PYTHON_VERSION` come from
`render.yaml` and don't need touching.

### 1.4 Watch the first deploy

1. Render builds the web service (there's no database for it to create — you're
   pointing it at Neon).
2. Open the service → **Logs**. In order you should see:
   - build: `pip install uv` then `uv sync --locked --no-dev`
   - release/start: `alembic ... Running upgrade -> ...` for each migration
   - `Uvicorn running on http://0.0.0.0:10000` (Render's injected `$PORT`)
3. If migrations fail, the deploy fails here — fix forward and push; don't let a
   half-migrated database go live.

### 1.5 Verify and record the URL

1. The service page shows its URL, e.g.
   `https://expense-splitting-api.onrender.com`. **Copy it** — Part 2 needs it.
2. Check:
   - `https://<that-url>/health` → `{"status":"ok"}`
   - `https://<that-url>/docs` → the interactive API docs load

### 1.6 Know the free-tier caveats

- **Cold starts:** a free web service sleeps after ~15 minutes idle; the next
  request takes ~50s while it wakes. Fine for a portfolio demo.
- **Database:** the Neon instance is external and unaffected by anything Render
  does — deleting the Render service leaves the data untouched. Neon's own free
  tier is permanent, but it auto-suspends an idle database; the first query after
  that wakes it in a second or two.
- **Auto-deploy:** every push to `main` triggers a rebuild by default.

---

## Part 2 — Frontend on Vercel

### 2.1 Create the account

1. Go to <https://vercel.com> → **Sign Up** → **Continue with GitHub**.

### 2.2 Import the project

1. Vercel dashboard → **Add New…** → **Project**.
2. **Import** this repo from the GitHub list (authorize Vercel for it if needed).

### 2.3 Point Vercel at `frontend/` — the critical monorepo step

On the configuration screen, find **Root Directory** and click **Edit** →
select **`frontend`** → **Continue**.

> This cannot be done from `vercel.json` — Vercel has no "root directory" key in
> that file, and the repo root has no `package.json`. If you skip this, the build
> fails immediately with *"No Next.js version detected" / "Couldn't find
> package.json"*. Once set, Vercel reads **`frontend/vercel.json`**.

### 2.4 Confirm build settings

With Root Directory = `frontend`, Vercel auto-detects **Vite** and picks up
`frontend/vercel.json`:

| Setting | Value | Source |
|---|---|---|
| Framework Preset | Vite | auto-detected |
| Install Command | `npm ci` | `vercel.json` |
| Build Command | `npm run build` | `vercel.json` (runs `tsc -b && vite build`) |
| Output Directory | `dist` | `vercel.json` |

The `rewrites` rule in `vercel.json` sends every path to `index.html` so
client-side routes (`/groups/:id`, `/invitations`, …) survive a refresh or a
direct visit.

### 2.5 Set the API URL

Still on the import screen, expand **Environment Variables** and add:

| Name | Value | Environments |
|---|---|---|
| `VITE_API_BASE_URL` | the Render URL from **1.5**, e.g. `https://expense-splitting-api.onrender.com` — **no trailing slash, no `/api`** | Production (also Preview if you want PR previews to use it) |

### 2.6 Deploy and record the URL

1. Click **Deploy**. Wait for the build.
2. Vercel shows the production URL, e.g. `https://expense-splitting-api.vercel.app`.
   **Copy it** — Part 3 needs it.
3. The app loads, but **login/register will fail with a CORS error until Part 3**
   — that's expected.

> `VITE_API_BASE_URL` is inlined at **build time**. If you ever change it, you
> must redeploy (Vercel → Deployments → ⋯ → **Redeploy**, or push a commit) — an
> env-var edit alone does nothing to an already-built site.

---

## Part 3 — Let the backend accept the frontend (CORS)

1. **Render** dashboard → `expense-splitting-api` → **Environment**.
2. Edit **`CORS_ALLOW_ORIGINS`** and set it to the Vercel production URL from
   **2.6**:

   ```
   https://expense-splitting-api.vercel.app
   ```

   - Exact origin: scheme + host, **no trailing slash, no path**.
   - Multiple origins are comma-separated, e.g. add a custom domain:
     `https://app.example.com,https://expense-splitting-api.vercel.app`
   - Wildcards are not supported. Vercel preview URLs change per deploy, so
     either list the ones you need or accept that only production is allowed.
3. **Save Changes** → Render redeploys automatically (~2–4 min).
4. Verify end to end:
   - Open the Vercel URL, register a user, log in.
   - DevTools → **Network** → an `/api/...` request → **Response Headers**
     should include `access-control-allow-origin: https://<your-vercel-url>`.
   - No CORS error in the Console.

Done. From here, pushing to `main` redeploys both apps automatically.

---

## Routine updates

| Change | What to do |
|---|---|
| Backend code / new migration | Push to `main`. Render rebuilds; `alembic upgrade head` runs before uvicorn. |
| Frontend code | Push to `main`. Vercel rebuilds. |
| New allowed frontend origin | Edit `CORS_ALLOW_ORIGINS` in Render → save (triggers redeploy). |
| Rotate `JWT_SECRET` | Set the new value in Render → redeploy. All existing tokens become invalid (users log in again). |
| Change backend URL | Update `VITE_API_BASE_URL` in Vercel **and redeploy the frontend**. |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Render build: `Can't load plugin: sqlalchemy.dialects:postgres` | `postgres://` scheme not normalized | Already handled in `app/database.py`; make sure you deployed a commit that includes it. |
| Render deploy fails during `alembic upgrade head` | migration error, or a missing/malformed `DATABASE_URL` | Read the log line; check the web service's **Environment** has `DATABASE_URL` set to the full Neon string, `?sslmode=require` included. |
| `alembic`/startup error: `connection ... SSL required` or timeout to `*.neon.tech` | `?sslmode=require` dropped from `DATABASE_URL`, or wrong Neon host/branch | Re-copy the string from the Neon console verbatim into Render. |
| First request after idle hangs ~50s | free-tier cold start (Render web service, and/or Neon auto-suspend) | Expected. Upgrade the web service to a paid instance to keep it warm. |
| Frontend loads but every API call is a CORS error | `CORS_ALLOW_ORIGINS` unset, wrong, or has a trailing slash | Set it to the exact Vercel origin in Render; save; wait for redeploy. |
| API calls go to `https://<vercel-url>/api/...` (404s on Vercel) | `VITE_API_BASE_URL` not set at build time | Set it in Vercel → **redeploy** (not just save). |
| API calls hit `https://api.onrender.com/api/api/...` | trailing `/api` left on `VITE_API_BASE_URL` | Value must be origin only. |
| `500` on login/register, Render log shows JWT error | `JWT_SECRET` unset | Set it in Render → redeploy. |
| Vercel build: "Couldn't find package.json" | Root Directory not set to `frontend` | Project → **Settings → General → Root Directory** → `frontend` → redeploy. |
