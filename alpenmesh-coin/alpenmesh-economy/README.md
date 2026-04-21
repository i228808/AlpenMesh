# alpenmesh-economy

Dedicated economy backend for AlpenMesh.

This service is intentionally separate from `oxide-scheduler` and handles:
- earnings and proof query APIs for dashboards
- wallet binding to worker identities
- marketplace-facing summary endpoints

## Run

```bash
cargo run
```

Service default:
- host: `127.0.0.1`
- port: `3010`

## Required environment

- `MONGODB_URI` (optional, defaults to `mongodb://127.0.0.1:27017`)

## Key endpoints

- `GET /api/v1/economy/dashboard/summary`
- `GET /api/v1/economy/workers/:worker_id/earnings`
- `GET /api/v1/economy/workers/:worker_id/proofs`
- `POST /api/v1/economy/workers/:worker_id/wallet`
