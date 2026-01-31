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
        const { createCanvas, loadImage } = require('canvas');
        const config = require('../config/config');

        // Generate QR code to canvas
        const canvas = createCanvas(400, 400);
        await QRCode.toCanvas(canvas, data, {
            errorCorrectionLevel: 'H',
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 400
        });

        const ctx = canvas.getContext('2d');

        // Draw white circle in center for logo background
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const logoSize = 80;

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(centerX, centerY, logoSize / 2 + 10, 0, 2 * Math.PI);
        ctx.fill();

        // Draw border around circle
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw "NammaShow" text
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw text in two lines
        ctx.fillText('Namma', centerX, centerY - 10);
        ctx.fillText('Show', centerX, centerY + 10);

        // Add small ticket icon emoji or symbol
        ctx.font = '20px Arial';
        ctx.fillText('🎬', centerX, centerY - 30);

        // Convert canvas to data URL
        const qrCodeDataURL = canvas.toDataURL('image/png');

        // Send to Laravel API
        const laravelApiUrl = `${config.laravel.apiUrl}/v1/media/upload-qrcode`;

        console.log(`📤 Uploading branded QR code to Laravel: ${laravelApiUrl}`);

        const response = await axios.post(laravelApiUrl, {
            booking_number: bookingNumber,
            qrcode_data: qrCodeDataURL
        });

        if (response.data.success) {
            const qrCodeUrl = response.data.data.qr_code_url;
            console.log(`✅ Branded QR Code uploaded: ${qrCodeUrl}`);
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
