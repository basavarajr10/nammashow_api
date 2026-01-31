require('dotenv').config();

module.exports = {
  // Server Config
  port: process.env.PORT || 8000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || '/v1',

  // Database Config
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'nammashow',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  },

  // JWT Config
  jwt: {
    secret: process.env.JWT_SECRET || 'default_secret_key',
    expiresIn: process.env.JWT_EXPIRE || '365d'
  },

  // OTP Config
  otp: {
    expireMinutes: parseInt(process.env.OTP_EXPIRE_MINUTES) || 5,
    length: parseInt(process.env.OTP_LENGTH) || 4
  },

  // Google OAuth Config
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  },

  laravel: {
    apiUrl: process.env.LARAVEL_API_URL || 'https://nsadmin.webmoon.co.in/api',
    baseUrl: process.env.LARAVEL_BASE_URL || 'https://nsadmin.webmoon.co.in',
    publicPath: process.env.LARAVEL_PUBLIC_PATH || 'D:/webmoon/nammashow_admin_livewire/public'
  }

};