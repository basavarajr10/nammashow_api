const db = require('../config/db');
const { generateToken } = require('../utils/jwtHelper');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { generateReferralCode } = require('../utils/referralHelper');
const axios = require('axios');
const FormData = require('form-data');

// Send OTP
const sendOTP = async (req, res) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number) {
      return errorResponse(res, 'Phone number is required', 400);
    }

    // Validate phone number - must be 10 digits
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone_number)) {
      return errorResponse(res, 'Phone number must be exactly 10 digits', 400);
    }

    // Check if user completed profile (isverified = 1)
    const existingUser = await db.queryOne(
      'SELECT * FROM users_profiles WHERE phone_number = ?',
      [phone_number]
    );

    const isRegistered = (existingUser && existingUser.isverified == 1) ? true : false;

    // Static OTP - 1234
    const otp = '1234';
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    // Delete old OTPs for this phone number
    await db.query('DELETE FROM otps WHERE phone_number = ?', [phone_number]);

    // Insert new OTP
    await db.query(
      'INSERT INTO otps (phone_number, otp_code, expires_at) VALUES (?, ?, ?)',
      [phone_number, otp, expiresAt]
    );

    return successResponse(res, 'OTP sent successfully', {
      phone_number,
      otp: otp, // For testing - remove in production
      is_registered: isRegistered
    });

  } catch (error) {
    console.error('Send OTP Error:', error);
    return errorResponse(res, 'Failed to send OTP', 500);
  }
};

// Verify OTP
const verifyOTP = async (req, res) => {
  try {
    console.log('========== VERIFY OTP START ==========');
    const { phone_number, otp } = req.body;
    console.log('Phone:', phone_number, 'OTP:', otp);

    if (!phone_number || !otp) {
      return errorResponse(res, 'Phone number and OTP are required', 400);
    }

    // Validate phone number
    const phoneRegex = /^[0-9]{10}$/;
    if (!phoneRegex.test(phone_number)) {
      return errorResponse(res, 'Phone number must be exactly 10 digits', 400);
    }

    // Check all OTPs for this phone number (for debugging)
    const allOtps = await db.query(
      'SELECT id, phone_number, otp_code, is_verified, expires_at, NOW() as current_time FROM otps WHERE phone_number = ?',
      [phone_number]
    );
    console.log('All OTPs for this phone:', allOtps);

    // Check OTP
    const otpRecord = await db.queryOne(
      'SELECT * FROM otps WHERE phone_number = ? AND otp_code = ? AND is_verified = 0 AND expires_at > NOW()',
      [phone_number, otp]
    );
    console.log('OTP Record found:', otpRecord);

    if (!otpRecord) {
      console.log('❌ OTP verification failed');
      return errorResponse(res, 'Invalid or expired OTP', 400);
    }

    console.log('✅ OTP verified successfully');
    console.log('========== VERIFY OTP END ==========');

    // Mark OTP as verified
    await db.query('UPDATE otps SET is_verified = 1 WHERE id = ?', [otpRecord.id]);

    // Check if user exists (registered user)
    let user = await db.queryOne(
      'SELECT * FROM users_profiles WHERE phone_number = ?',
      [phone_number]
    );

    if (!user) {
      // New user - Create user with isverified = 0
      const result = await db.query(
        'INSERT INTO users_profiles (phone_number, isverified, status, created_at) VALUES (?, 0, "active", NOW())',
        [phone_number]
      );
      
      user = await db.queryOne(
        'SELECT * FROM users_profiles WHERE id = ?',
        [result.insertId]
      );
    }

    // Generate JWT token for both new and existing users
    const token = generateToken({
      id: user.id,
      phone_number: user.phone_number,
      email: user.email_address
    });

    // Check if user completed profile
    const isRegistered = (user.isverified == 1) ? true : false;

    return successResponse(res, 'Login successful', {
      token,
      is_registered: isRegistered,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        full_name: user.full_name,
        email: user.email_address,
        referral_code: user.referral_code
      }
    });

  } catch (error) {
    console.error('Verify OTP Error:', error);
    return errorResponse(res, 'Failed to verify OTP', 500);
  }
};

