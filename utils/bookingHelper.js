const QRCode = require('qrcode');

const generateBookingNumber = (sequentialNumber = 1) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const seq = String(sequentialNumber).padStart(3, '0');

    return `BK${year}${month}${day}${seq}`;
};

const getNextBookingNumber = async (db) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get count of bookings created today
        const result = await db.queryOne(
            `SELECT COUNT(*) as count FROM theater_bookings 
       WHERE DATE(created_at) = ?`,
            [today]
        );

        const nextSequence = (result?.count || 0) + 1;
        return generateBookingNumber(nextSequence);
    } catch (error) {
        console.error('Error generating booking number:', error);
        // Fallback to timestamp-based number
        return `BK${Date.now()}`;
    }
};

const generateQRCode = async (data) => {
    try {
        const qrCodeDataURL = await QRCode.toDataURL(data, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            quality: 0.95,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 300
        });

        return qrCodeDataURL;
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw new Error('Failed to generate QR code');
    }
};

const createBookingQRData = (bookingData) => {
    const {
        booking_number,
        booking_id,
        movie_title,
        seats,
        show_date,
        show_time
    } = bookingData;

    const seatsStr = Array.isArray(seats) ? seats.join(',') : seats;

    return `${booking_number}|${booking_id}|${movie_title}|${seatsStr}|${show_date}|${show_time}`;
};


const formatDate = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};


const formatTime = (time24) => {
    if (!time24) return '';

    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours);
    const m = minutes;

    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;

    return `${h12}:${m} ${period}`;
};

const saveQRCodeToFile = async (data, bookingNumber) => {
    try {
        const QRCode = require('qrcode');
        const axios = require('axios');
        const config = require('../config/config');

        // Generate QR code as base64 PNG
        const qrCodeDataURL = await QRCode.toDataURL(data, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            quality: 0.95,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 300
        });

        // Send to Laravel API
        const laravelApiUrl = `${config.laravel.apiUrl}/v1/media/upload-qrcode`;
        
        console.log(`📤 Uploading QR code to Laravel: ${laravelApiUrl}`);

        const response = await axios.post(laravelApiUrl, {
            booking_number: bookingNumber,
            qrcode_data: qrCodeDataURL
        });

        if (response.data.success) {
            const qrCodeUrl = response.data.data.qr_code_url;
            console.log(`✅ QR Code uploaded: ${qrCodeUrl}`);
            return qrCodeUrl;
        } else {
            throw new Error('Laravel API returned error');
        }

    } catch (error) {
        console.error('Error uploading QR code to Laravel:', error.response?.data || error.message);
        throw new Error('Failed to upload QR code: ' + error.message);
    }
};

module.exports = {
    generateBookingNumber,
    getNextBookingNumber,
    generateQRCode,
    saveQRCodeToFile,
    createBookingQRData,
    formatDate,
    formatTime
};
