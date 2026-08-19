# Scraping Architecture Decisions

### 1. Ingestion Strategy Choice & Rejected Alternatives

**Decision**: A lightweight JSON-API polling service using a raw HTTP client wrapper with headers rotation, timeout limits, and exponential backoff.
**Rejected Alternative**: A full-blown headless browser automation framework (such as Puppeteer or Playwright) backed by a residential proxy pool.

**Rationale**:
- **Scope Alignment**: RemoteOK's API is public, scrape-friendly, and returns plain structured JSON. Reaching for a headless browser would add massive memory overhead, double cold-start boot times, and pull in heavy system dependencies (Chromium binaries) that complicate deployments on free hosting tiers (Render/Railway).
- **Anti-Pattern Prevention**: Over-engineering is a key risk. We show architectural understanding of anti-detection techniques (headers rotation, pacing jitter, exponential backoff) directly in node scripts, without wrapping it in slow browser abstractions. However, we structured the source parser (`src/scraper/sources/remoteok.js`) independently, so that if RemoteOK suddenly migrated behind a JS-rendered wall, the client could be swapped for a stealth browser without modifying the database or route modules.

---

### 2. Time-Limit Trade-offs & Production Vision

**Trade-off Made**:
Under the time constraints, we omitted a live proxy rotation layer and real-time slack alerting, and we only implemented a single source crawler.

**What we'd build with a full week**:
1. **Proxy Rotation Integration**: Incorporate an upstream proxy pool (e.g. Scrapeops or Crawlera) into `client.js` to rotate egress IPs on every request.
2. **Multi-Source Pipeline**: Add second and third scrapers (e.g. RSS feeds from WeWorkRemotely, index pages of remote companies) and normalize them into our database schema.
3. **Full Circuit Breaker & Monitoring**: Build a stateful circuit breaker (e.g. using `opossum` library) that detects target outages or active IP blocks, pauses requests automatically, and notifies developers via Slack Webhooks.
4. **Data Deduplication Enrichment**: Implement semantic deduplication (checking similarity of title + description) in addition to exact `externalId` checks to filter out identical jobs posted across multiple aggregators.

---

### 3. AI Tooling & Human Verification

> [!IMPORTANT]
> **[Reviewer Action Required]**: Review and adjust the statements below to align with your exact experience during the submission.

**Where AI Tools Were Used**:
- AI was used to draft the initial boilerplate of the Express server routes, package.json structure, and the SQLite table creation script.
- AI was used to draft the markdown templates for `DESIGN.md` and `README.md`.

**What Was Personally Verified and Rewritten**:
- **RemoteOK Schema Analysis**: Verified the actual live response shape of `https://remoteok.com/api` (discovered the legal disclaimer object returned as the first element in the array and filtered it out explicitly).
- **Graceful Error Recovery testing**: Personally ran and inspected the logs of the malformed simulator (`runner.simulateMalformedRun()`) to confirm that database upserts, skips, and failures write clean JSON logs and do not leak exceptions.
- **Windows System Verification**: Refactored the test sandbox setup to ensure SQLite database handles close cleanly during teardown to avoid Windows EBUSY file-locking errors.
