const express = require('express');
const router = express.Router();
const eventBookingController = require('../controllers/eventBookingController');
const authMiddleware = require('../middleware/authMiddleware');

// Get ticket categories (public - no auth needed to view)
router.get('/events/:event_id/tickets', eventBookingController.getTicketCategories);
router.post('/events/calculate-price', authMiddleware, eventBookingController.calculatePrice);
router.post('/events/create-order', authMiddleware, eventBookingController.createOrder);
router.post('/events/verify-payment', authMiddleware, eventBookingController.verifyPayment);
router.get('/event-bookings/my-bookings', authMiddleware, eventBookingController.getMyEventBookings);
router.get('/event-bookings/:booking_id', authMiddleware, eventBookingController.getEventBookingDetails);
module.exports = router;