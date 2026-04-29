# AlpenMesh

AlpenMesh is an adaptive traffic signal control system built as a final-year project. It ingests live camera feeds, runs computer-vision inference on edge hardware, and closes a real-time decision loop to optimise traffic flow across a road network. A companion economy layer handles worker registration, on-chain proof anchoring, and reward distribution. An operator control panel ties everything together with authentication, live maps, camera streams, and reporting.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Operator UI (React)                      │
│  Dashboard · Camera Map · SUMO Control · Alerts · Reports       │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / JWT
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼──────┐  ┌───▼────────┐  ┌──▼──────────────┐
      │  Auth Server  │  │ Master API │  │ Reporting Agent  │
      │  (Express)    │  │ (FastAPI)  │  │  (FastAPI)       │
      └───────────────┘  └─────┬──────┘  └──────┬──────────┘
                               │                 │
                         ┌─────▼─────────────────▼──────┐
                         │          MongoDB (rs0)         │
                         │  traffic_metrics · decisions   │
                         │  intersection_state · alerts   │
                         └─────────────┬────────────────┘
                                       │ change streams
                         ┌─────────────▼────────────────┐
                         │             Redis              │
                         │  features · pub/sub · cache    │
                         │  operator overrides            │
                         └──┬──────────────────────┬─────┘
                            │                      │
               ┌────────────▼───┐        ┌────────▼──────────┐
               │ Decision Worker │        │  Outcome Worker    │
               │ MPC / MaxPress. │        │  (feedback ~45 s)  │
               └────────────────┘        └────────────────────┘
                            ▲
                            │ HTTP
               ┌────────────┴───────────┐
               │   Edge Scheduler (Rust) │  ← Solana settlement
               └────────────┬───────────┘
                            │
               ┌────────────▼───────────┐
               │   Edge Worker (Rust)    │
               │  YOLO / ONNX + CUDA     │
               └────────────────────────┘

   ┌────────────────────────────────────────────────────────┐
   │                  Economy Stack                          │
   │  Rust Axum API  ←→  MongoDB  ←→  React Dashboard       │
   │  wallets · proofs · earnings · worker registry          │
   └────────────────────────────────────────────────────────┘
