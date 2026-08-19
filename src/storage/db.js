const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Ensure DB_PATH directory exists
const dbPath = process.env.DB_PATH || 'data/jobs.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(dbPath);

// Enable WAL mode for performance
db.pragma('journal_mode = WAL');

// Initialize schema (with support for descriptions and run sources)
db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    url TEXT NOT NULL,
    tags TEXT, -- JSON stringified array
    location TEXT,
    posted_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    description TEXT,
    UNIQUE(external_id, source)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    fetched_count INTEGER NOT NULL,
    stored_count INTEGER NOT NULL,
    rejected_count INTEGER NOT NULL,
    errored_count INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'success' or 'failed'
    error_message TEXT,
    source TEXT,
    http_status INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_listings_source_ext ON listings(source, external_id);
  CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp DESC);
`);

// Dynamic column migrations for existing databases
try {
  db.exec("ALTER TABLE listings ADD COLUMN description TEXT;");
} catch (e) {
  // Column already exists, safe to ignore
}
try {
  db.exec("ALTER TABLE runs ADD COLUMN source TEXT;");
} catch (e) {
  // Column already exists, safe to ignore
}
try {
  db.exec("ALTER TABLE runs ADD COLUMN http_status INTEGER;");
} catch (e) {
  // Column already exists, safe to ignore
}

/**
 * Upsert a job listing. Deduplicates on (external_id, source).
 * Returns true if inserted or updated, false on database failure.
 */
function upsertListing(listing) {
  const stmt = db.prepare(`
    INSERT INTO listings (external_id, source, title, company, url, tags, location, posted_at, fetched_at, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id, source) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      url = excluded.url,
      tags = excluded.tags,
      location = excluded.location,
      posted_at = excluded.posted_at,
      fetched_at = excluded.fetched_at,
      description = excluded.description
  `);

  try {
    const tagsJson = Array.isArray(listing.tags) ? JSON.stringify(listing.tags) : '[]';
    stmt.run(
      listing.externalId,
      listing.source,
      listing.title,
      listing.company,
      listing.url,
      tagsJson,
      listing.location || '',
      listing.postedAt,
      listing.fetchedAt,
      listing.description || ''
    );
    return true;
  } catch (error) {
    console.error(`DB error upserting listing ${listing.externalId}:`, error);
    return false;
  }
}

/**
 * Logs a scraper run.
 */
function insertRun(run) {
  const stmt = db.prepare(`
    INSERT INTO runs (timestamp, fetched_count, stored_count, rejected_count, errored_count, duration_ms, status, error_message, source, http_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    stmt.run(
      run.timestamp || new Date().toISOString(),
      run.fetchedCount || 0,
      run.storedCount || 0,
      run.rejectedCount || 0,
      run.erroredCount || 0,
      run.durationMs || 0,
      run.status || 'success',
      run.errorMessage || null,
      run.source || 'remoteok',
      run.httpStatus !== undefined ? run.httpStatus : (run.status === 'success' ? 200 : 500)
    );
    return true;
  } catch (error) {
    console.error('DB error inserting run record:', error);
    return false;
  }
}

/**
 * Fetch paginated listings.
 */
function getListings(limit = 20, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM listings 
    ORDER BY posted_at DESC 
    LIMIT ? OFFSET ?
  `);
  
  try {
    const rows = stmt.all(limit, offset);
    return rows.map(row => ({
      id: row.id,
      externalId: row.external_id,
      source: row.source,
      title: row.title,
      company: row.company,
      url: row.url,
      tags: row.tags ? JSON.parse(row.tags) : [],
      location: row.location,
      postedAt: row.posted_at,
      fetchedAt: row.fetched_at,
      description: row.description || ''
    }));
  } catch (error) {
    console.error('DB error fetching listings:', error);
    return [];
  }
}

/**
 * Fetch status of runs. Returns last run summary + last 10 runs.
 */
function getRuns(sourceFilter = null) {
  try {
    let lastRun, history;
    if (sourceFilter) {
      const lastRunStmt = db.prepare('SELECT * FROM runs WHERE source = ? ORDER BY timestamp DESC LIMIT 1');
      lastRun = lastRunStmt.get(sourceFilter);

      const historyStmt = db.prepare('SELECT * FROM runs WHERE source = ? ORDER BY timestamp DESC LIMIT 10');
      history = historyStmt.all(sourceFilter);
    } else {
      const lastRunStmt = db.prepare('SELECT * FROM runs ORDER BY timestamp DESC LIMIT 1');
      lastRun = lastRunStmt.get();

      const historyStmt = db.prepare('SELECT * FROM runs ORDER BY timestamp DESC LIMIT 10');
      history = historyStmt.all();
    }

    return {
      lastRun: lastRun ? normalizeRunRow(lastRun) : null,
      history: history.map(normalizeRunRow)
    };
  } catch (error) {
    console.error('DB error fetching runs status:', error);
    return { lastRun: null, history: [] };
  }
}

/**
 * Computes health statistics for a given scraper source.
 */
function getSourceHealth(sourceName) {
  try {
    const lastSuccessStmt = db.prepare("SELECT timestamp FROM runs WHERE source = ? AND status = 'success' ORDER BY timestamp DESC LIMIT 1");
    const lastSuccess = lastSuccessStmt.get(sourceName)?.timestamp || null;

    const lastFailureStmt = db.prepare("SELECT timestamp FROM runs WHERE source = ? AND status = 'failed' ORDER BY timestamp DESC LIMIT 1");
    const lastFailure = lastFailureStmt.get(sourceName)?.timestamp || null;

    const lastRunStmt = db.prepare("SELECT http_status, error_message FROM runs WHERE source = ? ORDER BY timestamp DESC LIMIT 1");
    const lastRun = lastRunStmt.get(sourceName);
    const lastHttpStatus = lastRun ? (lastRun.http_status || (lastRun.error_message ? 500 : 200)) : null;

    // Calculate consecutive errors
    const recentRunsStmt = db.prepare("SELECT status FROM runs WHERE source = ? ORDER BY timestamp DESC LIMIT 50");
    const recentRuns = recentRunsStmt.all(sourceName);
    let consecutiveErrors = 0;
    for (const r of recentRuns) {
      if (r.status === 'failed') {
        consecutiveErrors++;
      } else {
        break;
      }
    }

    // Determine status label
    let status = 'healthy';
    if (consecutiveErrors > 0) {
      status = consecutiveErrors >= 3 ? 'offline' : 'degraded';
    } else if (!lastSuccess && !lastFailure) {
      status = 'unknown';
    }

    return {
      source: sourceName,
      status,
      lastSuccess,
      lastFailure,
      consecutiveErrors,
      lastHttpStatus
    };
  } catch (err) {
    console.error(`Error calculating health for source "${sourceName}":`, err);
    return {
      source: sourceName,
      status: 'unknown',
      lastSuccess: null,
      lastFailure: null,
      consecutiveErrors: 0,
      lastHttpStatus: null
    };
  }
}

function normalizeRunRow(row) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    fetchedCount: row.fetched_count,
    storedCount: row.stored_count,
    rejectedCount: row.rejected_count,
    erroredCount: row.errored_count,
    durationMs: row.duration_ms,
    status: row.status,
    errorMessage: row.error_message,
    source: row.source || 'remoteok',
    httpStatus: row.http_status !== null && row.http_status !== undefined ? row.http_status : (row.status === 'success' ? 200 : 500)
  };
}

module.exports = {
  db,
  upsertListing,
  insertRun,
  getListings,
  getRuns,
  getSourceHealth
};
