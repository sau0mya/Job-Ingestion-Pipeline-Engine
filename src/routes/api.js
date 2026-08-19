const express = require('express');
const router = express.Router();
const db = require('../storage/db');
const runner = require('../scraper/runner');

/**
 * @route   GET /api/health-stats
 * @desc    Get current health metrics for ingestion sources
 */
router.get('/api/health-stats', (req, res) => {
  try {
    const remoteokHealth = db.getSourceHealth('remoteok');
    const sandboxHealth = db.getSourceHealth('sandbox');
    
    res.json({
      success: true,
      sources: {
        remoteok: remoteokHealth,
        sandbox: sandboxHealth
      }
    });
  } catch (error) {
    console.error('Error fetching source health stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /api/ingest
 * @desc    Manually triggers a live RemoteOK scrape run
 */
router.post('/api/ingest', async (req, res) => {
  try {
    console.log('[API] Manual ingestion trigger requested for source "remoteok".');
    const runResult = await runner.run({ source: 'remoteok' });
    
    res.json({
      success: true,
      result: runResult
    });
  } catch (error) {
    console.error('Error during manual ingestion:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @route   POST /api/simulate
 * @desc    Manually triggers a sandbox simulation run
 */
router.post('/api/simulate', async (req, res) => {
  const { scenario } = req.body;
  
  if (!scenario) {
    return res.status(400).json({ success: false, error: 'Scenario name is required' });
  }

  try {
    console.log(`[API] Manual sandbox simulation requested for scenario: "${scenario}".`);
    const runResult = await runner.simulateScenario(scenario);
    
    res.json({
      success: true,
      result: runResult
    });
  } catch (error) {
    console.error('Error during sandbox simulation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
