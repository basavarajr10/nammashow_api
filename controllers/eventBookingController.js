const db = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const safeJSONParse = (jsonString, fieldName = 'field', defaultValue = []) => {
    if (Array.isArray(jsonString)) return jsonString;
    if (typeof jsonString === 'object' && jsonString !== null) return jsonString;
    if (!jsonString || typeof jsonString !== 'string') return defaultValue;
    
    const trimmed = jsonString.trim();
    if (!trimmed) return defaultValue;
    
    try {
        return JSON.parse(trimmed);
    } catch (e) {
        try {
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                const content = trimmed.slice(1, -1).trim();
                if (!content) return defaultValue;
                const values = content.split(',').map(item => {
                    return item.trim().replace(/^['"]|['"]$/g, '');
                }).filter(item => item);
                return values;
            }
            return JSON.parse(trimmed.replace(/'/g, '"'));
        } catch (e2) {
            console.warn(`Could not parse ${fieldName}:`, trimmed);
            return defaultValue;
        }
    }
};

// 1. Get Event Ticket Categories
const getTicketCategories = async (req, res) => {
    try {
        console.log('========== GET EVENT TICKET CATEGORIES ==========');
        const { event_id } = req.params;
        const { language = 'en' } = req.query;

        // Get event details
        const event = await db.queryOne(
            `SELECT 
                ed.id,
                ed.event_name,
                ed.venue_name,
                ed.start_date_time,
                ed.address,
                ed.city
            FROM event_details ed
            WHERE ed.id = ? AND ed.status = '1' AND ed.deleted_at IS NULL`,
            [event_id]
        );

        if (!event) {
            return errorResponse(res, 'Event not found', 404);
        }

        // Get event translation
        const translation = await db.queryOne(
            `SELECT et.event_name, et.address, et.city
             FROM event_detail_translations et
             JOIN languages l ON et.language_id = l.id
             WHERE et.event_detail_id = ? AND l.code = ? AND l.is_active = 1`,
            [event_id, language]
        );

        // Get all tickets for this event
        const tickets = await db.query(
            `SELECT 
                tm.id,
                tm.ticket_name,
                tm.price,
                tm.total_quantity,
                tm.description_benefits
            FROM ticket_managements tm
            WHERE tm.select_event_id = ? 
            AND tm.status = '1'
            AND tm.deleted_at IS NULL
            ORDER BY tm.price ASC`,
            [event_id]
        );

        if (!tickets || tickets.length === 0) {
            return errorResponse(res, 'No tickets available for this event', 404);
        }

        // Calculate sold tickets for each ticket type
        const ticketsWithAvailability = await Promise.all(
            tickets.map(async (ticket) => {
                // Get total sold quantity for this ticket type
                const soldResult = await db.queryOne(
                    `SELECT COALESCE(SUM(qty), 0) as sold_qty
                     FROM event_bookings
                     WHERE JSON_EXTRACT(ticket_type, '$[*].ticket_id') LIKE ?
                     AND status IN (0, 1)
                     AND deleted_at IS NULL`,
                    [`%${ticket.id}%`]
                );

                const soldQty = soldResult?.sold_qty || 0;
                const availableQty = ticket.total_quantity - soldQty;

                return {
                    id: ticket.id,
                    ticket_name: ticket.ticket_name,
                    price: parseFloat(ticket.price),
                    total_quantity: ticket.total_quantity,
                    available_quantity: Math.max(0, availableQty),
                    description: ticket.description_benefits || null
                };
            })
        );

        // Filter out sold-out tickets
        const availableTickets = ticketsWithAvailability.filter(t => t.available_quantity > 0);

        // Format event date and time
        const startDateTime = new Date(event.start_date_time);
        const eventDate = startDateTime.toISOString().split('T')[0];
        const eventTime = startDateTime.toTimeString().split(' ')[0].substring(0, 5);

        return successResponse(res, 'Ticket categories fetched successfully', {
            event_info: {
                id: event.id,
                event_name: translation?.event_name || event.event_name,
                venue_name: event.venue_name,
                city: translation?.city || event.city,
                address: translation?.address || event.address,
                date: eventDate,
                time: eventTime
            },
            tickets: availableTickets
        });

    } catch (error) {
        console.error('Get Ticket Categories Error:', error);
        return errorResponse(res, 'Failed to fetch ticket categories', 500);
    }
};
const calculatePrice = async (req, res) => {
    try {
        console.log('========== CALCULATE EVENT BOOKING PRICE ==========');

        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required. Please login to continue.', 401);
        }

        const userId = req.user.id;
        const { event_id, tickets, use_loyalty_points } = req.body;

        // Validate required fields
        if (!event_id || !tickets || !Array.isArray(tickets) || tickets.length === 0) {
            return errorResponse(res, 'Event ID and tickets are required', 400);
        }

        // Validate ticket quantities
        for (const ticket of tickets) {
            if (!ticket.ticket_id || !ticket.quantity || ticket.quantity <= 0) {
                return errorResponse(res, 'Invalid ticket data', 400);
            }
        }

        // Get event details
        const event = await db.queryOne(
            `SELECT 
                ed.id,
                ed.event_name,
                ed.venue_name,
                ed.start_date_time,
                ed.address,
                ed.city
            FROM event_details ed
            WHERE ed.id = ? AND ed.status = '1' AND ed.deleted_at IS NULL`,
            [event_id]
        );

        if (!event) {
            return errorResponse(res, 'Event not found', 404);
        }

        // Get event poster URL
        const config = require('../config/config');
        const posterMedia = await db.queryOne(
            `SELECT id, file_name FROM media 
             WHERE model_type = 'App\\\\Models\\\\EventDetail' 
             AND model_id = ? 
             AND collection_name = 'event_detail_poster_images'
             ORDER BY id ASC LIMIT 1`,
            [event_id]
        );

        let posterUrl = null;
        if (posterMedia) {
            const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
            posterUrl = `${baseUrl}/storage/${posterMedia.id}/${posterMedia.file_name}`;
        }

        // Get user's loyalty points
        const user = await db.queryOne(
            'SELECT loyality_points FROM users_profiles WHERE id = ?',
            [userId]
        );
        const availableLoyaltyPoints = user?.loyality_points ? parseFloat(user.loyality_points) : 0;

        // Calculate ticket price
        let ticketPrice = 0;
        const ticketDetails = [];
        let totalQuantity = 0;

        for (const ticketItem of tickets) {
            // Get ticket details
            const ticket = await db.queryOne(
                `SELECT id, ticket_name, price, total_quantity
                 FROM ticket_managements
                 WHERE id = ? AND select_event_id = ? AND status = '1' AND deleted_at IS NULL`,
                [ticketItem.ticket_id, event_id]
            );

            if (!ticket) {
                return errorResponse(res, `Ticket ID ${ticketItem.ticket_id} not found`, 404);
            }

            // Check available quantity
            const soldResult = await db.queryOne(
                `SELECT COALESCE(SUM(qty), 0) as sold_qty
                 FROM event_bookings
                 WHERE JSON_EXTRACT(ticket_type, '$[*].ticket_id') LIKE ?
                 AND status IN (0, 1)
                 AND deleted_at IS NULL`,
                [`%${ticket.id}%`]
            );

            const soldQty = soldResult?.sold_qty || 0;
            const availableQty = ticket.total_quantity - soldQty;

            if (ticketItem.quantity > availableQty) {
                return errorResponse(
                    res,
                    `Only ${availableQty} tickets available for ${ticket.ticket_name}`,
                    400
                );
            }

            const itemTotal = parseFloat(ticket.price) * parseInt(ticketItem.quantity);
            ticketPrice += itemTotal;
            totalQuantity += parseInt(ticketItem.quantity);

            ticketDetails.push({
                ticket_id: ticket.id,
                ticket_name: ticket.ticket_name,
                quantity: parseInt(ticketItem.quantity),
                price_per_ticket: parseFloat(ticket.price),
                total: itemTotal
            });
        }

        // Calculate platform fee (flat ₹18)
        const platformFee = 18;

        // Subtotal before loyalty points
        const subtotal = ticketPrice + platformFee;

        // Apply loyalty points if requested
        let loyaltyPointsUsed = 0;
        if (use_loyalty_points && availableLoyaltyPoints > 0) {
            loyaltyPointsUsed = Math.min(availableLoyaltyPoints, subtotal);
        }

        // Calculate GST (18%)
        const amountAfterDiscount = subtotal - loyaltyPointsUsed;
        const gst = amountAfterDiscount * 0.18;

        // Total amount
        const totalAmount = amountAfterDiscount + gst;

        // Format event date and time
        const startDateTime = new Date(event.start_date_time);
        const eventDate = startDateTime.toISOString().split('T')[0];
        const eventTime = startDateTime.toTimeString().split(' ')[0].substring(0, 5);

        return successResponse(res, 'Price calculated successfully', {
            event_info: {
                event_name: event.event_name,
                venue_name: event.venue_name,
                city: event.city,
                address: event.address,
                date: eventDate,
                time: eventTime,
                poster_url: posterUrl
            },
            tickets: ticketDetails,
            total_tickets: totalQuantity,
            pricing: {
                ticket_price: ticketPrice,
                platform_fee: platformFee,
                subtotal: subtotal,
                loyalty_points_used: loyaltyPointsUsed,
                gst: parseFloat(gst.toFixed(2)),
                total: parseFloat(totalAmount.toFixed(2))
            },
            loyalty: {
                available_points: availableLoyaltyPoints,
                points_used: loyaltyPointsUsed
            }
        });

    } catch (error) {
        console.error('Calculate Event Price Error:', error);
        return errorResponse(res, 'Failed to calculate price', 500);
    }
};
const createOrder = async (req, res) => {
    try {
        console.log('========== CREATE EVENT RAZORPAY ORDER ==========');

        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required. Please login to continue.', 401);
        }

        const userId = req.user.id;
        const { event_id, tickets, use_loyalty_points } = req.body;

        // Validate required fields
        if (!event_id || !tickets || !Array.isArray(tickets) || tickets.length === 0) {
            return errorResponse(res, 'Event ID and tickets are required', 400);
        }

        // Import utilities
        const razorpayUtil = require('../utils/razorpay');
        const bookingHelper = require('../utils/bookingHelper');

        // Get event details
        const event = await db.queryOne(
            `SELECT 
                ed.id,
                ed.event_name,
                ed.venue_name,
                ed.start_date_time,
                ed.address,
                ed.city
            FROM event_details ed
            WHERE ed.id = ? AND ed.status = '1' AND ed.deleted_at IS NULL`,
            [event_id]
        );

        if (!event) {
            return errorResponse(res, 'Event not found', 404);
        }

        // Calculate ticket price and validate availability
        let ticketPrice = 0;
        const ticketDetails = [];
        let totalQuantity = 0;

        for (const ticketItem of tickets) {
            const ticket = await db.queryOne(
                `SELECT id, ticket_name, price, total_quantity
                 FROM ticket_managements
                 WHERE id = ? AND select_event_id = ? AND status = '1' AND deleted_at IS NULL`,
                [ticketItem.ticket_id, event_id]
            );

            if (!ticket) {
                return errorResponse(res, `Ticket ID ${ticketItem.ticket_id} not found`, 404);
            }

            // Check available quantity
            const soldResult = await db.queryOne(
                `SELECT COALESCE(SUM(qty), 0) as sold_qty
                 FROM event_bookings
                 WHERE JSON_EXTRACT(ticket_type, '$[*].ticket_id') LIKE ?
                 AND status IN (0, 1)
                 AND deleted_at IS NULL`,
                [`%${ticket.id}%`]
            );

            const soldQty = soldResult?.sold_qty || 0;
            const availableQty = ticket.total_quantity - soldQty;

            if (ticketItem.quantity > availableQty) {
                return errorResponse(
                    res,
                    `Only ${availableQty} tickets available for ${ticket.ticket_name}`,
                    400
                );
            }

            const itemTotal = parseFloat(ticket.price) * parseInt(ticketItem.quantity);
            ticketPrice += itemTotal;
            totalQuantity += parseInt(ticketItem.quantity);

            ticketDetails.push({
                ticket_id: ticket.id,
                ticket_name: ticket.ticket_name,
                quantity: parseInt(ticketItem.quantity),
                price_per_ticket: parseFloat(ticket.price),
                total: itemTotal
            });
        }

        // Platform fee
        const platformFee = 18;
        const subtotal = ticketPrice + platformFee;

        // Loyalty points
        let loyaltyPointsUsed = 0;
        if (use_loyalty_points) {
            const user = await db.queryOne(
                'SELECT loyality_points FROM users_profiles WHERE id = ?',
                [userId]
            );
            const availablePoints = user?.loyality_points ? parseFloat(user.loyality_points) : 0;
            if (availablePoints > 0) {
                loyaltyPointsUsed = Math.min(availablePoints, subtotal);
            }
        }

        // Calculate GST and total
        const amountAfterDiscount = subtotal - loyaltyPointsUsed;
        const gst = amountAfterDiscount * 0.18;
        const totalAmount = amountAfterDiscount + gst;

        // Get user details for booking
        const user = await db.queryOne(
            'SELECT full_name, phone_number, email_address FROM users_profiles WHERE id = ?',
            [userId]
        );

        // Generate booking number
        const bookingNumber = await bookingHelper.getNextBookingNumber(db);

        // Create Razorpay order
        const receiptId = razorpayUtil.generateReceiptId(userId);
        const razorpayOrder = await razorpayUtil.createOrder(
            totalAmount,
            receiptId,
            {
                user_id: userId,
                event_id: event_id,
                event_name: event.event_name,
                booking_number: bookingNumber,
                total_tickets: totalQuantity
            }
        );

        // Format event date and time
        const startDateTime = new Date(event.start_date_time);
        const eventDate = startDateTime.toISOString().split('T')[0];
        const eventTime = startDateTime.toTimeString().split(' ')[0].substring(0, 5);

        // Create PENDING booking in database
        const bookingResult = await db.query(
            `INSERT INTO event_bookings 
             (booking, user_information, event_name, ticket_type, qty, total_amount, date, 
              payment_information, status, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                bookingNumber,
                JSON.stringify({
                    user_id: userId,
                    name: user?.full_name || 'Guest',
                    email: user?.email_address || '',
                    phone: user?.phone_number || ''
                }),
                event.event_name,
                JSON.stringify(ticketDetails),
                totalQuantity,
                totalAmount,
                eventDate,
                JSON.stringify({
                    razorpay_order_id: razorpayOrder.id,
                    amount: totalAmount,
                    payment_status: 'pending'
                }),
                0 // Pending status
            ]
        );

        const bookingId = bookingResult.insertId;

        // Store payment transaction with booking details
        await db.query(
            `INSERT INTO payment_transactions 
             (user_id, booking_id, razorpay_order_id, amount, currency, status, payment_details, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                userId,
                bookingId,
                razorpayOrder.id,
                totalAmount,
                'INR',
                'pending',
                JSON.stringify({
                    event_id: event_id,
                    event_name: event.event_name,
                    venue_name: event.venue_name,
                    event_date: eventDate,
                    event_time: eventTime,
                    tickets: ticketDetails,
                    total_tickets: totalQuantity,
                    loyalty_points_used: loyaltyPointsUsed,
                    pricing: {
                        ticket_price: ticketPrice,
                        platform_fee: platformFee,
                        subtotal: subtotal,
                        gst: parseFloat(gst.toFixed(2)),
                        total: parseFloat(totalAmount.toFixed(2))
                    }
                })
            ]
        );

        return successResponse(res, 'Razorpay order created successfully', {
            order_id: razorpayOrder.id,
            booking_id: bookingId,
            booking_number: bookingNumber,
            amount: parseFloat(totalAmount.toFixed(2)),
            currency: 'INR',
            key_id: razorpayUtil.KEY_ID,
            booking_summary: {
                event_name: event.event_name,
                venue_name: event.venue_name,
                date: eventDate,
                time: eventTime,
                total_tickets: totalQuantity,
                total_amount: parseFloat(totalAmount.toFixed(2))
            },
            payment_breakdown: {
                ticket_price: ticketPrice,
                platform_fee: platformFee,
                subtotal: subtotal,
                loyalty_points_used: loyaltyPointsUsed,
                gst: parseFloat(gst.toFixed(2)),
                total: parseFloat(totalAmount.toFixed(2))
            }
        });

    } catch (error) {
        console.error('Create Event Order Error:', error);
        return errorResponse(res, 'Failed to create order: ' + error.message, 500);
    }
};
const verifyPayment = async (req, res) => {
    let connection = null;

    try {
        console.log('========== VERIFY EVENT PAYMENT & UPDATE BOOKING ==========');

        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required. Please login to continue.', 401);
        }

        const userId = req.user.id;
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        // Validate required fields
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return errorResponse(res, 'Payment details (razorpay_order_id, razorpay_payment_id, razorpay_signature) are required', 400);
        }

        // Import utilities
        const razorpayUtil = require('../utils/razorpay');
        const bookingHelper = require('../utils/bookingHelper');

        // Verify payment signature
        const isValidSignature = razorpayUtil.verifySignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValidSignature) {
            // Update payment transaction as failed
            await db.query(
                `UPDATE payment_transactions 
                 SET status = 'failed', error_description = 'Invalid signature', updated_at = NOW() 
                 WHERE razorpay_order_id = ?`,
                [razorpay_order_id]
            );

            return errorResponse(res, 'Invalid payment signature', 400);
        }

        // Start transaction
        connection = await db.beginTransaction();

        // Get payment transaction with booking details
        const paymentResult = await connection.query(
            `SELECT * FROM payment_transactions 
             WHERE razorpay_order_id = ? AND user_id = ?`,
            [razorpay_order_id, userId]
        );

        const payment = paymentResult[0][0];
        if (!payment) {
            await connection.rollback();
            connection.release();
            return errorResponse(res, 'Payment transaction not found', 404);
        }

        // Check if already verified
        if (payment.status === 'success') {
            await connection.rollback();
            connection.release();
            return errorResponse(res, 'Payment already verified', 400);
        }

        // Parse booking details from payment_details
        const bookingData = safeJSONParse(payment.payment_details, 'payment_details', {});
        const bookingId = payment.booking_id;

        // Get the booking
        const bookingResult = await connection.query(
            'SELECT * FROM event_bookings WHERE id = ?',
            [bookingId]
        );

        const booking = bookingResult[0][0];
        if (!booking) {
            await connection.rollback();
            connection.release();
            return errorResponse(res, 'Booking not found', 404);
        }

        // Deduct loyalty points if used
        if (bookingData.loyalty_points_used && bookingData.loyalty_points_used > 0) {
            await connection.query(
                'UPDATE users_profiles SET loyality_points = loyality_points - ? WHERE id = ?',
                [bookingData.loyalty_points_used, userId]
            );
        }

        // Update booking status to CONFIRMED
        await connection.query(
            `UPDATE event_bookings 
             SET status = 1, 
                 payment_information = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [
                JSON.stringify({
                    razorpay_order_id: razorpay_order_id,
                    razorpay_payment_id: razorpay_payment_id,
                    amount_paid: payment.amount,
                    payment_method: 'razorpay',
                    payment_status: 'success',
                    loyalty_points_used: bookingData.loyalty_points_used || 0
                }),
                bookingId
            ]
        );

        // Update payment transaction status
        await connection.query(
            `UPDATE payment_transactions 
             SET razorpay_payment_id = ?, 
                 razorpay_signature = ?, 
                 status = 'success', 
                 updated_at = NOW() 
             WHERE id = ?`,
            [razorpay_payment_id, razorpay_signature, payment.id]
        );

        // Commit transaction
        await connection.commit();
        connection.release();

        // Generate QR code for event booking
        const ticketsInfo = bookingData.tickets.map(t => `${t.ticket_name} x${t.quantity}`).join(', ');
        
        const qrData = `${booking.booking}|${bookingId}|${bookingData.event_name}|${ticketsInfo}|${bookingData.event_date}|${bookingData.event_time}`;
        const qrCodeUrl = await bookingHelper.saveQRCodeToFile(qrData, booking.booking);

        return successResponse(res, 'Event booking confirmed successfully', {
            booking_id: bookingId,
            booking_number: booking.booking,
            status: 'confirmed',
            qr_code_url: qrCodeUrl,
            booking_details: {
                event_name: bookingData.event_name,
                venue_name: bookingData.venue_name,
                date: bookingData.event_date,
                time: bookingData.event_time,
                tickets: bookingData.tickets || [],
                total_tickets: bookingData.total_tickets,
                payment_info: {
                    razorpay_payment_id: razorpay_payment_id,
                    amount_paid: parseFloat(payment.amount),
                    payment_method: 'razorpay',
                    payment_status: 'success'
                },
                pricing: bookingData.pricing || {}
            }
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('Verify Event Payment Error:', error);
        return errorResponse(res, 'Failed to verify payment: ' + error.message, 500);
    }
};
const getMyEventBookings = async (req, res) => {
    try {
        console.log('========== GET MY EVENT BOOKINGS ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const bookingHelper = require('../utils/bookingHelper');
        const userId = req.user.id;
        const status = req.query.status ? parseInt(req.query.status) : undefined;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const language = req.query.language || 'en';

        const offset = (page - 1) * limit;
        let whereClause = 'WHERE JSON_EXTRACT(user_information, "$.user_id") = ? AND deleted_at IS NULL';
        const params = [userId];

        if (status !== undefined) {
            whereClause += ' AND status = ?';
            params.push(status);
        }

        // Get total count
        const countResult = await db.queryOne(
            `SELECT COUNT(*) as total FROM event_bookings ${whereClause}`,
            params
        );

        // Get bookings
        const bookings = await db.query(
            `SELECT 
                id as booking_id,
                booking as booking_number,
                event_name,
                ticket_type,
                qty,
                total_amount,
                date,
                status,
                created_at as booking_date
             FROM event_bookings 
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // Format bookings
        const formattedBookings = bookings.map((booking) => {
            const statusCode = parseInt(booking.status);
            let statusLabel = 'unknown';

            switch (statusCode) {
                case 0:
                    statusLabel = 'pending';
                    break;
                case 1:
                    statusLabel = 'confirmed';
                    break;
                case 2:
                    statusLabel = 'cancelled';
                    break;
                default:
                    statusLabel = 'unknown';
            }

            // Parse ticket details
            const tickets = safeJSONParse(booking.ticket_type, 'ticket_type', []);

            return {
                booking_id: booking.booking_id,
                booking_number: booking.booking_number,
                event_name: booking.event_name,
                tickets: tickets,
                total_tickets: booking.qty,
                total_amount: parseFloat(booking.total_amount),
                event_date: bookingHelper.formatDate(booking.date),
                status: statusLabel,
                booking_date: bookingHelper.formatDate(booking.booking_date)
            };
        });

        return successResponse(res, 'Event bookings fetched successfully', {
            bookings: formattedBookings,
            pagination: {
                current_page: page,
                total_pages: Math.ceil(countResult.total / limit),
                total_items: countResult.total,
                items_per_page: limit,
                has_next: page < Math.ceil(countResult.total / limit),
                has_previous: page > 1
            }
        });

    } catch (error) {
        console.error('Get My Event Bookings Error:', error);
        return errorResponse(res, 'Failed to fetch event bookings', 500);
    }
};
const getEventBookingDetails = async (req, res) => {
    try {
        console.log('========== GET EVENT BOOKING DETAILS ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const userId = req.user.id;
        const { booking_id } = req.params;
        const { language = 'en' } = req.query;

        const booking = await db.queryOne(
            `SELECT * FROM event_bookings 
             WHERE id = ? 
             AND JSON_EXTRACT(user_information, "$.user_id") = ?
             AND deleted_at IS NULL`,
            [booking_id, userId]
        );

        if (!booking) {
            return errorResponse(res, 'Booking not found', 404);
        }

        const bookingHelper = require('../utils/bookingHelper');

        // Parse JSON fields safely
        let userInfo = {};
        try {
            userInfo = safeJSONParse(booking.user_information, 'user_information', {});
        } catch (e) {
            console.error('Error parsing user_information:', e);
            userInfo = {};
        }

        let tickets = [];
        try {
            tickets = safeJSONParse(booking.ticket_type, 'ticket_type', []);
        } catch (e) {
            console.error('Error parsing ticket_type:', e);
            tickets = [];
        }

        let paymentInfo = {};
        try {
            paymentInfo = safeJSONParse(booking.payment_information, 'payment_information', {});
        } catch (e) {
            console.error('Error parsing payment_information:', e);
            paymentInfo = {};
        }

        // Generate QR code
        const ticketsInfo = tickets.map(t => `${t.ticket_name} x${t.quantity}`).join(', ');
        const qrData = `${booking.booking}|${booking.id}|${booking.event_name}|${ticketsInfo}|${booking.date}`;
        const qrCodeUrl = await bookingHelper.saveQRCodeToFile(qrData, booking.booking);

        // Get event poster
        const config = require('../config/config');
        
        // Try to find event by name to get poster
        const event = await db.queryOne(
            `SELECT id FROM event_details WHERE event_name = ? AND deleted_at IS NULL LIMIT 1`,
            [booking.event_name]
        );

        let posterUrl = null;
        if (event) {
            const posterMedia = await db.queryOne(
                `SELECT id, file_name FROM media 
                 WHERE model_type = 'App\\\\Models\\\\EventDetail' 
                 AND model_id = ? 
                 AND collection_name = 'event_detail_poster_images'
                 ORDER BY id ASC LIMIT 1`,
                [event.id]
            );

            if (posterMedia) {
                const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
                posterUrl = `${baseUrl}/storage/${posterMedia.id}/${posterMedia.file_name}`;
            }
        }

        // Map status code to label
        const statusCode = parseInt(booking.status);
        let statusLabel = 'unknown';
        switch (statusCode) {
            case 0: statusLabel = 'pending'; break;
            case 1: statusLabel = 'confirmed'; break;
            case 2: statusLabel = 'cancelled'; break;
            default: statusLabel = 'unknown';
        }

        return successResponse(res, 'Event booking details fetched successfully', {
            booking_id: booking.id,
            booking_number: booking.booking,
            status: statusLabel,
            qr_code_url: qrCodeUrl,
            event_info: {
                event_name: booking.event_name,
                poster_url: posterUrl,
                date: bookingHelper.formatDate(booking.date)
            },
            user_info: {
                name: userInfo.name || 'Guest',
                email: userInfo.email || '',
                phone: userInfo.phone || ''
            },
            tickets: tickets,
            total_tickets: booking.qty,
            payment_info: {
                razorpay_payment_id: paymentInfo.razorpay_payment_id || null,
                amount_paid: parseFloat(booking.total_amount),
                payment_status: paymentInfo.payment_status || 'unknown',
                loyalty_points_used: paymentInfo.loyalty_points_used || 0
            },
            total_amount: parseFloat(booking.total_amount),
            booking_date: bookingHelper.formatDate(booking.created_at)
        });

    } catch (error) {
        console.error('Get Event Booking Details Error:', error);
        return errorResponse(res, 'Failed to fetch event booking details', 500);
    }
};
module.exports = {
    getTicketCategories,
    calculatePrice,
    createOrder,
    verifyPayment,
    getMyEventBookings,
    getEventBookingDetails  
};
