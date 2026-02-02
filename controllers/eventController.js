const db = require('../config/db');
const config = require('../config/config');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// Helper function to get event poster URL
const getEventPosterUrl = async (eventId) => {
    try {
        const media = await db.queryOne(
            `SELECT id, file_name FROM media 
       WHERE model_type = 'App\\\\Models\\\\EventDetail' 
       AND model_id = ? 
       AND collection_name = 'event_detail_poster_images'
       ORDER BY id ASC LIMIT 1`,
            [eventId]
        );

        if (media) {
            const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
            return `${baseUrl}/storage/${media.id}/${media.file_name}`;
        }
        return null;
    } catch (error) {
        console.error('Error fetching event poster:', error.message);
        return null;
    }
};

// Helper function to get event translation
const getEventTranslation = async (eventId, languageCode = 'kn') => {
    try {
        const translation = await db.queryOne(
            `SELECT et.*, l.code as language_code
       FROM event_detail_translations et
       JOIN languages l ON et.language_id = l.id
       WHERE et.event_detail_id = ? AND l.code = ? AND l.is_active = 1`,
            [eventId, languageCode]
        );
        return translation;
    } catch (error) {
        console.error('Error fetching translation:', error.message);
        return null;
    }
};

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

                if (!content) return [];

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

// 1. Get Events List with Filters
const getEvents = async (req, res) => {
    try {
        console.log('========== GET EVENTS ==========');

        const language = req.query.language || 'en';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Filters
        const dateFilter = req.query.date_filter; // today, tomorrow, this_week, custom
        const fromDate = req.query.from_date;
        const toDate = req.query.to_date;
        const eventType = req.query.event_type;
        const city = req.query.city;

        // Build WHERE clause
        let whereConditions = ["ed.status = '1'", "ed.deleted_at IS NULL"];
        let params = [];

        // Date filtering
        if (dateFilter === 'today') {
            whereConditions.push('DATE(ed.start_date_time) = CURDATE()');
        } else if (dateFilter === 'tomorrow') {
            whereConditions.push('DATE(ed.start_date_time) = DATE_ADD(CURDATE(), INTERVAL 1 DAY)');
        } else if (dateFilter === 'this_week') {
            whereConditions.push('YEARWEEK(ed.start_date_time, 1) = YEARWEEK(CURDATE(), 1)');
        } else if (dateFilter === 'custom' && fromDate && toDate) {
            whereConditions.push('DATE(ed.start_date_time) BETWEEN ? AND ?');
            params.push(fromDate, toDate);
        }

        // Event type filter
        if (eventType) {
            whereConditions.push('ed.event_type = ?');
            params.push(eventType);
        }

        // City filter
        if (city) {
            whereConditions.push('ed.city = ?');
            params.push(city);
        }

        const whereClause = whereConditions.join(' AND ');

        // Get total count
        const countResult = await db.queryOne(
            `SELECT COUNT(*) as total
       FROM event_details ed
       WHERE ${whereClause}`,
            params
        );

        const totalEvents = countResult?.total || 0;
        const totalPages = Math.ceil(totalEvents / limit);

        // Get events
        const events = await db.query(
            `SELECT 
        ed.id,
        ed.event_name,
        ed.venue_name,
        ed.address,
        ed.start_date_time
      FROM event_details ed
      WHERE ${whereClause}
      ORDER BY ed.start_date_time ASC
      LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        if (!events || events.length === 0) {
            return successResponse(res, 'No events found', {
                events: [],
                pagination: {
                    current_page: page,
                    total_pages: 0,
                    total_items: 0,
                    items_per_page: limit,
                    has_next: false,
                    has_previous: false
                }
            });
        }

        // Format events with translations
        const result = await Promise.all(
            events.map(async (event) => {
                const translation = await getEventTranslation(event.id, language);
                const posterUrl = await getEventPosterUrl(event.id);

                // Format date
                const startDate = new Date(event.start_date_time);
                const formattedDate = startDate.toISOString().split('T')[0];

                return {
                    id: event.id,
                    event_name: translation?.event_name || event.event_name,
                    event_type: event.event_type,
                    venue_name: event.venue_name,
                    address: translation?.address || event.address,
                    start_date: formattedDate,
                    poster_url: posterUrl,
                    price_range: '₹999 onwards' // This should be dynamic based on your logic
                };
            })
        );

        return successResponse(res, 'Events fetched successfully', {
            events: result,
            pagination: {
                current_page: page,
                total_pages: totalPages,
                total_items: totalEvents,
                items_per_page: limit,
                has_next: page < totalPages,
                has_previous: page > 1
            }
        });

    } catch (error) {
        console.error('Get Events Error:', error);
        return errorResponse(res, 'Failed to fetch events', 500);
    }
};

// 2. Get Event Details
const getEventDetails = async (req, res) => {
    try {
        console.log('========== GET EVENT DETAILS ==========');

        const { event_id } = req.params;
        const language = req.query.language || 'en';

        const event = await db.queryOne(
            `SELECT 
        ed.*
      FROM event_details ed
      WHERE ed.id = ? AND ed.status = '1' AND ed.deleted_at IS NULL`,
            [event_id]
        );

        if (!event) {
            return errorResponse(res, 'Event not found', 404);
        }

        // Get translation
        const translation = await getEventTranslation(event.id, language);

        // Get all poster images
        const posters = await db.query(
            `SELECT id, file_name FROM media 
       WHERE model_type = 'App\\\\Models\\\\EventDetail' 
       AND model_id = ? 
       AND collection_name = 'event_detail_poster_images'
       ORDER BY id ASC`,
            [event.id]
        );

        const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
        const posterUrls = posters.map(media => `${baseUrl}/storage/${media.id}/${media.file_name}`);

        // Parse artists data
        const artistsData = safeJSONParse(
            translation?.artists_data || event.artists_data,
            'artists_data',
            []
        );

        // Format dates
        const startDate = new Date(event.start_date_time);
        const endDate = new Date(event.end_date_and_time);

        const result = {
            id: event.id,
            event_name: translation?.event_name || event.event_name,
            event_type: event.event_type,
            venue_name: event.venue_name,
            city: translation?.city || event.city,
            address: translation?.address || event.address,
            google_maps_link: event.google_maps_link,
            start_date: startDate.toISOString().split('T')[0],
            start_time: startDate.toTimeString().split(' ')[0].substring(0, 5),
            end_date: endDate.toISOString().split('T')[0],
            end_time: endDate.toTimeString().split(' ')[0].substring(0, 5),
            duration: event.duration,
            description: translation?.description || event.description,
            terms_and_conditions: translation?.terms_and_conditions || event.tc_text,
            total_capacity: event.total_capacity,
            poster_images: posterUrls,
            artists: artistsData
        };

        return successResponse(res, 'Event details fetched successfully', result);

    } catch (error) {
        console.error('Get Event Details Error:', error);
        return errorResponse(res, 'Failed to fetch event details', 500);
    }
};

// 3. Get Event Types (for filter dropdown)
const getEventTypes = async (req, res) => {
    try {
        const types = await db.query(
            `SELECT DISTINCT event_type 
       FROM event_details 
       WHERE event_type IS NOT NULL 
       AND event_type != '' 
       AND status = '1' 
       AND deleted_at IS NULL
       ORDER BY event_type ASC`
        );

        return successResponse(res, 'Event types fetched successfully', types.map(t => t.event_type));
    } catch (error) {
        console.error('Get Event Types Error:', error);
        return errorResponse(res, 'Failed to fetch event types', 500);
    }
};

// 4. Get Cities (for filter dropdown)
const getCities = async (req, res) => {
    try {
        const cities = await db.query(
            `SELECT DISTINCT city 
       FROM event_details 
       WHERE city IS NOT NULL 
       AND city != '' 
       AND status = '1' 
       AND deleted_at IS NULL
       ORDER BY city ASC`
        );

        return successResponse(res, 'Cities fetched successfully', cities.map(c => c.city));
    } catch (error) {
        console.error('Get Cities Error:', error);
        return errorResponse(res, 'Failed to fetch cities', 500);
    }
};

// 5. Get Related Events (You May Also Like)
const getRelatedEvents = async (req, res) => {
    try {
        console.log('========== GET RELATED EVENTS ==========');
        const { id } = req.params;
        const { language = 'en', limit = 10 } = req.query;

        // Get current event's type and city
        const currentEvent = await db.queryOne(
            `SELECT event_type, city FROM event_details WHERE id = ? AND deleted_at IS NULL`,
            [id]
        );

        if (!currentEvent) {
            return errorResponse(res, 'Event not found', 404);
        }

        // Find events with same type or same city, excluding current event
        const relatedEvents = await db.query(
            `SELECT 
                id, event_name, event_type, venue_name, address, start_date_time
            FROM event_details 
            WHERE id != ? 
            AND status = '1' 
            AND deleted_at IS NULL
            AND (event_type = ? OR city = ?)
            AND start_date_time >= CURDATE()
            ORDER BY (event_type = ?) DESC, start_date_time ASC
            LIMIT ?`,
            [id, currentEvent.event_type, currentEvent.city, currentEvent.event_type, parseInt(limit)]
        );

        if (!relatedEvents || relatedEvents.length === 0) {
            return successResponse(res, 'No related events found', []);
        }

        // Format results
        const result = await Promise.all(
            relatedEvents.map(async (event) => {
                const translation = await getEventTranslation(event.id, language);
                const posterUrl = await getEventPosterUrl(event.id);

                const startDate = new Date(event.start_date_time);

                return {
                    id: event.id,
                    event_name: translation?.event_name || event.event_name,
                    event_type: event.event_type,
                    venue_name: event.venue_name,
                    address: translation?.address || event.address,
                    start_date: startDate.toISOString().split('T')[0],
                    poster_url: posterUrl
                };
            })
        );

        return successResponse(res, 'Related events fetched successfully', result);

    } catch (error) {
        console.error('Get Related Events Error:', error);
        return errorResponse(res, 'Failed to fetch related events', 500);
    }
};

module.exports = {
    getEvents,
    getEventDetails,
    getEventTypes,
    getCities,
    getRelatedEvents
};
