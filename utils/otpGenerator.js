const config = require('../config/config');

const generateOTP = (length = config.otp.length) => {
  const digits = '0123456789';
  let otp = '';
  
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  
  return otp;
};

const getOTPExpiryTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + config.otp.expireMinutes);
  return now;
};

const formatPhoneNumber = (phone) => {
  return phone.replace(/[^0-9]/g, '');
};

const isValidPhoneNumber = (phone) => {
  const phoneRegex = /^[6-9]\d{9}$/; // Indian mobile numbers
  return phoneRegex.test(formatPhoneNumber(phone));
};

module.exports = {
  generateOTP,
  getOTPExpiryTime,
  formatPhoneNumber,
  isValidPhoneNumber
};