# AlpenMesh Economy Monorepo

This repository contains the AlpenMesh economy stack:
- `alpenmesh-economy`: Rust backend service for auth, worker binding, wallet linking, and reward/proof APIs.
- `alpenmesh-economy-dashboard`: Svelte dashboard for user signup/login and economy visibility.

---

## Project Structure

```text
economy/
  alpenmesh-economy/               # Rust API service
    src/
      main.rs                      # App bootstrap and route/controller registration
      state.rs                     # Shared app state + MongoDB client lifecycle
      controllers/
        economy_controller.rs      # Economy API handlers and core business logic
        mod.rs
    app.yaml                       # Host/port/app config
    Cargo.toml                     # Rust dependencies
  alpenmesh-economy-dashboard/     # Svelte + Vite frontend
    src/App.svelte                 # Main UI and API interactions
    src/main.js                    # App entrypoint
    package.json                   # Frontend scripts/deps
```

---

## Core Working Logic

## 1) Backend bootstrap (`alpenmesh-economy`)
- Service starts in `src/main.rs`, loads config from `app.yaml`, initializes tracing, and registers `EconomyController`.
- Shared state (`EconomyState`) is created once and injected into handlers.

## 2) State and database connectivity
- `src/state.rs` reads `MONGODB_URI` (defaults to `mongodb://127.0.0.1:27017`).
- URI is normalized to include:
  - `directConnection=true`
  - `serverSelectionTimeoutMS=3000`
- Mongo client is lazy-initialized and cached (`RwLock<Option<Client>>`) to avoid reconnecting on each request.
- A lightweight in-memory `session_cache` maps `session_token -> user_id` for active sessions.

## 3) API/business flows (`src/controllers/economy_controller.rs`)
- **Auth**
  - `POST /api/v1/economy/auth/signup`: creates `economy_users` record, hashes password (SHA-256), issues session token.
  - `POST /api/v1/economy/auth/login`: validates hash, rotates session token, updates cache.
- **Worker onboarding**
  - `POST /api/v1/economy/workers/register`: local worker registration with secret hash in `worker_registry`.
  - `POST /api/v1/economy/users/{id}/workers`: user claims/connects worker after secret verification.
- **Wallet connections**
  - `POST /api/v1/economy/users/{id}/wallet`: links user-level payout wallet in `wallet_connections`.
  - `POST /api/v1/economy/workers/{id}`: binds payout wallet directly on `worker_accounts`.
- **Economy visibility**
  - `GET /api/v1/economy/dashboard/summary`: aggregates worker totals.
  - `GET /api/v1/economy/users/{id}`: portfolio view (profile + wallet + connected workers + earnings).
  - `GET /api/v1/economy/workers/{id}`: worker earnings snapshot.
  - `GET /api/v1/economy/workers/{id}/proofs`: recent proof batches (latest first, limit 100).

## 4) Frontend flow (`alpenmesh-economy-dashboard`)
- Main UI in `src/App.svelte`.
- User journey:
  1. Sign up or log in
  2. Connect worker (`worker_id` + `worker_secret`)
  3. Connect wallet
  4. View worker stats and recent proofs
- Frontend uses `fetch` JSON wrapper and targets `/api/v1/economy/*`.
- Vite dev server proxies `/api/*` to backend at `http://127.0.0.1:3010`.

---

## MongoDB Collections Used

- `economy_users`: user profile, email, password hash, current session token.
- `worker_registry`: worker registration + secret hash + claim ownership.
- `worker_bindings`: user-to-worker mapping and label.
- `wallet_connections`: user-to-wallet mapping and network.
- `worker_accounts`: earnings totals and worker payout wallet.
- `proof_batches`: inference proof records and chain status lifecycle.

---

## Local Development

## Prerequisites
- Rust toolchain (stable)
- Node.js + npm
- MongoDB running locally (or remote URI)

## Environment
- Backend supports:
  - `MONGODB_URI` (optional; default is local MongoDB)

## Run backend

```bash
cd alpenmesh-economy
cargo run
```

Defaults from `app.yaml`:
- host: `127.0.0.1`
- port: `3010`

## Run dashboard

```bash
cd alpenmesh-economy-dashboard
npm install
npm run dev
```

Default dashboard dev port: `5174`.

---

## Typical End-to-End Flow

1. Register worker locally via backend API (`/workers/register`).
2. User signs up/logs in (`/auth/signup` or `/auth/login`).
3. User connects worker to account (`/users/{id}/workers`).
4. User connects wallet (`/users/{id}/wallet`).
5. Dashboard fetches portfolio and proofs for live economy status.

---

## Notes

- Passwords are hashed with SHA-256 (no salt/pepper currently).
- Session cache is in-memory; restarting backend clears it.
- Most operations are MongoDB-first; API returns service unavailable if DB connection fails.
