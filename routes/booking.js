const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes - No authentication required
router.get('/schedules/:schedule_id/seats', bookingController.getSeatLayout);
router.get('/schedules/:schedule_id/food-beverages', bookingController.getFoodBeverages);
router.get('/coupons', bookingController.getCoupons);

// Protected routes - Authentication required
router.post('/bookings/calculate-price', authMiddleware, bookingController.calculatePrice);
router.post('/bookings/create-order', authMiddleware, bookingController.createOrder);
router.post('/bookings/verify-payment', authMiddleware, bookingController.verifyPayment);
router.get('/bookings/my-bookings', authMiddleware, bookingController.getMyBookings);
router.get('/bookings/:booking_id', authMiddleware, bookingController.getBookingDetails);

// TEST ROUTES - For Postman testing (Remove in production)
router.post('/bookings/test-verify-success', authMiddleware, bookingController.testVerifySuccess);
router.post('/bookings/test-verify-failure', authMiddleware, bookingController.testVerifyFailure);

module.exports = router;