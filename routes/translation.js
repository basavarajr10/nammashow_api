const express = require('express');
const router = express.Router();
const translationController = require('../controllers/translationController');

// Public route - Get all translations for a language
router.get('/translations', translationController.getTranslations);

module.exports = router;