// Complete Profile (Update user details after registration)
const completeProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const tokenPhoneNumber = req.user.phone_number;
    const { phone_number, full_name, email, referred_by } = req.body;

    // Validate required fields
    if (!phone_number || !full_name) {
      return errorResponse(res, 'Phone number and full name are required', 400);
    }

    // Security check - phone number must match token
    if (phone_number !== tokenPhoneNumber) {
      return errorResponse(res, 'Phone number mismatch. Please login again', 401);
    }

    // Validate email if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return errorResponse(res, 'Invalid email format', 400);
      }
    }

    // Get current user
    const user = await db.queryOne(
      'SELECT * FROM users_profiles WHERE id = ?',
      [userId]
    );

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Check if user already completed profile
    if (user.isverified == 1) {
      return errorResponse(res, 'You are already registered', 400);
    }

    // Validate referral code if provided
    if (referred_by) {
      const referredByUser = await db.queryOne(
        'SELECT id, referral_code, loyality_points FROM users_profiles WHERE referral_code = ?',
        [referred_by]
      );

      if (!referredByUser) {
        return errorResponse(res, 'Invalid referral code', 400);
      }

      // Get referral amount from admin settings
      const settings = await db.queryOne('SELECT referral_amount FROM admin_settings LIMIT 1');
      const referralAmount = settings ? parseFloat(settings.referral_amount) : 50;

      // Add referral points to the referrer's loyalty points
      const currentPoints = parseFloat(referredByUser.loyality_points) || 0;
      const newPoints = currentPoints + referralAmount;

      await db.query(
        'UPDATE users_profiles SET loyality_points = ? WHERE id = ?',
        [newPoints, referredByUser.id]
      );
    }

    // Generate unique referral code if user doesn't have one
    let referralCode = user.referral_code;
    if (!referralCode) {
      let isUnique = false;
      
      while (!isUnique) {
        referralCode = generateReferralCode();
        const existing = await db.queryOne(
          'SELECT id FROM users_profiles WHERE referral_code = ?',
          [referralCode]
        );
        if (!existing) {
          isUnique = true;
        }
      }
    }

    // Update user profile - Mark as registered
    await db.query(
      'UPDATE users_profiles SET full_name = ?, email_address = ?, referral_code = ?, referred_by = ?, isverified = 1, updated_at = NOW() WHERE id = ?',
      [full_name, email || null, referralCode, referred_by || null, userId]
    );

    // Get updated user
    const updatedUser = await db.queryOne(
      'SELECT * FROM users_profiles WHERE id = ?',
      [userId]
    );

    return successResponse(res, 'Profile completed successfully', {
      is_registered: true,
      user: {
        id: updatedUser.id,
        phone_number: updatedUser.phone_number,
        full_name: updatedUser.full_name,
        email: updatedUser.email_address,
        referral_code: updatedUser.referral_code
      }
    });

  } catch (error) {
    console.error('Complete Profile Error:', error);
    return errorResponse(res, 'Failed to complete profile', 500);
  }
};

// Google Sign In
const googleSignIn = async (req, res) => {
  try {
    const { google_token, email, name } = req.body;

    if (!email) {
      return errorResponse(res, 'Email is required', 400);
    }

    // Check if user exists by email
    let user = await db.queryOne(
      'SELECT * FROM users_profiles WHERE email_address = ?',
      [email]
    );

    // If user doesn't exist, create new user
    if (!user) {
      const result = await db.query(
        'INSERT INTO users_profiles (email_address, full_name, isverified, status, created_at) VALUES (?, ?, 1, "active", NOW())',
        [email, name || '']
      );
      
      user = await db.queryOne(
        'SELECT * FROM users_profiles WHERE id = ?',
        [result.insertId]
      );
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      phone_number: user.phone_number,
      email: user.email_address
    });

    return successResponse(res, 'Google sign-in successful', {
      token,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        full_name: user.full_name,
        email: user.email_address
      }
    });

  } catch (error) {
    console.error('Google Sign In Error:', error);
    return errorResponse(res, 'Failed to sign in with Google', 500);
  }
};

// Get Profile
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const config = require('../config/config');

    const user = await db.queryOne(
      'SELECT * FROM users_profiles WHERE id = ?',
      [userId]
    );

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Format date properly
    let dateOfBirth = null;
    if (user.date_of_birth) {
      const date = new Date(user.date_of_birth);
      dateOfBirth = date.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    }

    // Gender label mapping
    const genderLabels = {
      '0': 'Male',
      '1': 'Female'
    };
    const genderLabel = user.gender ? genderLabels[user.gender] : null;

    // Get profile picture from Laravel API
    let profilePicture = null;
    try {
      const laravelApiUrl = `${config.laravel.apiUrl}/v1/users/get-profile-picture/${userId}`;
      const response = await axios.get(laravelApiUrl);
      if (response.data.success && response.data.data.profile_picture) {
        profilePicture = response.data.data.profile_picture;
      }
    } catch (error) {
      // If no profile picture or error, just continue
      console.log('No profile picture found');
    }

    return successResponse(res, 'Profile fetched successfully', {
      is_registered: user.isverified == 1 ? true : false,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        email: user.email_address,
        full_name: user.full_name,
        gender: genderLabel,
        city: user.city,
        date_of_birth: dateOfBirth,
        booking_type: user.booking_type,
        loyality_points: user.loyality_points,
        referral_code: user.referral_code,
        status: user.status,
        profile_picture: profilePicture
      }
    });

  } catch (error) {
    console.error('Get Profile Error:', error);
    return errorResponse(res, 'Failed to fetch profile', 500);
  }
};

