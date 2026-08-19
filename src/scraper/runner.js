const remoteok = require('./sources/remoteok');
const db = require('../storage/db');

let activeLogCollector = null;

// Intercept console messages for real-time dashboard terminal streaming
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
  originalLog.apply(console, args);
  if (activeLogCollector) {
    activeLogCollector.push({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: args.join(' ')
    });
  }
};

console.warn = (...args) => {
  originalWarn.apply(console, args);
  if (activeLogCollector) {
    activeLogCollector.push({
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message: args.join(' ')
    });
  }
};

console.error = (...args) => {
  originalError.apply(console, args);
  if (activeLogCollector) {
    activeLogCollector.push({
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: args.join(' ')
    });
  }
};

/**
 * Orchestrates a single ingestion run.
 * Fetches listings, validates and normalizes them, filters duplicates,
 * records the job listings into SQLite, and logs the execution summary.
 * 
 * @param {object} options Options to override fetch and pacing parameters.
 * @returns {Promise<object>} Run summary object.
 */
async function run(options = {}) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const source = options.source || 'remoteok';

  let fetchedCount = 0;
  let storedCount = 0;
  let rejectedCount = 0;
  let erroredCount = 0;
  let httpStatus = 200;

  const runLogs = [];
  activeLogCollector = runLogs;

  try {
    console.log(`Starting Ingestion Run for source '${source}'`);

    // Fetch and parse listings from source
    const parseResult = await remoteok.fetchAndParseListings(options);
    
    const normalizedListings = parseResult.normalized;
    const rejectedListings = parseResult.rejected;

    fetchedCount = normalizedListings.length + rejectedListings.length;
    rejectedCount = rejectedListings.length;

    console.log(`Parsed ${normalizedListings.length} jobs from source '${source}'`);

    // Get count of existing listings to calculate exact duplicates count
    // Fetch recent 1000 listings to look up unique identifiers
    const existingListings = db.getListings(10000, 0);
    const existingKeys = new Set(existingListings.map(l => `${l.externalId}-${l.source}`));

    let duplicateCount = 0;

    // Upsert listings into database
    for (const listing of normalizedListings) {
      try {
        const isDuplicate = existingKeys.has(`${listing.externalId}-${listing.source}`);
        if (isDuplicate) {
          duplicateCount++;
        }
        
        const isSuccess = db.upsertListing(listing);
        if (isSuccess) {
          storedCount++;
        } else {
          erroredCount++;
        }
      } catch (dbErr) {
        console.error(`DB exception during upsert of job external ID ${listing.externalId}: ${dbErr.message}`);
        erroredCount++;
      }
    }

    const durationMs = Date.now() - startTime;
    const newCount = Math.max(0, storedCount - duplicateCount);
    console.log(`Ingestion run completed. Status: SUCCESS. Found: ${fetchedCount}, Valid: ${normalizedListings.length}, New: ${newCount}, Duplicates: ${duplicateCount}`);

    // Record successful run summary
    db.insertRun({
      timestamp,
      fetchedCount,
      storedCount,
      rejectedCount,
      erroredCount,
      durationMs,
      status: 'success',
      source,
      httpStatus: 200
    });

    activeLogCollector = null;

    return {
      status: 'success',
      timestamp,
      fetchedCount,
      storedCount,
      rejectedCount,
      erroredCount,
      durationMs,
      source,
      newCount,
      duplicateCount,
      logs: runLogs
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    httpStatus = error.status || 500;
    
    console.error(`Ingestion run completed. Status: FAILED. Error: ${error.message}`);

    // Log the failed run summary
    try {
      db.insertRun({
        timestamp,
        fetchedCount: 0,
        storedCount: 0,
        rejectedCount: 0,
        erroredCount: 0,
        durationMs,
        status: 'failed',
        errorMessage: error.message,
        source,
        httpStatus
      });
    } catch (dbLogErr) {
      originalError.apply(console, ['[Runner] Failed to write failed run summary to DB:', dbLogErr]);
    }

    activeLogCollector = null;

    return {
      status: 'failed',
      timestamp,
      errorMessage: error.message,
      durationMs,
      source,
      newCount: 0,
      duplicateCount: 0,
      logs: runLogs
    };
  }
}

/**
 * Trigger dynamic sandbox simulation runs based on user dashboard selections.
 */
async function simulateScenario(scenarioName) {
  console.log(`[Runner] Starting Ingestion Run for source 'sandbox'`);
  console.log(`[Runner] Sandbox source scenario set to: '${scenarioName}'`);

  if (scenarioName === 'normal') {
    console.log(`[Runner] Sandbox source fetching raw data under scenario: 'normal'`);
    const mockData = [
      {
        id: `sandbox-normal-${Date.now()}-1`,
        position: 'Staff Product Manager',
        company: 'Vercel Inc.',
        url: 'https://vercel.com/careers/staff-pm',
        date: new Date().toISOString(),
        tags: ['product', 'nextjs'],
        location: 'San Francisco, CA',
        description: '<p>Vercel is looking for a Staff Product Manager to lead Next.js framework product developments.</p>'
      },
      {
        id: `sandbox-normal-${Date.now()}-2`,
        position: 'Senior Developer Relations',
        company: 'Supabase',
        url: 'https://supabase.com/careers/devrel',
        date: new Date().toISOString(),
        tags: ['postgres', 'devrel'],
        location: 'Remote',
        description: '<p>Join Supabase as a Senior DevRel and expand open-source postgres ecosystems globally.</p>'
      },
      {
        id: `sandbox-normal-${Date.now()}-3`,
        position: 'Infrastructure Engineer',
        company: 'Linear App',
        url: 'https://linear.app/careers/infra',
        date: new Date().toISOString(),
        tags: ['rust', 'aws', 'docker'],
        location: 'Remote, Europe',
        description: '<p>Help build the future of software development tracking tools at Linear.</p>'
      }
    ];

    return await run({ mockData, source: 'sandbox' });

  } else if (scenarioName === 'malformed') {
    console.log(`[Runner] Sandbox source fetching raw data under scenario: 'malformed'`);
    // Mixed bag of valid and invalid items
    const mockData = [
      {
        id: `sandbox-malformed-${Date.now()}-1`,
        position: 'Data Engineer',
        company: 'Snowflake',
        url: 'https://snowflake.com/job/data-eng',
        date: new Date().toISOString(),
        description: 'Clean valid job listing.'
      },
      {
        // Malformed item (missing company)
        id: `sandbox-malformed-${Date.now()}-2`,
        position: 'Security Auditor',
        url: 'https://snowflake.com/job/sec',
        date: new Date().toISOString()
      },
      {
        // Malformed item (missing title/position)
        id: `sandbox-malformed-${Date.now()}-3`,
        company: 'Brex',
        url: 'https://brex.com/job/audit',
        date: new Date().toISOString()
      }
    ];

    return await run({ mockData, source: 'sandbox' });

  } else if (scenarioName === 'empty') {
    console.log(`[Runner] Sandbox source fetching raw data under scenario: 'empty'`);
    return await run({ mockData: [], source: 'sandbox' });

  } else if (scenarioName === 'failure') {
    console.log(`[Runner] Sandbox source fetching raw data under scenario: 'failure'`);
    // Simulates an HTTP client error
    return await run({
      mockError: { message: 'HTTP status error 403 Forbidden', status: 403 },
      source: 'sandbox'
    });

  } else {
    throw new Error(`Unknown sandbox scenario: "${scenarioName}"`);
  }
}

module.exports = {
  run,
  simulateScenario
};
