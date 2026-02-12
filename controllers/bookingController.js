const db = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

const safeJSONParse = (jsonString, fieldName = 'field', defaultValue = []) => {
    // If it's already an array or object, return it as-is
    if (Array.isArray(jsonString)) {
        return jsonString;
    }

    if (typeof jsonString === 'object' && jsonString !== null) {
        return jsonString;
    }

    // Handle null, undefined, or non-string values
    if (!jsonString || typeof jsonString !== 'string') {
        return defaultValue;
    }

    const trimmed = jsonString.trim();

    // Return default if empty
    if (!trimmed) {
        return defaultValue;
    }

    try {
        // Try parsing as valid JSON first
        return JSON.parse(trimmed);
    } catch (e) {
        // Handle [ 'value1', 'value2' ] format
        try {
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                const content = trimmed.slice(1, -1).trim();

                if (!content) return defaultValue;

                // Split by comma and clean each value
                const values = content.split(',').map(item => {
                    return item.trim().replace(/^['"]|['"]$/g, '');
                }).filter(item => item);

                return values;
            }

            // Try replacing single quotes with double quotes
            return JSON.parse(trimmed.replace(/'/g, '"'));

        } catch (e2) {
            console.warn(`Could not parse ${fieldName}:`, trimmed);
            return defaultValue;
        }
    }
};

// Helper function to cleanup pending bookings older than 15 minutes
const cleanupPendingBookings = async () => {
    try {
        // Clean up pending bookings older than 15 minutes
        const bookingResult = await db.query(
            `UPDATE theater_bookings 
             SET status = 2, updated_at = NOW() 
             WHERE status = 0 
             AND created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)
             AND deleted_at IS NULL`
        );

        if (bookingResult.affectedRows > 0) {
            console.log(`✅ Cleaned up ${bookingResult.affectedRows} stale pending bookings.`);
        }

        // Clean up expired seat locks
        const lockResult = await db.query(
            'DELETE FROM seat_locks WHERE expires_at < NOW()'
        );

        if (lockResult.affectedRows > 0) {
            console.log(`✅ Cleaned up ${lockResult.affectedRows} expired seat locks.`);
        }
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
};

const getCategoryName = async (categoryId) => {
    try {
        const category = await db.queryOne(
            'SELECT category FROM pricing_managements WHERE id = ?',
            [categoryId]
        );
        return category?.category || 'Regular';
    } catch (error) {
        console.error('Error fetching category:', error);
        return 'Regular';
    }
};

// Helper function to get movie translation
const getMovieTranslation = async (movieId, languageCode = 'kn') => {
    try {
        const translation = await db.queryOne(
            `SELECT mt.*, l.code as language_code
             FROM show_management_translations mt
             JOIN languages l ON mt.language_id = l.id
             WHERE mt.show_management_id = ? AND l.code = ? AND l.is_active = 1`,
            [movieId, languageCode]
        );
        return translation;
    } catch (error) {
        console.error('Error fetching movie translation:', error.message);
        return null;
    }
};

// Helper function to get theater translation
const getTheaterTranslation = async (theaterId, languageCode = 'kn') => {
    try {
        const translation = await db.queryOne(
            `SELECT tt.*, l.code as language_code
             FROM theater_translations tt
             JOIN languages l ON tt.language_id = l.id
             WHERE tt.theater_id = ? AND l.code = ? AND l.is_active = 1`,
            [theaterId, languageCode]
        );
        return translation;
    } catch (error) {
        console.error('Error fetching theater translation:', error.message);
        return null;
    }
};

// 1. Get Seat Layout for a Schedule
const getSeatLayout = async (req, res) => {
    try {
        // Automatically cleanup stale pending bookings and locks first
        await cleanupPendingBookings();

        console.log('========== GET SEAT LAYOUT ==========');
        const { schedule_id } = req.params;

        // Get schedule with movie and screen details
        const schedule = await db.queryOne(
            `SELECT 
        schm.id,
        schm.show_date,
        schm.show_time,
        schm.show_end_time,
        schm.screen_id,
        sm.id as movie_id,
        sm.movie_title,
        sm.pricing_data,
        slb.layout_data,
        slb.seat_allocation,
        slb.screen,
        t.id as theater_id,
        t.theater_name
      FROM schedule_managements schm
      JOIN show_managements sm ON schm.movie_id = sm.id
      JOIN seat_layout_builders slb ON schm.screen_id = slb.id
      JOIN theaters t ON sm.theaters_id = t.id
      WHERE schm.id = ?
      AND schm.status = '1'
      AND schm.deleted_at IS NULL`,
            [schedule_id]
        );

        if (!schedule) {
            return errorResponse(res, 'Schedule not found', 404);
        }

        // Parse JSON fields
        const layoutData = safeJSONParse(schedule.layout_data, 'layout_data', []);
        const seatAllocation = safeJSONParse(schedule.seat_allocation, 'seat_allocation', {});
        const pricingData = safeJSONParse(schedule.pricing_data, 'pricing_data', {});

        // Get booked seats for this specific schedule
        const bookings = await db.query(
            `SELECT seats_booked FROM theater_bookings 
       WHERE schedule_id = ? 
       AND status IN (1, 3)
       AND deleted_at IS NULL`,
            [schedule_id]
        );

        // Extract all booked seat IDs
        const bookedSeats = [];
        bookings.forEach(booking => {
            const seats = safeJSONParse(booking.seats_booked, 'seats_booked', []);
            seats.forEach(seat => {
                if (seat.id) {
                    bookedSeats.push(seat.id);
                }
            });
        });

        // Get locked seats (excluding current user's locks so they can see their own selection)
        const currentUserId = req.user?.id || null;

        let lockedSeats = [];
        if (currentUserId) {
            // If user is logged in, exclude their own locks
            const lockedSeatsResult = await db.query(
                `SELECT seat_number FROM seat_locks 
                 WHERE schedule_id = ? 
                 AND expires_at > NOW()
                 AND user_id != ?`,
                [schedule_id, currentUserId]
            );
            lockedSeats = lockedSeatsResult.map(lock => lock.seat_number);
        } else {
            // If no user (guest viewing), show all locked seats
            const lockedSeatsResult = await db.query(
                `SELECT seat_number FROM seat_locks 
                 WHERE schedule_id = ? 
                 AND expires_at > NOW()`,
                [schedule_id]
            );
            lockedSeats = lockedSeatsResult.map(lock => lock.seat_number);
        }

        console.log('Booked seats:', bookedSeats);
        console.log('Locked seats:', lockedSeats);

        // Determine price type based on date
        const scheduleDate = new Date(schedule.show_date);
        const dayOfWeek = scheduleDate.getDay(); // 0=Sunday, 6=Saturday
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        // TODO: Check for holidays from holiday_managements table
        const isHoliday = false;

        // Calculate current prices for each category
        const pricing = {};
        if (pricingData) {
            for (const [category, prices] of Object.entries(pricingData)) {
                if (isHoliday && prices.holiday_price) {
                    pricing[category] = parseFloat(prices.holiday_price);
                } else if (isWeekend && prices.weekend_price) {
                    pricing[category] = parseFloat(prices.weekend_price);
                } else {
                    pricing[category] = parseFloat(prices.base_price);
                }
            }
        }

        // Build category ID to name mapping
        const categoryMap = {};
        for (const seat of layoutData) {
            if (seat.category_id && !categoryMap[seat.category_id]) {
                categoryMap[seat.category_id] = await getCategoryName(seat.category_id);
            }
        }

        // Filter and format seats - ONLY online quota
        const onlineSeats = seatAllocation.online_seats || [];
        const formattedSeats = [];

        for (const seat of layoutData) {
            // Include gaps for layout
            if (seat.type === 'gap') {
                formattedSeats.push({
                    row: seat.row,
                    column: seat.column,
                    type: 'gap'
                });
                continue;
            }

            // Only include online quota seats
            if (seat.quota_type === 'online' && seat.seat_number && onlineSeats.includes(seat.seat_number)) {
                const categoryName = categoryMap[seat.category_id] || 'regular';
                const categoryKey = categoryName.toLowerCase();

                // Determine seat status: booked > locked > available
                let seatStatus = 'available';
                if (bookedSeats.includes(seat.seat_number)) {
                    seatStatus = 'booked';
                } else if (lockedSeats.includes(seat.seat_number)) {
                    seatStatus = 'locked';
                }

                formattedSeats.push({
                    row: seat.row,
                    column: seat.column,
                    seat_number: seat.seat_number,
                    category: categoryName,
                    price: pricing[categoryKey] || 0,
                    status: seatStatus  // Returns: 'available', 'locked', or 'booked'
                });
            }
        }

        // Get unique rows (only rows with online seats)
        const uniqueRows = [...new Set(
            formattedSeats
                .filter(s => s.type !== 'gap')
                .map(s => s.row)
        )].sort();

        // Get walkway positions
        const walkwayAfter = seatAllocation.row_spacing || [];

        return successResponse(res, 'Seat layout fetched successfully', {
            schedule_id: schedule.id,
            movie_title: schedule.movie_title,
            show_date: schedule.show_date ? new Date(schedule.show_date).toISOString().split('T')[0] : null,
            show_time: schedule.show_time,
            show_end_time: schedule.show_end_time,
            screen: schedule.screen,
            theater_id: schedule.theater_id,
            theater_name: schedule.theater_name,
            pricing: pricing,
            layout: {
                rows: uniqueRows,
                walkway_after: walkwayAfter,
                seats: formattedSeats
            },
            total_online_seats: onlineSeats.length,
            available_seats: onlineSeats.length - bookedSeats.filter(s => onlineSeats.includes(s)).length,
            locked_seats_count: lockedSeats.length
        }, 200, true);

    } catch (error) {
        console.error('Get Seat Layout Error:', error);
        return errorResponse(res, 'Failed to fetch seat layout', 500);
    }
};

// Lock seats temporarily (15 minutes)
const lockSeats = async (req, res) => {
    try {
        console.log('========== LOCK SEATS ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const userId = req.user.id;
        const { schedule_id, seats } = req.body;

        if (!schedule_id || !seats || !Array.isArray(seats) || seats.length === 0) {
            return errorResponse(res, 'Schedule ID and seats are required', 400);
        }

        // Clean up expired locks first
        await db.query(
            'DELETE FROM seat_locks WHERE expires_at < NOW()'
        );

        // Check if any seats are already locked by other users
        const lockedSeats = await db.query(
            `SELECT seat_number, user_id FROM seat_locks 
             WHERE schedule_id = ? 
             AND seat_number IN (?)
             AND expires_at > NOW()`,
            [schedule_id, seats]
        );

        // Filter out seats locked by other users
        const unavailableSeats = lockedSeats
            .filter(lock => lock.user_id !== userId)
            .map(lock => lock.seat_number);

        if (unavailableSeats.length > 0) {
            return errorResponse(
                res,
                `Seats already selected by another user: ${unavailableSeats.join(', ')}`,
                409
            );
        }

        // Check if seats are already booked
        const bookings = await db.query(
            `SELECT seats_booked FROM theater_bookings 
             WHERE schedule_id = ? 
             AND status IN (1, 3)
             AND deleted_at IS NULL`,
            [schedule_id]
        );

        const bookedSeats = [];
        bookings.forEach(booking => {
            const seats_data = safeJSONParse(booking.seats_booked, 'seats_booked', []);
            seats_data.forEach(seat => {
                if (seat.id || seat.seat_number) {
                    bookedSeats.push(seat.id || seat.seat_number);
                }
            });
        });

        const alreadyBooked = seats.filter(seat => bookedSeats.includes(seat));
        if (alreadyBooked.length > 0) {
            return errorResponse(
                res,
                `Seats already booked: ${alreadyBooked.join(', ')}`,
                409
            );
        }

        // Lock the seats for 15 minutes
        for (const seat of seats) {
            await db.query(
                `INSERT INTO seat_locks (schedule_id, seat_number, user_id, locked_at, expires_at)
                 VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE))
                 ON DUPLICATE KEY UPDATE 
                    user_id = VALUES(user_id),
                    locked_at = VALUES(locked_at),
                    expires_at = VALUES(expires_at)`,
                [schedule_id, seat, userId]
            );
        }

        console.log(`✅ Locked ${seats.length} seats for user ${userId}`);

        return successResponse(res, 'Seats locked successfully', {
            schedule_id: schedule_id,
            locked_seats: seats,
            expires_in_minutes: 15,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });

    } catch (error) {
        console.error('Lock Seats Error:', error);
        return errorResponse(res, 'Failed to lock seats', 500);
    }
};

// Unlock seats (when user deselects or navigates away)
const unlockSeats = async (req, res) => {
    try {
        console.log('========== UNLOCK SEATS ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const userId = req.user.id;
        const { schedule_id, seats } = req.body;

        if (!schedule_id) {
            return errorResponse(res, 'Schedule ID is required', 400);
        }

        // If seats array is provided, unlock only those seats
        // If not provided, unlock all seats for this user and schedule
        if (seats && Array.isArray(seats) && seats.length > 0) {
            await db.query(
                `DELETE FROM seat_locks 
                 WHERE schedule_id = ? 
                 AND user_id = ? 
                 AND seat_number IN (?)`,
                [schedule_id, userId, seats]
            );
            console.log(`✅ Unlocked ${seats.length} specific seats for user ${userId}`);
        } else {
            const result = await db.query(
                `DELETE FROM seat_locks 
                 WHERE schedule_id = ? 
                 AND user_id = ?`,
                [schedule_id, userId]
            );
            console.log(`✅ Unlocked all seats for user ${userId} (${result.affectedRows} seats)`);
        }

        return successResponse(res, 'Seats unlocked successfully');

    } catch (error) {
        console.error('Unlock Seats Error:', error);
        return errorResponse(res, 'Failed to unlock seats', 500);
    }
};

// Helper function to get food item image URL
const getFoodItemImageUrl = async (itemId) => {
    try {
        const media = await db.queryOne(
            `SELECT id, file_name FROM media 
       WHERE model_type = 'App\\\\Models\\\\FoodAndBeverageManagement' 
       AND model_id = ? 
       AND collection_name = 'food_and_beverage_management_item_image'
       ORDER BY order_column ASC LIMIT 1`,
            [itemId]
        );

        if (media) {
            const config = require('../config/config');
            const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
            return `${baseUrl}/storage/${media.id}/${media.file_name}`;
        }
        return null;
    } catch (error) {
        console.error('Error fetching food item image:', error.message);
        return null;
    }
};

// 2. Get Food & Beverages for a Theater
const getFoodBeverages = async (req, res) => {
    try {
        console.log('========== GET FOOD & BEVERAGES ==========');
        const { theater_id } = req.params;
        const { lang = 'en' } = req.query;

        if (!theater_id) {
            return errorResponse(res, 'Theater ID is required', 400);
        }

        // Get food items for this theater
        const foodItems = await db.query(
            `SELECT id, item_name, price, in_stock 
       FROM food_and_beverage_managements 
       WHERE theater_id = ? 
       AND status = '1' 
       AND deleted_at IS NULL
       ORDER BY item_name ASC`,
            [theater_id]
        );

        if (!foodItems || foodItems.length === 0) {
            return successResponse(res, 'No food items available', []);
        }

        // Format response with translations and images
        const result = await Promise.all(
            foodItems.map(async (item) => {
                // Get translation
                const translation = await db.queryOne(
                    `SELECT ft.item_name, ft.description
           FROM food_and_beverage_management_translations ft
           JOIN languages l ON ft.language_id = l.id
           WHERE ft.food_and_beverage_management_id = ? 
           AND l.code = ? 
           AND l.is_active = 1`,
                    [item.id, lang]
                );

                // Get image
                const imageUrl = await getFoodItemImageUrl(item.id);

                return {
                    id: item.id,
                    name: translation?.item_name || item.item_name,
                    description: translation?.description || null,
                    price: parseFloat(item.price),
                    in_stock: item.in_stock === 1,
                    image_url: imageUrl
                };
            })
        );

        // Filter only in-stock items
        const inStockItems = result.filter(item => item.in_stock);

        return successResponse(res, 'Food & beverages fetched successfully', inStockItems);

    } catch (error) {
        console.error('Get Food & Beverages Error:', error);
        return errorResponse(res, 'Failed to fetch food & beverages', 500);
    }
};

// 3. Get Available Coupons
const getCoupons = async (req, res) => {
    try {
        console.log('========== GET COUPONS ==========');
        const { lang = 'en' } = req.query;

        // Get active coupons within date range
        const coupons = await db.query(
            `SELECT 
        id,
        coupon_code,
        campaign_title,
        description,
        discount_type,
        discount_value,
        max_discount_amount,
        min_discount_amount,
        start_date,
        end_date,
        total_usage_limit,
        limit_per_user
      FROM coupon_managements
      WHERE status = '1'
      AND start_date <= CURDATE()
      AND end_date >= CURDATE()
      AND deleted_at IS NULL
      ORDER BY discount_value DESC`,
            []
        );

        if (!coupons || coupons.length === 0) {
            return successResponse(res, 'No coupons available', []);
        }

        // Format response
        const result = coupons.map(coupon => {
            // Discount type: 0 = Percentage, 1 = Flat Amount
            const isPercentage = coupon.discount_type === '0';

            return {
                id: coupon.id,
                coupon_code: coupon.coupon_code,
                title: coupon.campaign_title,
                description: coupon.description,
                discount_type: isPercentage ? 'percentage' : 'flat',
                discount_value: parseFloat(coupon.discount_value),
                max_discount: coupon.max_discount_amount ? parseFloat(coupon.max_discount_amount) : null,
                min_order_value: coupon.min_discount_amount ? parseFloat(coupon.min_discount_amount) : null,
                valid_until: coupon.end_date ? new Date(coupon.end_date).toISOString().split('T')[0] : null,
                usage_limit_per_user: coupon.limit_per_user ? parseInt(coupon.limit_per_user) : null
            };
        });

        return successResponse(res, 'Coupons fetched successfully', result);

    } catch (error) {
        console.error('Get Coupons Error:', error);
        return errorResponse(res, 'Failed to fetch coupons', 500);
    }
};

// 4. Calculate Booking Price (Review Booking Screen)
const calculatePrice = async (req, res) => {
    try {
        console.log('========== CALCULATE BOOKING PRICE ==========');

        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required. Please login to continue.', 401);
        }

        const userId = req.user.id;
        const { schedule_id, seats, food_items, coupon_code, use_loyalty_points } = req.body;

        // Validate required fields
        if (!schedule_id || !seats || !Array.isArray(seats) || seats.length === 0) {
            return errorResponse(res, 'Schedule ID and seats are required', 400);
        }

        // Get schedule with movie details
        const schedule = await db.queryOne(
            `SELECT 
        schm.id,
        schm.show_date,
        schm.show_time,
        schm.experience_format,
        sm.id as movie_id,
        sm.movie_title,
        sm.pricing_data,
        sm.languages,
        sm.cbfc_rating,
        sm.rating_advice,
        slb.screen,
        slb.layout_data,
        t.id as theater_id,
        t.theater_name,
        t.full_address
      FROM schedule_managements schm
      JOIN show_managements sm ON schm.movie_id = sm.id
      JOIN seat_layout_builders slb ON schm.screen_id = slb.id
      JOIN theaters t ON sm.theaters_id = t.id
      WHERE schm.id = ?
      AND schm.status = '1'
      AND schm.deleted_at IS NULL`,
            [schedule_id]
        );

        if (!schedule) {
            return errorResponse(res, 'Schedule not found', 404);
        }

        // Get movie poster URL
        const posterMedia = await db.queryOne(
            `SELECT id, file_name FROM media 
       WHERE model_type = 'App\\\\Models\\\\ShowManagement' 
       AND model_id = ? 
       AND collection_name = 'show_management_movie_poster'
       ORDER BY order_column ASC LIMIT 1`,
            [schedule.movie_id]
        );

        let posterUrl = null;
        if (posterMedia) {
            const config = require('../config/config');
            const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
            posterUrl = `${baseUrl}/storage/${posterMedia.id}/${posterMedia.file_name}`;
        }

        // Get user's loyalty points
        const user = await db.queryOne(
            'SELECT loyality_points FROM users_profiles WHERE id = ?',
            [userId]
        );
        const availableLoyaltyPoints = user?.loyality_points ? parseFloat(user.loyality_points) : 0;

        // Parse layout data to get seat categories
        const layoutData = safeJSONParse(schedule.layout_data, 'layout_data', []);
        const pricingData = safeJSONParse(schedule.pricing_data, 'pricing_data', {});

        // Determine price type (base/weekend/holiday)
        const scheduleDate = new Date(schedule.show_date);
        const dayOfWeek = scheduleDate.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const isHoliday = false; // TODO: Check holidays

        // Calculate ticket price
        let ticketPrice = 0;
        const seatDetails = [];

        for (const seatNumber of seats) {
            const seat = layoutData.find(s => s.seat_number === seatNumber);
            if (!seat) {
                return errorResponse(res, `Seat ${seatNumber} not found`, 400);
            }

            // Get category name
            const categoryResult = await db.queryOne(
                'SELECT category FROM pricing_managements WHERE id = ?',
                [seat.category_id]
            );
            const categoryName = categoryResult?.category || 'Regular';
            const categoryKey = categoryName.toLowerCase();

            // Get price
            const categoryPricing = pricingData[categoryKey];
            let price = 0;
            if (categoryPricing) {
                if (isHoliday && categoryPricing.holiday_price) {
                    price = parseFloat(categoryPricing.holiday_price);
                } else if (isWeekend && categoryPricing.weekend_price) {
                    price = parseFloat(categoryPricing.weekend_price);
                } else {
                    price = parseFloat(categoryPricing.base_price);
                }
            }

            ticketPrice += price;
            seatDetails.push({
                seat_number: seatNumber,
                category: categoryName,
                price: price
            });
        }

        // Calculate food price
        let foodPrice = 0;
        const foodDetails = [];

        if (food_items && Array.isArray(food_items) && food_items.length > 0) {
            for (const item of food_items) {
                const foodItem = await db.queryOne(
                    'SELECT id, item_name, price FROM food_and_beverage_managements WHERE id = ? AND theater_id = ?',
                    [item.id, schedule.theater_id]
                );

                if (foodItem) {
                    const itemTotal = parseFloat(foodItem.price) * parseInt(item.quantity);
                    foodPrice += itemTotal;
                    foodDetails.push({
                        id: foodItem.id,
                        name: foodItem.item_name,
                        quantity: parseInt(item.quantity),
                        price: parseFloat(foodItem.price),
                        total: itemTotal
                    });
                }
            }
        }

        // Calculate platform fee (flat 18 rupees)
        const platformFee = 18;

        // Subtotal before coupon
        const subtotal = ticketPrice + foodPrice + platformFee;

        // Apply coupon if provided
        let couponDiscount = 0;
        let couponInfo = null;

        if (coupon_code) {
            const coupon = await db.queryOne(
                `SELECT * FROM coupon_managements 
         WHERE coupon_code = ? 
         AND status = '1'
         AND start_date <= CURDATE()
         AND end_date >= CURDATE()
         AND deleted_at IS NULL`,
                [coupon_code]
            );

            if (coupon) {
                // Check min order value
                const minOrderValue = coupon.min_discount_amount ? parseFloat(coupon.min_discount_amount) : 0;
                if (subtotal >= minOrderValue) {
                    // Calculate discount
                    if (coupon.discount_type === '0') {
                        // Percentage
                        couponDiscount = (subtotal * parseFloat(coupon.discount_value)) / 100;
                        if (coupon.max_discount_amount) {
                            couponDiscount = Math.min(couponDiscount, parseFloat(coupon.max_discount_amount));
                        }
                    } else {
                        // Flat amount
                        couponDiscount = parseFloat(coupon.discount_value);
                    }

                    couponInfo = {
                        code: coupon.coupon_code,
                        discount: couponDiscount
                    };
                }
            }
        }

        let loyaltyPointsUsed = 0;
        if (use_loyalty_points && availableLoyaltyPoints > 0) {
            loyaltyPointsUsed = Math.min(availableLoyaltyPoints, subtotal - couponDiscount);
        }

        // Calculate GST (18%)
        const amountAfterDiscount = subtotal - couponDiscount - loyaltyPointsUsed;
        const gst = amountAfterDiscount * 0.18;

        // Total amount
        const totalAmount = amountAfterDiscount + gst;

        // Parse movie languages
        const movieLanguages = safeJSONParse(schedule.languages, 'movie_languages', []);

        return successResponse(res, 'Price calculated successfully', {
            movie_info: {
                title: schedule.movie_title,
                languages: movieLanguages,
                format: schedule.experience_format,
                rating: schedule.rating_advice || schedule.cbfc_rating || 'UA',
                poster_url: posterUrl
            },
            theater_info: {
                name: schedule.theater_name,
                address: schedule.full_address,
                screen: schedule.screen
            },
            show_info: {
                date: schedule.show_date ? new Date(schedule.show_date).toISOString().split('T')[0] : null,
                time: schedule.show_time
            },
            seats: seatDetails,
            food_items: foodDetails,
            pricing: {
                ticket_price: ticketPrice,
                food_price: foodPrice,
                platform_fee: platformFee,
                subtotal: subtotal,
                coupon_discount: couponDiscount,
                loyalty_points_used: loyaltyPointsUsed,
                gst: parseFloat(gst.toFixed(2)),
                total: parseFloat(totalAmount.toFixed(2))
            },
            coupon_info: couponInfo,
            loyalty: {
                available_points: availableLoyaltyPoints,
                points_used: loyaltyPointsUsed,
            }
        });

    } catch (error) {
        console.error('Calculate Price Error:', error);
        return errorResponse(res, 'Failed to calculate price', 500);
    }
};

// 5. Create Razorpay Order
const createOrder = async (req, res) => {
    try {
        console.log('========== CREATE RAZORPAY ORDER ==========');

        // Check if user is authenticated
        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required. Please login to continue.', 401);
        }

        const userId = req.user.id;
        const { schedule_id, seats, food_items, coupon_code, use_loyalty_points } = req.body;

        // Validate required fields
        if (!schedule_id || !seats || !Array.isArray(seats) || seats.length === 0) {
            return errorResponse(res, 'Schedule ID and seats are required', 400);
        }

        // Auto-lock seats when creating order (15 minutes)
        for (const seat of seats) {
            await db.query(
                `INSERT INTO seat_locks (schedule_id, seat_number, user_id, locked_at, expires_at)
                 VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE))
                 ON DUPLICATE KEY UPDATE 
                    user_id = VALUES(user_id),
                    locked_at = VALUES(locked_at),
                    expires_at = VALUES(expires_at)`,
                [schedule_id, seat, userId]
            );
        }

        // Import utilities
        const razorpayUtil = require('../utils/razorpay');
        const bookingHelper = require('../utils/bookingHelper');

        // Get schedule details
        const schedule = await db.queryOne(
            `SELECT 
        schm.id,
        schm.show_date,
        schm.show_time,
        sm.id as movie_id,
        sm.movie_title,
        sm.pricing_data,
        slb.layout_data,
        slb.seat_allocation,
        slb.screen,
        t.id as theater_id,
        t.theater_name
      FROM schedule_managements schm
      JOIN show_managements sm ON schm.movie_id = sm.id
      JOIN seat_layout_builders slb ON schm.screen_id = slb.id
      JOIN theaters t ON sm.theaters_id = t.id
      WHERE schm.id = ?
      AND schm.status = '1'
      AND schm.deleted_at IS NULL`,
            [schedule_id]
        );

        if (!schedule) {
            return errorResponse(res, 'Schedule not found', 404);
        }

        // Check seat availability
        const layoutData = safeJSONParse(schedule.layout_data, 'layout_data', []);
        const seatAllocation = safeJSONParse(schedule.seat_allocation, 'seat_allocation', {});
        const onlineSeats = seatAllocation.online_seats || [];

        // Get already booked seats
        const bookings = await db.query(
            `SELECT seats_booked FROM theater_bookings 
       WHERE schedule_id = ? 
       AND status IN (1, 3)
       AND deleted_at IS NULL`,
            [schedule_id]
        );

        const bookedSeats = [];
        bookings.forEach(booking => {
            const seats_data = safeJSONParse(booking.seats_booked, 'seats_booked', []);
            seats_data.forEach(seat => {
                if (seat.id || seat.seat_number) {
                    bookedSeats.push(seat.id || seat.seat_number);
                }
            });
        });

        // Check if requested seats are available
        const unavailableSeats = [];
        for (const seatNumber of seats) {
            if (!onlineSeats.includes(seatNumber)) {
                unavailableSeats.push(seatNumber);
            } else if (bookedSeats.includes(seatNumber)) {
                unavailableSeats.push(seatNumber);
            }
        }

        if (unavailableSeats.length > 0) {
            return errorResponse(res, `Seats not available: ${unavailableSeats.join(', ')}`, 400);
        }

        // Calculate pricing (reuse existing logic)
        const pricingData = safeJSONParse(schedule.pricing_data, 'pricing_data', {});
        const scheduleDate = new Date(schedule.show_date);
        const dayOfWeek = scheduleDate.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const isHoliday = false;

        // Calculate ticket price
        let ticketPrice = 0;
        const seatDetails = [];

        for (const seatNumber of seats) {
            const seat = layoutData.find(s => s.seat_number === seatNumber);
            if (!seat) continue;

            const categoryResult = await db.queryOne(
                'SELECT category FROM pricing_managements WHERE id = ?',
                [seat.category_id]
            );
            const categoryName = categoryResult?.category || 'Regular';
            const categoryKey = categoryName.toLowerCase();

            const categoryPricing = pricingData[categoryKey];
            let price = 0;
            if (categoryPricing) {
                if (isHoliday && categoryPricing.holiday_price) {
                    price = parseFloat(categoryPricing.holiday_price);
                } else if (isWeekend && categoryPricing.weekend_price) {
                    price = parseFloat(categoryPricing.weekend_price);
                } else {
                    price = parseFloat(categoryPricing.base_price);
                }
            }

            ticketPrice += price;
            seatDetails.push({
                id: seatNumber,  // For Laravel counter booking compatibility
                seat_number: seatNumber,
                category: categoryName,
                price: price
            });
        }

        // Calculate food price
        let foodPrice = 0;
        const foodDetails = [];

        if (food_items && Array.isArray(food_items) && food_items.length > 0) {
            for (const item of food_items) {
                const foodItem = await db.queryOne(
                    'SELECT id, item_name, price FROM food_and_beverage_managements WHERE id = ? AND theater_id = ?',
                    [item.id, schedule.theater_id]
                );

                if (foodItem) {
                    const itemTotal = parseFloat(foodItem.price) * parseInt(item.quantity);
                    foodPrice += itemTotal;
                    foodDetails.push({
                        id: foodItem.id,
                        name: foodItem.item_name,
                        quantity: parseInt(item.quantity),
                        price: parseFloat(foodItem.price),
                        total: itemTotal
                    });
                }
            }
        }

        // Platform fee
        const platformFee = 18;
        const subtotal = ticketPrice + foodPrice + platformFee;

        // Apply coupon
        let couponDiscount = 0;
        if (coupon_code) {
            const coupon = await db.queryOne(
                `SELECT * FROM coupon_managements 
         WHERE coupon_code = ? 
         AND status = '1'
         AND start_date <= CURDATE()
         AND end_date >= CURDATE()
         AND deleted_at IS NULL`,
                [coupon_code]
            );

            if (coupon) {
                const minOrderValue = coupon.min_discount_amount ? parseFloat(coupon.min_discount_amount) : 0;
                if (subtotal >= minOrderValue) {
                    if (coupon.discount_type === '0') {
                        couponDiscount = (subtotal * parseFloat(coupon.discount_value)) / 100;
                        if (coupon.max_discount_amount) {
                            couponDiscount = Math.min(couponDiscount, parseFloat(coupon.max_discount_amount));
                        }
                    } else {
                        couponDiscount = parseFloat(coupon.discount_value);
                    }
                }
            }
        }

        // Loyalty points
        let loyaltyPointsUsed = 0;
        if (use_loyalty_points) {
            const user = await db.queryOne(
                'SELECT loyality_points FROM users_profiles WHERE id = ?',
                [userId]
            );
            const availablePoints = user?.loyality_points ? parseFloat(user.loyality_points) : 0;
            if (availablePoints > 0) {
                loyaltyPointsUsed = Math.min(availablePoints, subtotal - couponDiscount);
            }
        }

        // Calculate GST and total
        const amountAfterDiscount = subtotal - couponDiscount - loyaltyPointsUsed;
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
                schedule_id: schedule_id,
                seats: seats.join(','),
                movie: schedule.movie_title,
                booking_number: bookingNumber
            }
        );

        // Create PENDING booking in database
        const bookingResult = await db.query(
            `INSERT INTO theater_bookings 
       (schedule_id, booking, booking_type, customer_name, customer_mobile, 
        user_information, movie, screen, qty, total_amount, date, show_time, 
        payment_information, payment_method, seats_booked, status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                schedule_id,
                bookingNumber,
                'online',
                user?.full_name || 'Guest',
                user?.phone_number || '',
                JSON.stringify({
                    user_id: userId,
                    email: user?.email_address || '',
                    phone: user?.phone_number || ''
                }),
                schedule.movie_title,
                schedule.screen,
                seats.length,
                totalAmount,
                bookingHelper.formatDate(schedule.show_date),
                schedule.show_time,
                JSON.stringify({
                    razorpay_order_id: razorpayOrder.id,
                    amount: totalAmount,
                    payment_status: 'pending'
                }),
                'razorpay',
                JSON.stringify(seatDetails),
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
                    schedule_id: schedule_id,
                    seats: seats,
                    seat_details: seatDetails,
                    food_items: foodDetails,
                    coupon_code: coupon_code || null,
                    coupon_discount: couponDiscount,
                    loyalty_points_used: loyaltyPointsUsed,
                    pricing: {
                        ticket_price: ticketPrice,
                        food_price: foodPrice,
                        platform_fee: platformFee,
                        subtotal: subtotal,
                        gst: parseFloat(gst.toFixed(2)),
                        total: parseFloat(totalAmount.toFixed(2))
                    },
                    movie_title: schedule.movie_title,
                    theater_name: schedule.theater_name,
                    screen: schedule.screen,
                    show_date: bookingHelper.formatDate(schedule.show_date),
                    show_time: bookingHelper.formatTime(schedule.show_time)
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
                movie_title: schedule.movie_title,
                theater_name: schedule.theater_name,
                screen: schedule.screen,
                show_date: bookingHelper.formatDate(schedule.show_date),
                show_time: bookingHelper.formatTime(schedule.show_time),
                seats: seats,
                total_seats: seats.length,
                total_amount: parseFloat(totalAmount.toFixed(2))
            },
            payment_breakdown: {
                ticket_price: ticketPrice,
                food_price: foodPrice,
                platform_fee: platformFee,
                subtotal: subtotal,
                coupon_discount: couponDiscount,
                loyalty_points_used: loyaltyPointsUsed,
                gst: parseFloat(gst.toFixed(2)),
                total: parseFloat(totalAmount.toFixed(2))
            }
        });

    } catch (error) {
        console.error('Create Order Error:', error);
        return errorResponse(res, 'Failed to create order: ' + error.message, 500);
    }
};

// 6. Verify Payment and Update Booking
const verifyPayment = async (req, res) => {
    let connection = null;

    try {
        console.log('========== VERIFY PAYMENT & UPDATE BOOKING ==========');

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
            'SELECT * FROM theater_bookings WHERE id = ?',
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
            `UPDATE theater_bookings 
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
                    coupon_code: bookingData.coupon_code || null,
                    coupon_discount: bookingData.coupon_discount || 0,
                    loyalty_points_used: bookingData.loyalty_points_used || 0,
                    food_items: bookingData.food_items || []
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

        // Release seat locks after successful payment
        await db.query(
            'DELETE FROM seat_locks WHERE schedule_id = ? AND user_id = ?',
            [bookingData.schedule_id, userId]
        );

        console.log(`✅ Released seat locks for user ${userId} after successful payment`);

        // Generate QR code and save via Laravel API
        const qrData = bookingHelper.createBookingQRData({
            booking_number: booking.booking,
            booking_id: bookingId,
            movie_title: bookingData.movie_title,
            seats: bookingData.seats,
            show_date: bookingData.show_date,
            show_time: bookingData.show_time
        });
        const qrCodeUrl = await bookingHelper.saveQRCodeToFile(qrData, booking.booking);

        return successResponse(res, 'Booking confirmed successfully', {
            booking_id: bookingId,
            booking_number: booking.booking,
            status: 'confirmed',
            qr_code_url: qrCodeUrl,
            booking_details: {
                movie_title: bookingData.movie_title,
                theater_name: bookingData.theater_name,
                screen: bookingData.screen,
                show_date: bookingData.show_date,
                show_time: bookingData.show_time,
                seats: bookingData.seat_details || [],
                food_items: bookingData.food_items || [],
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
        console.error('Verify Payment Error:', error);
        return errorResponse(res, 'Failed to verify payment: ' + error.message, 500);
    }
};

// 7. Get My Bookings
const getMyBookings = async (req, res) => {
    try {
        console.log('========== GET MY BOOKINGS ==========');

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
            `SELECT COUNT(*) as total FROM theater_bookings ${whereClause}`,
            params
        );

        // Get bookings with schedule_id to fetch movie_id
        const bookings = await db.query(
            `SELECT 
        id as booking_id,
        booking as booking_number,
        schedule_id,
        movie,
        screen,
        date as show_date,
        show_time,
        seats_booked,
        total_amount,
        status,
        created_at as booking_date
       FROM theater_bookings 
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // Format bookings with translations
        const formattedBookings = await Promise.all(bookings.map(async (booking) => {
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
                case 3:
                    statusLabel = 'completed';
                    break;
                default:
                    statusLabel = 'unknown';
            }

            // Get movie_id from schedule
            let movieTitle = booking.movie;
            if (booking.schedule_id) {
                const schedule = await db.queryOne(
                    'SELECT movie_id FROM schedule_managements WHERE id = ?',
                    [booking.schedule_id]
                );

                if (schedule && schedule.movie_id) {
                    const movieTranslation = await getMovieTranslation(schedule.movie_id, language);
                    movieTitle = movieTranslation?.movie_title || booking.movie;
                }
            }

            // Parse seats safely
            let seats = [];
            try {
                const parsedSeats = safeJSONParse(booking.seats_booked, 'seats_booked', []);
                seats = Array.isArray(parsedSeats) ? parsedSeats.map(s => s.seat_number || s.id) : [];
            } catch (e) {
                console.error('Error parsing seats_booked in list:', e);
            }

            return {
                booking_id: booking.booking_id,
                booking_number: booking.booking_number,
                movie_title: movieTitle,
                screen: booking.screen,
                show_date: bookingHelper.formatDate(booking.show_date),
                show_time: bookingHelper.formatTime(booking.show_time),
                seats: seats,
                total_amount: parseFloat(booking.total_amount),
                status: statusLabel,
                booking_date: bookingHelper.formatDate(booking.booking_date)
            };
        }));

        return successResponse(res, 'Bookings fetched successfully', {
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
        console.error('Get My Bookings Error:', error);
        return errorResponse(res, 'Failed to fetch bookings', 500);
    }
};

// 8. Get Booking Details
const getBookingDetails = async (req, res) => {
    try {
        console.log('========== GET BOOKING DETAILS ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const userId = req.user.id;
        const { booking_id } = req.params;
        const { language = 'kn' } = req.query;

        const booking = await db.queryOne(
            `SELECT 
        tb.*,
        sm.id as movie_id,
        sm.movie_title,
        t.id as theater_id,
        t.theater_name,
        t.full_address
       FROM theater_bookings tb
       LEFT JOIN schedule_managements schm ON tb.schedule_id = schm.id
       LEFT JOIN show_managements sm ON schm.movie_id = sm.id
       LEFT JOIN theaters t ON sm.theaters_id = t.id
       WHERE tb.id = ? 
       AND JSON_EXTRACT(tb.user_information, "$.user_id") = ?
       AND tb.deleted_at IS NULL`,
            [booking_id, userId]
        );

        if (!booking) {
            return errorResponse(res, 'Booking not found', 404);
        }

        const bookingHelper = require('../utils/bookingHelper');

        // Get translations
        const movieTranslation = await getMovieTranslation(booking.movie_id, language);
        const theaterTranslation = await getTheaterTranslation(booking.theater_id, language);

        // Parse JSON fields safely
        let seatsBooked = [];
        try {
            const parsedSeats = safeJSONParse(booking.seats_booked, 'seats_booked', []);
            seatsBooked = Array.isArray(parsedSeats) ? parsedSeats : [];
        } catch (e) {
            console.error('Error parsing seats_booked:', e);
            seatsBooked = [];
        }

        let paymentInfo = {};
        try {
            const parsedPayment = safeJSONParse(booking.payment_information, 'payment_information', {});
            paymentInfo = (parsedPayment && typeof parsedPayment === 'object') ? parsedPayment : {};
        } catch (e) {
            console.error('Error parsing payment_information:', e);
            paymentInfo = {};
        }

        // Generate QR code and save via Laravel API
        const qrData = bookingHelper.createBookingQRData({
            booking_number: booking.booking,
            booking_id: booking.id,
            movie_title: booking.movie_title || booking.movie,
            seats: seatsBooked.map(s => s.seat_number || s.id),
            show_date: booking.date,
            show_time: booking.show_time
        });
        const qrCodeUrl = await bookingHelper.saveQRCodeToFile(qrData, booking.booking);

        // Get movie poster
        const posterMedia = await db.queryOne(
            `SELECT id, file_name FROM media 
       WHERE model_type = 'App\\\\Models\\\\ShowManagement' 
       AND model_id = (SELECT movie_id FROM schedule_managements WHERE id = ?)
       AND collection_name = 'show_management_movie_poster'
       ORDER BY order_column ASC LIMIT 1`,
            [booking.schedule_id]
        );

        let posterUrl = null;
        if (posterMedia) {
            const config = require('../config/config');
            const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
            posterUrl = `${baseUrl}/storage/${posterMedia.id}/${posterMedia.file_name}`;
        }

        // Map status code to label
        const statusCode = parseInt(booking.status);
        let statusLabel = 'unknown';
        switch (statusCode) {
            case 0: statusLabel = 'pending'; break;
            case 1: statusLabel = 'confirmed'; break;
            case 2: statusLabel = 'cancelled'; break;
            case 3: statusLabel = 'completed'; break;
            default: statusLabel = 'unknown';
        }

        return successResponse(res, 'Booking details fetched successfully', {
            booking_id: booking.id,
            booking_number: booking.booking,
            status: statusLabel,
            qr_code_url: qrCodeUrl,
            movie_info: {
                title: movieTranslation?.movie_title || booking.movie_title || booking.movie,
                poster_url: posterUrl
            },
            theater_info: {
                name: theaterTranslation?.theater_name || booking.theater_name,
                address: theaterTranslation?.address || booking.full_address,
                screen: booking.screen
            },
            show_info: {
                date: bookingHelper.formatDate(booking.date),
                time: bookingHelper.formatTime(booking.show_time)
            },
            seats: seatsBooked,
            food_items: paymentInfo.food_items || [],
            payment_info: {
                razorpay_payment_id: paymentInfo.razorpay_payment_id,
                amount_paid: parseFloat(booking.total_amount),
                payment_method: booking.payment_method
            },
            pricing: {
                total: parseFloat(booking.total_amount),
                coupon_discount: paymentInfo.coupon_discount || 0,
                loyalty_points_used: paymentInfo.loyalty_points_used || 0
            },
            booking_date: bookingHelper.formatDate(booking.created_at)
        });

    } catch (error) {
        console.error('Get Booking Details Error:', error);
        return errorResponse(res, 'Failed to fetch booking details', 500);
    }
};

// 9. Test Verify Success (Generate test credentials)
const testVerifySuccess = async (req, res) => {
    try {
        console.log('========== TEST VERIFY SUCCESS - GENERATE CREDENTIALS ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const { razorpay_order_id } = req.body;

        if (!razorpay_order_id) {
            return errorResponse(res, 'razorpay_order_id is required', 400);
        }

        // Generate test payment ID and signature
        const test_payment_id = `pay_test_${Date.now()}`;
        const test_signature = `test_sig_${Date.now()}`;

        return successResponse(res, 'Test payment credentials generated', {
            razorpay_order_id: razorpay_order_id,
            razorpay_payment_id: test_payment_id,
            razorpay_signature: test_signature,
            instructions: 'Use these credentials in the verify-payment API to complete the booking'
        });

    } catch (error) {
        console.error('Test Verify Success Error:', error);
        return errorResponse(res, 'Test failed: ' + error.message, 500);
    }
};

// 10. Test Verify Payment Failure (Simulates failed payment)
const testVerifyFailure = async (req, res) => {
    try {
        console.log('========== TEST VERIFY PAYMENT FAILURE ==========');

        if (!req.user || !req.user.id) {
            return errorResponse(res, 'Authentication required', 401);
        }

        const { razorpay_order_id } = req.body;

        if (!razorpay_order_id) {
            return errorResponse(res, 'razorpay_order_id is required', 400);
        }

        // Update payment transaction as failed
        await db.query(
            `UPDATE payment_transactions 
       SET status = 'failed', error_description = 'Test: Payment failed by user', updated_at = NOW() 
       WHERE razorpay_order_id = ?`,
            [razorpay_order_id]
        );

        // Update booking as cancelled
        await db.query(
            `UPDATE theater_bookings 
       SET status = 2, updated_at = NOW() 
       WHERE booking IN (
         SELECT booking FROM (
           SELECT tb.booking 
           FROM theater_bookings tb
           JOIN payment_transactions pt ON tb.id = pt.booking_id
           WHERE pt.razorpay_order_id = ?
         ) AS temp
       )`,
            [razorpay_order_id]
        );

        return successResponse(res, 'Payment marked as failed (Test)', {
            razorpay_order_id: razorpay_order_id,
            status: 'failed',
            message: 'Payment failed - Booking cancelled'
        });

    } catch (error) {
        console.error('Test Verify Failure Error:', error);
        return errorResponse(res, 'Test failed: ' + error.message, 500);
    }
};

module.exports = {
    getSeatLayout,
    lockSeats,
    unlockSeats,
    getFoodBeverages,
    getCoupons,
    calculatePrice,
    createOrder,
    verifyPayment,
    getMyBookings,
    getBookingDetails,
    testVerifySuccess,
    testVerifyFailure,
    cleanupPendingBookings
};