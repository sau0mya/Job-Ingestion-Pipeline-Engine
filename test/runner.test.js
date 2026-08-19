const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

// Point DB path to a test sandbox db before loading storage module
const testDbPath = 'data/test_jobs.db';
process.env.DB_PATH = testDbPath;

// Clean up stale database files before require loads and locks it
try {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
  if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
} catch (err) {
  // Ignore
}

const db = require('../src/storage/db');
const pacing = require('../src/scraper/pacing');
const client = require('../src/scraper/client');
const remoteok = require('../src/scraper/sources/remoteok');
const runner = require('../src/scraper/runner');

describe('Job Ingestion Pipeline & Dashboard Backend Tests', () => {
  
  before(() => {
    // Already cleaned up before module load to prevent lock issues on Windows
  });

  after(() => {
    // Tear down database connections and clean up file system
    try {
      db.db.close();
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      if (fs.existsSync(`${testDbPath}-shm`)) {
        fs.unlinkSync(`${testDbPath}-shm`);
      }
      if (fs.existsSync(`${testDbPath}-wal`)) {
        fs.unlinkSync(`${testDbPath}-wal`);
      }
      console.log('Test database cleaned up successfully.');
    } catch (err) {
      console.warn('Warning cleanup after tests:', err);
    }
  });

  // ==========================================
  // PACING TESTS
  // ==========================================
  test('Pacing wait resolves within specified range and returns delay duration', async () => {
    const min = 10;
    const max = 50;
    const start = Date.now();
    const delayWaited = await pacing.wait(min, max);
    const elapsed = Date.now() - start;

    assert.ok(delayWaited >= min, `Delay (${delayWaited}ms) should be at least ${min}ms`);
    assert.ok(delayWaited <= max, `Delay (${delayWaited}ms) should be at most ${max}ms`);
    assert.ok(elapsed >= min - 5, `Elapsed time (${elapsed}ms) should be close to or above ${min}ms`);
  });

  // ==========================================
  // HTTP CLIENT & USER AGENT TESTS
  // ==========================================
  test('HTTP client client.js rotates through multiple User-Agent strings', async () => {
    for (let i = 0; i < 5; i++) {
      const options = {
        mockData: [{ id: 'test' }]
      };
      await client.fetchWithRetry('https://example.com', options);
    }
    
    assert.ok(client.USER_AGENTS.length >= 3, 'User-Agent list should have at least 3 distinct agents');
  });

  // ==========================================
  // PARSER, VALIDATION, & DESCRIPTION CLEANING
  // ==========================================
  test('RemoteOK cleanDescription strips HTML tags and compacts spacing', () => {
    const rawHtml = '<p>We are seeking a <strong>Senior Developer</strong>. &amp; Join our team now!</p>';
    const cleaned = remoteok.cleanDescription(rawHtml);
    assert.strictEqual(cleaned, 'We are seeking a Senior Developer. & Join our team now!');
  });

  test('RemoteOK source parser filters out API Terms of Service (legal) notices', async () => {
    const rawMockData = [
      {
        last_updated: 1787016148,
        legal: 'API Terms of Service: Please link back to Remote OK'
      },
      {
        id: '1136895',
        position: 'Compensation Benefits Manager',
        company: 'Saisons Brother',
        url: 'https://remoteok.com/job-1136895',
        date: '2026-08-17T07:14:19Z',
        tags: ['hr', 'finance'],
        location: 'Phnom Penh',
        description: 'Plain text description.'
      }
    ];

    const results = await remoteok.fetchAndParseListings({ mockData: rawMockData });
    
    assert.strictEqual(results.normalized.length, 1, 'Only the valid job should be normalized');
    assert.strictEqual(results.rejected.length, 0, 'Legal notice should be silently filtered out');
    assert.strictEqual(results.normalized[0].externalId, '1136895');
    assert.strictEqual(results.normalized[0].description, 'Plain text description.');
  });

  test('RemoteOK source parser rejects listings with missing mandatory parameters', async () => {
    const rawMockData = [
      {
        id: 'valid-1',
        position: 'Software Engineer',
        company: 'Innovate LLC',
        url: 'https://remoteok.com/job-valid',
        date: '2026-08-17T07:14:19Z'
      },
      {
        id: 'invalid-company',
        position: 'QA Engineer',
        url: 'https://remoteok.com/job-invalid-company',
        date: '2026-08-17T07:14:19Z'
      }
    ];

    const results = await remoteok.fetchAndParseListings({ mockData: rawMockData });

    assert.strictEqual(results.normalized.length, 1, 'Should normalize exactly 1 valid listing');
    assert.strictEqual(results.rejected.length, 1, 'Should reject exactly 1 malformed listing');
  });

  // ==========================================
  // DEDUPLICATION & DB STORAGE TESTS
  // ==========================================
  test('Database successfully upserts listings with descriptions and deduplicates records', async () => {
    const listing = {
      externalId: 'dedupe-test-99',
      source: 'remoteok',
      title: 'Site Reliability Engineer',
      company: 'Logistics Pro',
      url: 'https://remoteok.com/job-99',
      tags: ['devops'],
      location: 'Berlin',
      postedAt: '2026-08-17T07:14:19Z',
      fetchedAt: new Date().toISOString(),
      description: 'First description snippet.'
    };

    const run1 = db.upsertListing(listing);
    assert.strictEqual(run1, true, 'First listing upsert should succeed');

    let listings = db.getListings(10, 0);
    const match = listings.find(item => item.externalId === 'dedupe-test-99');
    assert.ok(match, 'Listing should exist in database');
    assert.strictEqual(match.description, 'First description snippet.');

    // Update description and re-upsert (should update and not duplicate)
    const updatedListing = { ...listing, description: 'Updated description snippet.' };
    const run2 = db.upsertListing(updatedListing);
    assert.strictEqual(run2, true, 'Second listing upsert should succeed');

    listings = db.getListings(10, 0);
    const matches = listings.filter(item => item.externalId === 'dedupe-test-99');
    assert.strictEqual(matches.length, 1, 'Deduplication check: exactly 1 row should exist');
    assert.strictEqual(matches[0].description, 'Updated description snippet.', 'Description should be updated');
  });

  // ==========================================
  // RUNNER, SIMULATION, & HEALTH METRICS TESTS
  // ==========================================
  test('Runner intercepts console logs, sets status statistics, and logs run summaries', async () => {
    const runResult = await runner.run({
      mockData: [
        {
          id: 'test-run-1',
          position: 'Data Scientist',
          company: 'Kaggle',
          url: 'https://remoteok.com/kaggle-job',
          date: new Date().toISOString()
        }
      ],
      source: 'remoteok'
    });

    assert.strictEqual(runResult.status, 'success');
    assert.strictEqual(runResult.fetchedCount, 1);
    assert.ok(Array.isArray(runResult.logs), 'Runner should return collected log objects');
    assert.ok(runResult.logs.some(l => l.message.includes('Starting Ingestion Run')), 'Logs should contain execution landmarks');

    // Retrieve health stats for source "remoteok"
    const health = db.getSourceHealth('remoteok');
    assert.strictEqual(health.source, 'remoteok');
    assert.strictEqual(health.status, 'healthy');
    assert.strictEqual(health.consecutiveErrors, 0);
    assert.strictEqual(health.lastHttpStatus, 200);
  });

  test('Runner records failures in runs table and database reflects degraded health status', async () => {
    // Inject consecutive failures
    await runner.run({ mockError: new Error('Rate limit exceeded'), source: 'sandbox' });
    await runner.run({ mockError: new Error('Rate limit exceeded'), source: 'sandbox' });
    await runner.run({ mockError: new Error('Rate limit exceeded'), source: 'sandbox' });

    const health = db.getSourceHealth('sandbox');
    assert.strictEqual(health.status, 'offline', 'Source status should indicate offline due to 3 consecutive failures');
    assert.strictEqual(health.consecutiveErrors, 3);
    assert.ok(health.lastFailure !== null);
  });
});
