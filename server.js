const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const config = require('./config/config');
const db = require('./config/db');

// Initialize Express App
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging middleware
// app.use((req, res, next) => {
//   console.log(`${req.method} ${req.path}`);
//   next();
// });

// Health Check Route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'NammaShow API is running',
    version: '1.0.0',
    timestamp: new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  });
});

// API Routes
const authRoutes = require('./routes/auth');
app.use(`${config.apiPrefix}/auth`, authRoutes);
const contentRoutes = require('./routes/content');
app.use(`${config.apiPrefix}/content`, contentRoutes);
const translationRoutes = require('./routes/translation');
app.use(`${config.apiPrefix}/translation`, translationRoutes);
const bannerRoutes = require('./routes/banner');
app.use(`${config.apiPrefix}/banner`, bannerRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
});

// Start Server
const startServer = async () => {
  try {
    // Test database connection
    await db.testConnection();
    
    // Start listening
    app.listen(config.port, () => {
      console.log('🎬 NammaShow API Server Started');
      console.log(`Port: ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;