```

---

## Subsystems

### `alpenmesh-agents` — Traffic AI Pipeline

The core real-time pipeline.

| Component | Description |
|-----------|-------------|
| **MasterAgent** | Python service orchestrating the entire decision loop. Runs a priority stack: safety checks → mode selection → MPC or MaxPressure optimisation → Redis publish. |
| **Ingest Worker** | Watches MongoDB change streams, normalises camera features, and writes to Redis. |
| **Decision Worker** | Reads Redis features, runs the agent stack, and publishes signal decisions. |
| **Outcome Worker** | Evaluates decisions ~45 s later to close the feedback loop for online learning. |
| **Corridor Planner** | MAXBAND / Webster coordination across intersections. |
| **Master API** | FastAPI REST surface for operator commands, SUMO integration, metrics, and incident reporting. |
| **ReportingAgent** | Separate FastAPI service storing accidents, congestion events, and alerts in MongoDB (GridFS for attachments). Webhooks back to MasterAgent. |
| **EdgeAgent / Edge Worker** | Rust service running YOLO/ONNX inference on GPU, writing `traffic_metrics` to MongoDB. Multi-stage CUDA+cuDNN Docker build with TensorRT support. |
| **EdgeAgent / Edge Scheduler** | Rust service distributing work to edge workers, reading from MongoDB, and anchoring proofs on-chain via Solana. |

**Simulation path:** SUMO can be substituted for live cameras. `sumo_runner.py` feeds the same decision machinery via the `/decision` HTTP endpoint.

---

### `alpenmesh-operator-control` — Operator Control Panel

| Component | Description |
|-----------|-------------|
| **React Client** | Dashboard, camera map (Leaflet), live HLS streams, alerts, SUMO control, and reporting-agent log viewer. |
| **Express Auth Server** | JWT-based register/login API backed by MongoDB (Mongoose). |

---

### `alpenmesh-coin` — Economy Layer

| Component | Description |
|-----------|-------------|
| **Rust Axum API** | Worker registration, wallet binding, proof submission, earnings queries. Runs on port `3010`. |
| **React Dashboard** | Economy visibility: wallet balances, proof history, earnings charts. |

---

## Technology Stack

### Languages

| Language | Used For |
|----------|----------|
| **Python 3.11** | MasterAgent, ReportingAgent, SUMO integration, workers |
| **Rust** | Edge Worker (CV inference), Edge Scheduler, Economy API |
| **TypeScript / JavaScript** | Operator client (React), Auth server (Express), Economy frontend (React) |

### Frameworks & Libraries

#### Python
| Library | Purpose |
|---------|---------|
| FastAPI + Uvicorn | REST APIs (MasterAgent, ReportingAgent) |
| PyMongo | MongoDB driver |
| Redis (redis-py) | Feature store, pub/sub, override cache |
| NumPy | Numerical computation |
| cvxpy | Convex optimisation (MPC controller) |
| PuLP | Linear programming (MaxPressure) |
| prometheus-client | Metrics endpoint |
| structlog | Structured logging |
| PyYAML | Configuration |
| traci / sumolib | SUMO simulation integration (sim extras) |
| pytest + hypothesis | Testing |

#### Rust
| Crate | Purpose |
|-------|---------|
| axum | HTTP server (Edge Worker, Scheduler, Economy API) |
| tokio | Async runtime |
| ort (ONNX Runtime) | YOLO model inference |
| ndarray | Tensor manipulation |
| nvml-wrapper | GPU telemetry |
| rayon | CPU parallelism |
| mongodb | MongoDB async driver |
| reqwest | HTTP client |
| serde | Serialisation |
| solana-client / solana-sdk | On-chain proof anchoring / settlement |
| sha2 + uuid | Hashing and ID generation |
| tracing | Structured logging |
| oxide-framework-core | Internal application framework (shared across Rust crates) |
| image + jpeg / resize | Image pre-processing |
| clap | CLI argument parsing |

#### JavaScript / TypeScript
| Package | Purpose |
|---------|---------|
| React 19 / 18 | Operator UI + Economy dashboard |
| Vite 7 / 8 | Build tooling |
| Tailwind CSS 4 / 3 | Styling |
| React Router 7 | Client-side routing |
| Leaflet + react-leaflet | Interactive camera / intersection map |
| hls.js | Live HLS camera stream playback |
| recharts + reaviz | Charts and data visualisation |
| framer-motion | UI animations |
| axios | HTTP client |
| jwt-decode | JWT parsing in browser |
| lucide-react | Icon library |
| react-hot-toast | Notifications |
| Express 5 | Auth API server |
| Mongoose | MongoDB ODM (auth server) |
| bcryptjs + jsonwebtoken | Password hashing + JWT signing |
| Jest + Testing Library | Unit and integration tests |
| ESLint 9 + Prettier | Linting and formatting |
| pnpm | Package manager (client apps) |

### Infrastructure & Data

| Technology | Role |
|------------|------|
| **MongoDB** (replica set `rs0`) | Primary data store — `traffic_metrics`, `master_decisions`, `intersection_state`, `alerts`, `experience`, economy collections; change streams for real-time ingest |
| **Redis 7** | Low-latency feature store, pub/sub bus between workers, operator override keys |
| **NVIDIA CUDA 12.6 + cuDNN** | GPU inference on Edge Worker |
| **TensorRT + ONNX Runtime** | Accelerated YOLO model execution on edge hardware |
| **SUMO** (Simulation of Urban MObility) | Traffic simulation for offline development and testing |
| **Solana** | Blockchain settlement layer for edge worker proofs and rewards |
| **Docker + Docker Compose** | Container orchestration for local and production deployments |
| **Prometheus** | Metrics scraping from MasterAgent API |

### Observability

- **structlog** (Python) and **tracing** (Rust) for structured, levelled logging.
- **Prometheus** metrics exposed on the Master API for scraping.

---

## Repository Layout

```
AlpenMesh/
├── alpenmesh-agents/
│   ├── MasterAgent/          # Python decision engine + REST API
│   │   ├── SYSTEM_OVERVIEW.md
│   │   ├── requirements.txt
│   │   ├── requirements-sim.txt
│   │   └── services/
│   ├── ReportingAgent/       # FastAPI accident/congestion store
│   ├── EdgeAgent/
│   │   ├── alpenmesh-edge-worker/    # Rust CV inference service
│   │   └── alpenmesh-edge-scheduler/ # Rust work dispatcher + Solana
│   └── docker-compose.yml    # Full agent stack (Redis, Mongo, services)
├── alpenmesh-operator-control/
│   ├── client/               # React + Vite operator dashboard
│   └── server/               # Express JWT auth API
└── alpenmesh-coin/
    ├── alpenmesh-economy/             # Rust Axum economy API
    └── alpenmesh-economy-frontend/    # React economy dashboard
```

---

## Getting Started

### Prerequisites

- Docker + Docker Compose
- Node.js ≥ 20 and pnpm
- Rust toolchain (stable)
- Python 3.11
- NVIDIA GPU + CUDA 12.6 drivers (for Edge Worker)

### Agent stack (Docker)

```bash
cd alpenmesh-agents
docker compose up --build
```

This starts: Redis 7, MongoDB replica set, MasterAgent API, Decision Worker, Ingest Worker, Outcome Worker, Corridor Planner, and ReportingAgent.

### Operator control (local dev)

```bash
# Auth server
cd alpenmesh-operator-control/server
npm install
npm run dev

# React client
cd alpenmesh-operator-control/client
pnpm install
pnpm dev
```

### Economy stack (local dev)

```bash
# Rust API
cd alpenmesh-coin/alpenmesh-economy
cargo run

# React dashboard
cd alpenmesh-coin/alpenmesh-economy-frontend
pnpm install
pnpm dev
```

### Edge Worker (requires GPU)

```bash
cd alpenmesh-agents/EdgeAgent/alpenmesh-edge-worker
docker build -t alpenmesh-edge-worker .
docker run --gpus all alpenmesh-edge-worker
```

---

## Key Design Decisions

- **Polyglot architecture** — Python for research-heavy control (MPC, SUMO), Rust for low-latency edge inference and API performance, Node.js as a lightweight auth BFF, React for operator-facing UIs.
- **Event-driven pipeline** — MongoDB change streams trigger the ingest worker; Redis pub/sub decouples workers from each other; operator overrides are the highest-priority keys in Redis.
- **Feedback loop** — The outcome worker re-evaluates decisions ~45 seconds after they are applied, enabling online adaptation.
- **Simulation parity** — SUMO shares the exact same decision machinery as the live path, allowing algorithms to be validated offline before deployment.
- **On-chain settlement** — The edge scheduler uses Solana to anchor worker proofs, enabling trustless reward distribution.
