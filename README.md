# Scraper Service (Acdyon Technologies Challenge — Part 1)

A resilient job-listing ingestion pipeline built with Node.js, Express, and SQLite (`better-sqlite3`). The pipeline repeatedly pulls listings from the RemoteOK public API, applying pacing and HTTP request evasion tactics (UA rotation, custom headers, exponential backoff) while handling parsing anomalies and schema changes gracefully.

---

## Features

- **Paced Ingestion**: Randomized timing delay (jitter) between scraper sequences to mimic human interactions and avoid bot blocks.
- **Evader Client**: Rotates between 5 distinct modern web browser User-Agents and sets standard request security headers (`Sec-Fetch-*`).
- **Catastrophic Fail-safety**: Ingestion failures are intercepted and written to the database with a `status: 'failed'` flag and error messages—never crashing the daemon.
- **Validator & Normalization**: Individual listing failures (e.g. schema changes, missing attributes) are logged as warnings and skipped, while valid elements in the same request are stored successfully.
- **REST Endpoints**: Simple Express endpoints exposing current caching status, run logs history, and paginated job listing collections.
- **Zero Heavy Dependencies**: Operates on light vanilla code and file-based SQLite database. No external browser processes (Chromium) or external database servers needed.

---

## Project Structure

```
scraper-service/
├── src/
│   ├── server.js               # Express application and lifecycle hooks
│   ├── scheduler.js            # node-cron scheduler (periodic runner trigger)
│   ├── scraper/
│   │   ├── client.js           # Spoofed HTTP client with retry and backoff
│   │   ├── pacing.js           # Random jitter delay logic
│   │   ├── runner.js           # Scraper run manager & stats processor
│   │   └── sources/
│   │       └── remoteok.js     # RemoteOK API fetch and schema parser
│   └── storage/
│       └── db.js               # SQLite database client (better-sqlite3)
├── test/
│   └── runner.test.js          # Pipeline unit and integration tests
├── DESIGN.md                   # Ingestion architecture design document
├── DECISIONS.md                # Trade-offs, rationale, and AI usage logs
├── README.md                   # This instruction guide
├── package.json
└── .env.example
```

---

## Installation & Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (Version >= 18.0.0, verified on v22.16.0)
- npm (Node package manager)

### Setup
1. Clone the repository and navigate to the project directory:
   ```bash
   cd scraper-service
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   ```bash
   copy .env.example .env
   ```
   *(On macOS/Linux, run `cp .env.example .env`)*

4. Customize configuration variables in `.env` if desired (defaults are preconfigured to run immediately out-of-the-box).

---

## Running the Service

### Run in Development
Start the application with:
```bash
npm start
```
Upon launching:
1. The Express server initializes on `http://localhost:3000`.
2. The SQLite database is created in `data/jobs.db`.
3. An **immediate ingestion run is triggered** on startup to crawl RemoteOK API and prime the database.
4. A periodic cron scheduler is registered to trigger subsequent scrapes every 15 minutes.

---

## Verification & API Endpoints

### 1. Web Root Interface
- **Endpoint**: `GET http://localhost:3000/`
- **Description**: Displays a formatted home screen summarizing the service and listing quick links to investigate the database.

### 2. Service Liveness
- **Endpoint**: `GET http://localhost:3000/health`
- **Description**: Returns quick JSON status indicating server health, timestamp, and process uptime.

### 3. Ingestion & Scheduler Status
- **Endpoint**: `GET http://localhost:3000/status`
- **Description**: Returns the execution details of the last scrape cycle along with a rolling log history of the last 10 runs (timestamps, fetched count, stored count, rejected count, duration, success/fail statuses, and error messages).

### 4. Normalized Job Listings
- **Endpoint**: `GET http://localhost:3000/listings`
- **Query Parameters**:
  - `limit` (default: 20, max: 100)
  - `offset` (default: 0)
- **Description**: Returns a paginated JSON response containing normalized listings stored in the database.
- **Example URL**: `http://localhost:3000/listings?limit=10&offset=20`

---

## Testing

### Run Unit & Integration Tests
The project uses Node.js's native test runner. Run tests in isolation:
```bash
npm test
```
Tests assert:
- Randomized pacing boundaries.
- User-Agent header rotation.
- Silently bypassing legal API notices.
- Skip validation alerts for malformed entries.
- Database upserts and duplicate deduplication.
- Handling complete server outages without crashing.

### Run Resilience Simulation
A development utility is embedded in the runner to test pipeline robustness under abnormal API structures. To execute this, you can invoke the simulation function from a script:
```bash
node -e "require('./src/storage/db'); require('./src/scraper/runner').simulateMalformedRun()"
```
This utility exercises:
- Catastrophic schema drift (string body instead of arrays).
- Empty response bodies.
- Mixed data arrays containing valid listings, legal notices, and malformed inputs.
It verifies that all issues are logged correctly as warnings or failures in the database, with no process crashes.

---

## Deployment

The service is configured for deployment on Railway, Render, or Heroku.

### Railway / Render Deployment
1. Connect your GitHub repository to Render/Railway.
2. Select **Node.js** environment.
3. Configure start command: `npm start`.
4. Define Environment Variables:
   - `PORT`: (allocated automatically by the host)
   - `NODE_ENV`: `production`
   - `FETCH_INTERVAL_MINUTES`: `30` (recommended for production deployment to reduce rates)
   - `DB_PATH`: `data/jobs.db`
5. *(For Render free tier)*: Create a **Persistent Disk** mount on Render and point `DB_PATH` inside the mount directory (e.g. `/var/data/jobs.db`) to ensure database records persist across container redeployments.

**Live Demo URL**: `[YOUR_DEPLOYED_URL_HERE]`
*(Replace this placeholder once deployment is completed)*
