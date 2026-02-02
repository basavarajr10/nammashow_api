const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');

// Public routes (no authentication required)
router.get('/events', eventController.getEvents);
router.get('/events/:event_id', eventController.getEventDetails);
router.get('/events/filters/types', eventController.getEventTypes);
router.get('/events/filters/cities', eventController.getCities);

router.get('/events/:id/related', eventController.getRelatedEvents);

module.exports = router;
