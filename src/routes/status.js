const express = require('express');
const router = express.Router();
const db = require('../storage/db');

/**
 * @route   GET /status
 * @desc    Retrieves the status of the last ingestion run and the last 10 execution summaries.
 * @access  Public
 */
router.get('/status', (req, res) => {
  try {
    const statusData = db.getRuns();
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...statusData
    });
  } catch (error) {
    console.error('Error handling /status route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching status logs'
    });
  }
});

module.exports = router;
