const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');
router.post('/send-otp', authController.sendOTP);
router.post('/verify-otp', authController.verifyOTP);
router.post('/google-signin', authController.googleSignIn);

router.get('/get-profile', authMiddleware, authController.getProfile);
router.post('/update-profile',authMiddleware, upload.single('profile_picture'), authController.updateProfile);
router.post('/refresh-token', authMiddleware, authController.refreshToken);
router.post('/complete-profile', authMiddleware, authController.completeProfile);

module.exports = router;