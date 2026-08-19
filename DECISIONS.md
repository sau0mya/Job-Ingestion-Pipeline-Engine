# Scraping Architecture & Design Decisions

### 1. Ingestion Strategy Choice & Rejected Alternatives

**Decision**: A lightweight JSON-API polling service using a raw HTTP client wrapper (`src/scraper/client.js`) configured with header rotation, timeout limits, random pacing (jitter), and exponential backoff.
**Rejected Alternative**: A full headless browser automation framework (e.g., Puppeteer or Playwright) driving a residential proxy pool.

**Rationale**:
- **Resource Constraints**: RemoteOK's API is public and returns well-structured JSON data directly. Launching an entire headless browser (like Chromium) inside a server container would add 150MB+ of memory overhead, double cold-start boot times, and require complex system libraries that complicate hosting on free container tiers like Render.
- **Resilient Separation of Concerns**: We structured the parser (`src/scraper/sources/remoteok.js`) independently of the client. If the target API changes or is placed behind a JavaScript-rendering firewall, the raw client can be swapped for a headless browser client without affecting the database schema, Express routes, or scheduler logic.

---

### 2. Time-Limit Trade-offs & Production Vision

**Trade-offs Made**:
1. **Single Source Ingestion**: We limited scraping to RemoteOK.
2. **Local Storage**: Data is cached in SQLite (`better-sqlite3`) rather than a distributed database (like PostgreSQL).
3. **Authentication/Proxies**: We omitted rotating proxy configurations, relying instead on custom header injection, random delays, and retry backoff.

**What we would build with a full week**:
1. **Proxy Rotation Pool**: Integrate a residential proxy provider (e.g., Scrapeops) to rotate egress IPs on every request.
2. **Multi-Source Crawlers**: Expand the pipeline to scrape additional remote job boards (e.g., WeWorkRemotely RSS, Indeed, LinkedIn) and map their payloads to our unified database schema.
3. **Advanced Deduplication**: Replace the basic unique ID lookup with semantic title and description similarity matching to detect identical positions cross-posted to multiple aggregators.
4. **Outage Circuit Breaker**: Use a circuit breaker library (e.g., `opossum`) to pause target crawls for a cooldown period (e.g., 2 hours) if consecutive rate limits or outages are hit, alerting developers via Slack.

---

### 3. AI Tooling & Verification

**Where AI Tools Were Used**:
- AI drafted the initial boilerplate structure for the Express endpoints, native test assertions, database schemas, and documentation outlines.
- AI helped write the multi-stage `Dockerfile` and clean `.dockerignore` for containerized deployments.

**What Was Personally Verified and Changed**:
- **API Disclaimers & Outliers**: Inspected the live payload of `https://remoteok.com/api` and explicitly filtered out the API Terms of Service (legal) notices that occupy index 0 of the array.
- **Fail-Safety Assertions**: Wrote and executed [test_features.js](file:///C:/Users/saumy/.gemini/antigravity-ide/brain/0ddf5fcc-bd30-4875-bf63-fab5087d4080/scratch/test_features.js) to programmatically hit the running API endpoints. Verified database transitions to `degraded` status after 1 error and `offline` after 3 consecutive failures.
- **Windows SQLite Compatibility**: Patched teardown logic in unit tests to close SQLite database connections cleanly, preventing Windows `EBUSY` file lock exceptions.
- **Clean Git Tracking**: Re-initialized git within the project root folder to resolve a configuration mapping where git was tracking the user's entire home folder. Set up `.gitignore` to prevent tracking of local cache databases or environment credentials.
