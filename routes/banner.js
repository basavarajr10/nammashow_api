const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');

// Public route - Get all active banners
router.get('/banners', bannerController.getBanners);

module.exports = router;