// Update Profile
const updateProfile = async (req, res) => {
  try {
    console.log('========== UPDATE PROFILE START ==========');
    console.log('Request Headers:', req.headers);
    console.log('Request Body:', req.body);
    console.log('Request File:', req.file ? req.file.originalname : 'No file');
    console.log('Request User:', req.user);
    
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.log('❌ Authentication failed - No user in request');
      return errorResponse(res, 'Authentication required', 401);
    }

    const userId = req.user.id;
    console.log('✅ User authenticated - ID:', userId);
    
    const config = require('../config/config');
    const { full_name, email, gender, city, date_of_birth } = req.body;

    console.log('Fields to update:', { full_name, email, gender, city, date_of_birth });

    const updates = [];
    const values = [];

    if (full_name) {
      updates.push('full_name = ?');
      values.push(full_name);
    }
    if (email) {
      updates.push('email_address = ?');
      values.push(email);
    }
    if (gender) {
      updates.push('gender = ?');
      values.push(gender);
    }
    if (city) {
      updates.push('city = ?');
      values.push(city);
    }
    if (date_of_birth) {
      updates.push('date_of_birth = ?');
      values.push(date_of_birth);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(userId);

      console.log('Executing DB update query...');
      await db.query(
        `UPDATE users_profiles SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
      console.log('✅ Database updated successfully');
    } else {
      console.log('⚠️ No fields to update in database');
    }

    // Handle profile picture upload if file exists
    let profilePicture = null;
    if (req.file) {
      console.log('📸 Profile picture upload detected');
      console.log('File details:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
      
      try {
        // Prepare form data to send to Laravel
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('user_id', userId);
        formData.append('profile_picture', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
        });

        // Laravel API URL
        const laravelApiUrl = `${config.laravel.apiUrl}/v1/users/upload-profile-picture`;
        console.log('Sending to Laravel API:', laravelApiUrl);

        // Send to Laravel API
        const response = await axios.post(laravelApiUrl, formData, {
          headers: {
            ...formData.getHeaders()
          }
        });

        console.log('Laravel API Response:', response.data);

        if (response.data.success) {
          profilePicture = response.data.data.profile_picture;
          console.log('✅ Profile picture uploaded successfully');
        }
      } catch (uploadError) {
        console.error('❌ Profile picture upload error:', uploadError.response?.data || uploadError.message);
        // Continue even if upload fails
      }
    } else {
      console.log('ℹ️ No profile picture in request');
    }

    const user = await db.queryOne(
      'SELECT * FROM users_profiles WHERE id = ?',
      [userId]
    );

    console.log('✅ Profile updated successfully');
    console.log('========== UPDATE PROFILE END ==========');

    return successResponse(res, 'Profile updated successfully', {
      user: {
        id: user.id,
        phone_number: user.phone_number,
        email: user.email_address,
        full_name: user.full_name,
        gender: user.gender,
        city: user.city,
        date_of_birth: user.date_of_birth,
        profile_picture: profilePicture
      }
    });

  } catch (error) {
    console.error('========== UPDATE PROFILE ERROR ==========');
    console.error('Error:', error);
    console.error('Error Stack:', error.stack);
    console.error('==========================================');
    return errorResponse(res, 'Failed to update profile', 500);
  }
};

// Refresh Token
const refreshToken = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await db.queryOne(
      'SELECT * FROM users_profiles WHERE id = ?',
      [userId]
    );

    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const token = generateToken({
      id: user.id,
      phone_number: user.phone_number,
      email: user.email_address
    });

    return successResponse(res, 'Token refreshed successfully', { token });

  } catch (error) {
    console.error('Refresh Token Error:', error);
    return errorResponse(res, 'Failed to refresh token', 500);
  }
};

module.exports = {
  sendOTP,
  verifyOTP,
  completeProfile,
  googleSignIn,
  getProfile,
  updateProfile,
  refreshToken
};