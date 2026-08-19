const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { startScheduler, stopScheduler } = require('./scheduler');
const { db } = require('./storage/db');
const statusRouter = require('./routes/status');
const listingsRouter = require('./routes/listings');
const apiRouter = require('./routes/api');

// Initialize environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Liveness check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root index route serving the dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Register routers
app.use(statusRouter);
app.use(listingsRouter);
app.use(apiRouter);

// Start server
const server = app.listen(PORT, () => {
  console.log(`[Server] Service running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  
  // Start the background cron scheduler
  startScheduler();
});

// Graceful process shutdown handler
function handleShutdown(signal) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  
  // Stop scheduler
  stopScheduler();
  
  // Close HTTP server
  server.close(() => {
    console.log('[Server] HTTP server closed.');
    
    // Close SQLite database
    try {
      db.close();
      console.log('[Server] SQLite database connection closed.');
    } catch (err) {
      console.error('[Server] Error closing database connection:', err);
    }
    
    process.exit(0);
  });

  // Force shutdown if connections do not close in 5 seconds
  setTimeout(() => {
    console.error('[Server] Force shutdown triggered.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = app; // Export for testing
