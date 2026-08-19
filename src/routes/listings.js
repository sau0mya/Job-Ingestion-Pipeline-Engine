const express = require('express');
const router = express.Router();
const db = require('../storage/db');

/**
 * @route   GET /listings
 * @desc    Fetch paginated job listings currently in database, ordered by date.
 * @access  Public
 */
router.get('/listings', (req, res) => {
  try {
    let limit = parseInt(req.query.limit, 10);
    let offset = parseInt(req.query.offset, 10);

    // Fallbacks and sanitation
    if (isNaN(limit) || limit <= 0) {
      limit = 20;
    }
    if (isNaN(offset) || offset < 0) {
      offset = 0;
    }

    // Safety ceiling: prevent extremely large payloads
    if (limit > 100) {
      limit = 100;
    }

    const data = db.getListings(limit, offset);

    res.json({
      success: true,
      count: data.length,
      limit,
      offset,
      listings: data
    });
  } catch (error) {
    console.error('Error handling /listings route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching job listings'
    });
  }
});

module.exports = router;
