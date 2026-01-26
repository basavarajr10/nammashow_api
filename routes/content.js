const express = require('express');
const router = express.Router();
const contentController = require('../controllers/contentController');

router.get('/languages', contentController.getLanguages);
router.post('/details', contentController.getContentBySlug);
router.get('/content', contentController.getAllContent);

module.exports = router;