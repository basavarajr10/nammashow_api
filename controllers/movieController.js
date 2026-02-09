const db = require('../config/db');
const config = require('../config/config');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// Helper function to get movie poster URL
const getMoviePosterUrl = async (movieId) => {
  try {
    const media = await db.queryOne(
      `SELECT id, file_name FROM media 
       WHERE model_type = 'App\\\\Models\\\\ShowManagement' 
       AND model_id = ? 
       AND collection_name = 'show_management_movie_poster'
       ORDER BY order_column ASC LIMIT 1`,
      [movieId]
    );

    if (media) {
      const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
      return `${baseUrl}/storage/${media.id}/${media.file_name}`;
    }
    return null;
  } catch (error) {
    console.error('Error fetching movie poster:', error.message);
    return null;
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
// 1. Get Now Showing Movies
const getNowShowingMovies = async (req, res) => {
  try {
    console.log('========== GET NOW SHOWING MOVIES ==========');
    const language = req.query.language || 'en';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await db.queryOne(
      `SELECT COUNT(*) as total
      FROM show_managements sm
      WHERE sm.status = '1' 
      AND sm.release_date <= CURDATE()
      AND sm.deleted_at IS NULL`,
      []
    );

    const totalMovies = countResult?.total || 0;
    const totalPages = Math.ceil(totalMovies / limit);

    // Get approved movies with release date <= today (with pagination)
    const movies = await db.query(
      `SELECT 
        sm.id,
        sm.movie_title,
        sm.genres,
        sm.duration,
        sm.release_date,
        sm.cbfc_rating,
        sm.rating_advice,
        sm.languages,
        sm.experience_formats,
        sm.trailer_link,
        sm.status
      FROM show_managements sm
      WHERE sm.status = '1' 
      AND sm.release_date <= CURDATE()
      AND sm.deleted_at IS NULL
      ORDER BY sm.release_date DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (!movies || movies.length === 0) {
      return successResponse(res, 'No movies currently showing', {
        movies: [],
        pagination: {
          current_page: parseInt(page),
          total_pages: 0,
          total_items: 0,
          items_per_page: parseInt(limit),
          has_next: false,
          has_previous: false
        }
      });
    }

    // Format response with translations
    const result = await Promise.all(
      movies.map(async (movie) => {
        // Get translation
        const translation = await getMovieTranslation(movie.id, language);

        // Get poster
        const posterUrl = await getMoviePosterUrl(movie.id);


        // Parse JSON fields safely
        const languages = safeJSONParse(movie.languages, 'languages', []);
        const experienceFormats = safeJSONParse(movie.experience_formats, 'experience_formats', []);

        // Get today's show times preview (2-3 shows)
        const todayShows = await db.query(
          `SELECT 
            schm.id,
            schm.show_time,
            schm.experience_format,
            slb.screen as screen_name
          FROM schedule_managements schm
          JOIN seat_layout_builders slb ON schm.screen_id = slb.id
          WHERE schm.movie_id = ?
          AND schm.show_date = CURDATE()
          AND schm.status = '1'
          AND schm.deleted_at IS NULL
          ORDER BY schm.show_time ASC
          LIMIT 3`,
          [movie.id]
        );

        // Count total shows for today
        const totalShowsResult = await db.queryOne(
          `SELECT COUNT(*) as total 
           FROM schedule_managements 
           WHERE movie_id = ? 
           AND show_date = CURDATE() 
           AND status = '1' 
           AND deleted_at IS NULL`,
          [movie.id]
        );

        return {
          id: movie.id,
          title: translation?.movie_title || movie.movie_title,
          genres: translation?.genres || movie.genres,
          duration: movie.duration,
          rating_advice: translation?.rating_advice || movie.rating_advice,
          languages: languages,
          poster_url: posterUrl,
          trailer_link: movie.trailer_link,
          today_shows: todayShows.map(show => ({
            id: show.id,
            time: show.show_time
          })),
          total_shows_today: totalShowsResult?.total || 0
        };
      })
    );

    return successResponse(res, 'Now showing movies fetched successfully', {
      movies: result,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_items: totalMovies,
        items_per_page: parseInt(limit),
        has_next: parseInt(page) < totalPages,
        has_previous: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Get Now Showing Movies Error:', error);
    return errorResponse(res, 'Failed to fetch now showing movies', 500);
  }
};

// 2. Get Coming Soon Movies
const getComingSoonMovies = async (req, res) => {
  try {
    console.log('========== GET COMING SOON MOVIES ==========');
    const language = req.query.language || 'en';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await db.queryOne(
      `SELECT COUNT(*) as total
      FROM show_managements sm
      WHERE sm.status = '1' 
      AND sm.release_date > CURDATE()
      AND sm.deleted_at IS NULL`,
      []
    );

    const totalMovies = countResult?.total || 0;
    const totalPages = Math.ceil(totalMovies / limit);
    console.log('DEBUG:', { page, limit, offset, pageType: typeof page, limitType: typeof limit, offsetType: typeof offset });

    // Get approved movies with release date > today (with pagination)
    const movies = await db.query(
      `SELECT 
        sm.id,
        sm.movie_title,
        sm.genres,
        sm.duration,
        sm.release_date,
        sm.cbfc_rating,
        sm.rating_advice,
        sm.languages,
        sm.experience_formats,
        sm.trailer_link,
        sm.status
      FROM show_managements sm
      WHERE sm.status = '1' 
      AND sm.release_date > CURDATE()
      AND sm.deleted_at IS NULL
      ORDER BY sm.release_date ASC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    if (!movies || movies.length === 0) {
      return successResponse(res, 'No upcoming movies', {
        movies: [],
        pagination: {
          current_page: parseInt(page),
          total_pages: 0,
          total_items: 0,
          items_per_page: parseInt(limit),
          has_next: false,
          has_previous: false
        }
      });
    }

    // Format response with translations
    const result = await Promise.all(
      movies.map(async (movie) => {
        // Get translation
        const translation = await getMovieTranslation(movie.id, language);

        // Get poster
        const posterUrl = await getMoviePosterUrl(movie.id);

        // Parse JSON fields safely
        const languages = safeJSONParse(movie.languages, 'languages', []);
        const experienceFormats = safeJSONParse(movie.experience_formats, 'experience_formats', []);

        return {
          id: movie.id,
          title: translation?.movie_title || movie.movie_title,
          genres: translation?.genres || movie.genres,
          duration: movie.duration,
          rating_advice: translation?.rating_advice || movie.rating_advice,
          languages: languages,
          release_date: movie.release_date ? new Date(movie.release_date).toISOString().split('T')[0] : null,
          poster_url: posterUrl,
          trailer_link: movie.trailer_link
        };
      })
    );

    return successResponse(res, 'Coming soon movies fetched successfully', {
      movies: result,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_items: totalMovies,
        items_per_page: parseInt(limit),
        has_next: parseInt(page) < totalPages,
        has_previous: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Get Coming Soon Movies Error:', error);
    return errorResponse(res, 'Failed to fetch coming soon movies', 500);
  }
};

// 3. Get Movie Details
const getMovieDetails = async (req, res) => {
  try {
    console.log('========== GET MOVIE DETAILS ==========');
    const { id } = req.params;
    const { language = 'en' } = req.query;

    // Get movie
    const movie = await db.queryOne(
      `SELECT 
        sm.*
      FROM show_managements sm
      WHERE sm.id = ? 
      AND sm.status = '1'
      AND sm.deleted_at IS NULL`,
      [id]
    );

    if (!movie) {
      return errorResponse(res, 'Movie not found', 404);
    }

    // Get translation
    const translation = await getMovieTranslation(movie.id, language);

    // Get poster
    const posterUrl = await getMoviePosterUrl(movie.id);

    // Parse JSON fields safely
    const languages = safeJSONParse(movie.languages, 'languages', []);
    const experienceFormats = safeJSONParse(movie.experience_formats, 'experience_formats', []);
    const castData = translation?.cast_data ? safeJSONParse(translation.cast_data, 'cast_data', []) : safeJSONParse(movie.cast_data, 'cast_data', []);
    const crewData = translation?.crew_data ? safeJSONParse(translation.crew_data, 'crew_data', []) : safeJSONParse(movie.crew_data, 'crew_data', []);

    const result = {
      id: movie.id,
      title: translation?.movie_title || movie.movie_title,
      synopsis: translation?.synopsis || movie.synopsis,
      genres: translation?.genres || movie.genres,
      duration: movie.duration,
      release_date: movie.release_date,
      cbfc_rating: movie.cbfc_rating === '0' ? 'A' : 'U',
      rating_advice: translation?.rating_advice || movie.rating_advice,
      languages: languages,
      experience_formats: experienceFormats,
      poster_url: posterUrl,
      trailer_link: movie.trailer_link,
      cast: castData,
      crew: crewData
    };

    return successResponse(res, 'Movie details fetched successfully', result);

  } catch (error) {
    console.error('Get Movie Details Error:', error);
    return errorResponse(res, 'Failed to fetch movie details', 500);
  }
};

// 4. Get Related Movies (You May Also Like)
const getRelatedMovies = async (req, res) => {
  try {
    console.log('========== GET RELATED MOVIES ==========');
    const { id } = req.params;
    const { language = 'en', limit = 10 } = req.query;

    // Get current movie's languages
    const currentMovie = await db.queryOne(
      `SELECT languages FROM show_managements WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );

    if (!currentMovie) {
      return errorResponse(res, 'Movie not found', 404);
    }

    const currentLanguages = safeJSONParse(currentMovie.languages, 'current_movie_languages', []);

    if (currentLanguages.length === 0) {
      return successResponse(res, 'No related movies found', []);
    }

    // Build query to find movies with same languages
    // Using JSON_CONTAINS for matching languages
    const relatedMovies = await db.query(
      `SELECT 
        sm.id,
        sm.movie_title,
        sm.languages
      FROM show_managements sm
      WHERE sm.id != ?
      AND sm.status = '1'
      AND sm.deleted_at IS NULL
      AND sm.release_date <= CURDATE()
      ORDER BY sm.release_date DESC
      LIMIT ?`,
      [id, parseInt(limit)]
    );

    if (!relatedMovies || relatedMovies.length === 0) {
      return successResponse(res, 'No related movies found', []);
    }

    // Filter movies with matching languages and get translations
    const result = await Promise.all(
      relatedMovies
        .filter(movie => {
          const movieLanguages = safeJSONParse(movie.languages, 'languages', []);
          return movieLanguages.some(lang => currentLanguages.includes(lang));
        })
        .slice(0, parseInt(limit))
        .map(async (movie) => {
          // Get translation
          const translation = await getMovieTranslation(movie.id, language);

          // Get poster
          const posterUrl = await getMoviePosterUrl(movie.id);

          return {
            id: movie.id,
            title: translation?.movie_title || movie.movie_title,
            poster_url: posterUrl
          };
        })
    );

    return successResponse(res, 'Related movies fetched successfully', result);

  } catch (error) {
    console.error('Get Related Movies Error:', error);
    return errorResponse(res, 'Failed to fetch related movies', 500);
  }
};

// 5. Get Theaters and Schedules for a Movie
const getTheatersSchedules = async (req, res) => {
  try {
    console.log('========== GET THEATERS & SCHEDULES ==========');
    const { id } = req.params;
    const { 
      date, 
      movie_lang, 
      format, 
      lang = 'kn', 
      show_time, 
      show_end_time,
      price_range, // Options: '0-200', '200-400', '400-600', '600-800', '800+'
      sort_by = 'nearest' // Options: 'nearest', 'price_low', 'price_high', 'time_early', 'time_late'
    } = req.query;

    // Use today if no date provided
    const showDate = date || new Date().toISOString().split('T')[0];

    console.log('Filters:', { 
      movieId: id, 
      date: showDate, 
      movie_lang, 
      format, 
      display_lang: lang, 
      show_time, 
      show_end_time,
      price_range,
      sort_by
    });

    // Parse price range filter
    let minPriceFilter = null;
    let maxPriceFilter = null;
    
    if (price_range) {
      const priceRanges = {
        '0-200': { min: 0, max: 200 },
        '200-400': { min: 200, max: 400 },
        '400-600': { min: 400, max: 600 },
        '600-800': { min: 600, max: 800 },
        '800+': { min: 800, max: Infinity }
      };
      
      if (priceRanges[price_range]) {
        minPriceFilter = priceRanges[price_range].min;
        maxPriceFilter = priceRanges[price_range].max;
      }
    }

    // Build WHERE conditions
    const conditions = ['schm.movie_id = ?', 'schm.show_date = ?', 'schm.status = "1"', 'schm.deleted_at IS NULL'];
    const params = [id, showDate];

    if (format) {
      conditions.push('schm.experience_format = ?');
      params.push(format);
    }

    // Add show_time filter if provided
    if (show_time) {
      conditions.push('TIME(schm.show_time) >= ?');
      params.push(show_time);
    }

    // Add show_end_time filter if provided
    if (show_end_time) {
      conditions.push('TIME(schm.show_time) <= ?');
      params.push(show_end_time);
    }

    // Get theaters with schedules (removed latitude and longitude)
    const theaters = await db.query(
      `SELECT DISTINCT
        t.id as theater_id,
        t.theater_name,
        t.city,
        t.full_address
      FROM schedule_managements schm
      JOIN show_managements sm ON schm.movie_id = sm.id
      JOIN theaters t ON sm.theaters_id = t.id
      WHERE ${conditions.join(' AND ')}
      AND t.status = '1'
      AND t.deleted_at IS NULL
      ORDER BY t.theater_name ASC`,
      params
    );

    if (!theaters || theaters.length === 0) {
      return successResponse(res, 'No theaters available for this movie', []);
    }

    // Helper function to format time from database
    const formatTime = (timeString) => {
      if (!timeString) return null;
      
      // If it's already in HH:MM:SS format
      if (typeof timeString === 'string' && timeString.includes(':')) {
        const [hours, minutes] = timeString.split(':');
        return `${hours}:${minutes}`;
      }
      
      // If it's a Date object
      if (timeString instanceof Date) {
        return timeString.toTimeString().slice(0, 5);
      }
      
      return timeString;
    };

    // Get schedules for each theater
    const result = await Promise.all(
      theaters.map(async (theater) => {
        // Get theater translation
        const theaterTranslation = await db.queryOne(
          `SELECT tt.theater_name, tt.address, tt.city
           FROM theater_translations tt
           JOIN languages l ON tt.language_id = l.id
           WHERE tt.theater_id = ? AND l.code = ? AND l.is_active = 1`,
          [theater.theater_id, lang]
        );

        // Map city code to city name
        const cityMapping = {
          '0': 'Bengaluru',
          '1': 'Mysore'
        };

        const cityName = theater.city ? (cityMapping[theater.city] || theater.city) : null;

        // Build schedule query conditions
        const scheduleConditions = [
          'schm.movie_id = ?',
          'sm.theaters_id = ?',
          'schm.show_date = ?',
          'schm.status = "1"',
          'schm.deleted_at IS NULL'
        ];
        const scheduleParams = [id, theater.theater_id, showDate];

        if (format) {
          scheduleConditions.push('schm.experience_format = ?');
          scheduleParams.push(format);
        }

        // Add show_time filter if provided
        if (show_time) {
          scheduleConditions.push('TIME(schm.show_time) >= ?');
          scheduleParams.push(show_time);
        }

        // Add show_end_time filter if provided
        if (show_end_time) {
          scheduleConditions.push('TIME(schm.show_time) <= ?');
          scheduleParams.push(show_end_time);
        }

        // Get schedules for this theater
        const schedules = await db.query(
          `SELECT 
            schm.id,
            schm.show_time,
            schm.show_end_time,
            schm.experience_format,
            schm.show_date,
            sm.languages as movie_languages,
            sm.pricing_data
          FROM schedule_managements schm
          JOIN show_managements sm ON schm.movie_id = sm.id
          WHERE ${scheduleConditions.join(' AND ')}
          ORDER BY schm.show_time ASC`,
          scheduleParams
        );

        // Filter by movie language if provided
        let filteredSchedules = schedules;
        if (movie_lang) {
          filteredSchedules = schedules.filter(schedule => {
            const movieLanguages = safeJSONParse(schedule.movie_languages, 'movie_languages', []);
            return movieLanguages.includes(movie_lang);
          });
        }

        // Process schedules and calculate prices
        const processedSchedules = filteredSchedules.map(schedule => {
          const movieLanguages = safeJSONParse(schedule.movie_languages, 'movie_languages', []);
          const pricingData = safeJSONParse(schedule.pricing_data, 'pricing_data', null);

          // Determine price type based on date
          const scheduleDate = new Date(schedule.show_date);
          const dayOfWeek = scheduleDate.getDay();
          const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
          const isHoliday = false;

          // Get current prices for each category
          let priceRange = null;
          let minPrice = null;
          let maxPrice = null;
          
          if (pricingData && typeof pricingData === 'object') {
            const currentPrices = [];
            Object.keys(pricingData).forEach(category => {
              const categoryPricing = pricingData[category];
              let price;
              if (isHoliday && categoryPricing.holiday_price) {
                price = parseFloat(categoryPricing.holiday_price);
              } else if (isWeekend && categoryPricing.weekend_price) {
                price = parseFloat(categoryPricing.weekend_price);
              } else {
                price = parseFloat(categoryPricing.base_price);
              }
              currentPrices.push(price);
            });

            if (currentPrices.length > 0) {
              minPrice = Math.min(...currentPrices);
              maxPrice = Math.max(...currentPrices);
              priceRange = `₹${minPrice}-₹${maxPrice}`;
            }
          }

          return {
            schedule_id: schedule.id,
            show_time: formatTime(schedule.show_time),
            show_end_time: formatTime(schedule.show_end_time),
            format: schedule.experience_format,
            languages: movieLanguages,
            price_range: priceRange,
            min_price: minPrice,
            max_price: maxPrice,
            _raw_show_time: schedule.show_time // For sorting
          };
        });

        // Filter by price range if provided
        let finalSchedules = processedSchedules;
        if (minPriceFilter !== null && maxPriceFilter !== null) {
          finalSchedules = processedSchedules.filter(schedule => {
            if (!schedule.min_price) return false;
            
            // Check if schedule's min price falls within the selected range
            // OR if schedule's price range overlaps with selected range
            return (
              (schedule.min_price >= minPriceFilter && schedule.min_price <= maxPriceFilter) ||
              (schedule.max_price >= minPriceFilter && schedule.max_price <= maxPriceFilter) ||
              (schedule.min_price <= minPriceFilter && schedule.max_price >= maxPriceFilter)
            );
          });
        }

        // Calculate theater's minimum price and earliest show for sorting
        let theaterMinPrice = null;
        let theaterEarliestShow = null;

        if (finalSchedules.length > 0) {
          const prices = finalSchedules
            .map(s => s.min_price)
            .filter(p => p !== null);
          
          if (prices.length > 0) {
            theaterMinPrice = Math.min(...prices);
          }

          // Get earliest show time
          const showTimes = finalSchedules
            .map(s => s._raw_show_time)
            .filter(t => t !== null);
          
          if (showTimes.length > 0) {
            theaterEarliestShow = showTimes.sort()[0];
          }
        }

        // Remove _raw_show_time from final output
        const cleanSchedules = finalSchedules.map(schedule => {
          const { _raw_show_time, min_price, max_price, ...rest } = schedule;
          return rest;
        });

        return {
          theater_id: theater.theater_id,
          theater_name: theaterTranslation?.theater_name || theater.theater_name,
          city: theaterTranslation?.city || cityName,
          address: theaterTranslation?.address || theater.full_address,
          schedules: cleanSchedules,
          _theater_min_price: theaterMinPrice,
          _theater_earliest_show: theaterEarliestShow
        };
      })
    );

    // Filter out theaters with no schedules
    let theatersWithSchedules = result.filter(theater => theater.schedules.length > 0);

    // Sort theaters based on sort_by parameter
    switch (sort_by) {
      case 'price_low':
        // Sort by lowest price first
        theatersWithSchedules.sort((a, b) => {
          if (a._theater_min_price === null && b._theater_min_price === null) return 0;
          if (a._theater_min_price === null) return 1;
          if (b._theater_min_price === null) return -1;
          return a._theater_min_price - b._theater_min_price;
        });
        break;

      case 'price_high':
        // Sort by highest price first
        theatersWithSchedules.sort((a, b) => {
          if (a._theater_min_price === null && b._theater_min_price === null) return 0;
          if (a._theater_min_price === null) return 1;
          if (b._theater_min_price === null) return -1;
          return b._theater_min_price - a._theater_min_price;
        });
        break;

      case 'time_early':
        // Sort by earliest show time first
        theatersWithSchedules.sort((a, b) => {
          if (a._theater_earliest_show === null && b._theater_earliest_show === null) return 0;
          if (a._theater_earliest_show === null) return 1;
          if (b._theater_earliest_show === null) return -1;
          return a._theater_earliest_show.localeCompare(b._theater_earliest_show);
        });
        break;

      case 'time_late':
        // Sort by latest show time first
        theatersWithSchedules.sort((a, b) => {
          if (a._theater_earliest_show === null && b._theater_earliest_show === null) return 0;
          if (a._theater_earliest_show === null) return 1;
          if (b._theater_earliest_show === null) return -1;
          return b._theater_earliest_show.localeCompare(a._theater_earliest_show);
        });
        break;

      case 'nearest':
      default:
        // For 'nearest', keep alphabetical order by theater name since we don't have lat/lng
        // You can change this to any default ordering you prefer
        theatersWithSchedules.sort((a, b) => 
          a.theater_name.localeCompare(b.theater_name)
        );
    }

    // Remove sorting helper fields from response
    const cleanedTheaters = theatersWithSchedules.map(theater => {
      const { _theater_min_price, _theater_earliest_show, ...rest } = theater;
      return rest;
    });

    // Build response filters object
    const appliedFilters = {};
    if (format) appliedFilters.format = format;
    if (movie_lang) appliedFilters.language = movie_lang;
    if (show_time) appliedFilters.show_time = show_time;
    if (show_end_time) appliedFilters.show_end_time = show_end_time;
    if (price_range) appliedFilters.price_range = price_range;
    if (sort_by) appliedFilters.sort_by = sort_by;

    return successResponse(res, 'Theaters and schedules fetched successfully', {
      date: showDate,
      filters: Object.keys(appliedFilters).length > 0 ? appliedFilters : null,
      theaters: cleanedTheaters
    });

  } catch (error) {
    console.error('Get Theaters Schedules Error:', error);
    return errorResponse(res, 'Failed to fetch theaters and schedules', 500);
  }
};
// Single Comprehensive Search API - Movies and Theaters
const searchMovies = async (req, res) => {
  try {
    console.log('========== SEARCH MOVIES & THEATERS ==========');
    const { 
      query,           
      language = 'en',
      status,          
      genre,        
      movie_lang,      
      format,         
      rating,          
      price_range,    
      show_time,      
      show_end_time,  
      city,           
      date,            
      limit = 20
    } = req.query;

    console.log('Search Params:', { 
      query, language, status, genre, movie_lang, format, rating, 
      price_range, show_time, show_end_time, city, date, limit 
    });

    // Validate required query parameter
    if (!query || query.trim().length < 2) {
      return errorResponse(res, 'Search query must be at least 2 characters', 400);
    }

    const searchTerm = `%${query.trim()}%`;
    const showDate = date || new Date().toISOString().split('T')[0];

    // Parse price range filter if provided
    let minPriceFilter = null;
    let maxPriceFilter = null;
    
    if (price_range) {
      const priceRanges = {
        '0-200': { min: 0, max: 200 },
        '200-400': { min: 200, max: 400 },
        '400-600': { min: 400, max: 600 },
        '600-800': { min: 600, max: 800 },
        '800+': { min: 800, max: Infinity }
      };
      
      if (priceRanges[price_range]) {
        minPriceFilter = priceRanges[price_range].min;
        maxPriceFilter = priceRanges[price_range].max;
      }
    }

    // ========== SEARCH MOVIES ==========
    const movieConditions = [
      'sm.deleted_at IS NULL',
      'sm.movie_title LIKE ?'
    ];
    const movieParams = [searchTerm];

    // Apply movie filters if provided
    if (status === 'now_showing') {
      movieConditions.push('sm.status = "1"');
      movieConditions.push('sm.release_date <= CURDATE()');
    } else if (status === 'coming_soon') {
      movieConditions.push('sm.status = "1"');
      movieConditions.push('sm.release_date > CURDATE()');
    } else {
      movieConditions.push('sm.status = "1"');
    }

    if (genre) {
      movieConditions.push('sm.genres LIKE ?');
      movieParams.push(`%${genre}%`);
    }

    if (movie_lang) {
      movieConditions.push('sm.languages LIKE ?');
      movieParams.push(`%${movie_lang}%`);
    }

    if (format) {
      movieConditions.push('sm.experience_formats LIKE ?');
      movieParams.push(`%${format}%`);
    }

    if (rating) {
      const ratingValue = rating.toUpperCase() === 'A' ? '0' : '1';
      movieConditions.push('sm.cbfc_rating = ?');
      movieParams.push(ratingValue);
    }

    const movies = await db.query(
      `SELECT 
        sm.id,
        sm.movie_title,
        sm.genres,
        sm.duration,
        sm.release_date,
        sm.cbfc_rating,
        sm.rating_advice,
        sm.languages,
        sm.experience_formats,
        sm.trailer_link,
        sm.status,
        sm.pricing_data,
        sm.theaters_id
      FROM show_managements sm
      WHERE ${movieConditions.join(' AND ')}
      ORDER BY 
        CASE 
          WHEN sm.movie_title LIKE ? THEN 1
          ELSE 2
        END,
        sm.movie_title ASC
      LIMIT ?`,
      [...movieParams, `${query.trim()}%`, parseInt(limit)]
    );

    // ========== SEARCH THEATERS ==========
    const theaterConditions = [
      't.deleted_at IS NULL',
      't.status = "1"',
      't.theater_name LIKE ?'
    ];
    const theaterParams = [searchTerm];

    if (city) {
      const cityMapping = {
        'Bengaluru': '0',
        'Mysore': '1'
      };
      const cityCode = cityMapping[city] || city;
      theaterConditions.push('t.city = ?');
      theaterParams.push(cityCode);
    }

    const theaters = await db.query(
      `SELECT 
        t.id,
        t.theater_name,
        t.city,
        t.full_address
      FROM theaters t
      WHERE ${theaterConditions.join(' AND ')}
      ORDER BY 
        CASE 
          WHEN t.theater_name LIKE ? THEN 1
          ELSE 2
        END,
        t.theater_name ASC
      LIMIT ?`,
      [...theaterParams, `${query.trim()}%`, parseInt(limit)]
    );

    // ========== FORMAT MOVIES RESPONSE ==========
    let formattedMovies = [];
    if (movies && movies.length > 0) {
      formattedMovies = await Promise.all(
        movies.map(async (movie) => {
          // Get translation
          const translation = await getMovieTranslation(movie.id, language);

          // Get poster
          const posterUrl = await getMoviePosterUrl(movie.id);

          // Parse JSON fields safely
          const languages = safeJSONParse(movie.languages, 'languages', []);
          const experienceFormats = safeJSONParse(movie.experience_formats, 'experience_formats', []);
          const pricingData = safeJSONParse(movie.pricing_data, 'pricing_data', null);

          // Determine if movie is now showing or coming soon
          const releaseDate = new Date(movie.release_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const isNowShowing = releaseDate <= today;

          // Calculate price range for the movie
          let moviePriceRange = null;
          let movieMinPrice = null;
          let movieMaxPrice = null;

          if (pricingData && typeof pricingData === 'object') {
            const scheduleDate = new Date(showDate);
            const dayOfWeek = scheduleDate.getDay();
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            const isHoliday = false;

            const currentPrices = [];
            Object.keys(pricingData).forEach(category => {
              const categoryPricing = pricingData[category];
              let price;
              if (isHoliday && categoryPricing.holiday_price) {
                price = parseFloat(categoryPricing.holiday_price);
              } else if (isWeekend && categoryPricing.weekend_price) {
                price = parseFloat(categoryPricing.weekend_price);
              } else {
                price = parseFloat(categoryPricing.base_price);
              }
              currentPrices.push(price);
            });

            if (currentPrices.length > 0) {
              movieMinPrice = Math.min(...currentPrices);
              movieMaxPrice = Math.max(...currentPrices);
              moviePriceRange = `₹${movieMinPrice}-₹${movieMaxPrice}`;
            }
          }

          // Filter by price if price_range filter is applied
          if (price_range && minPriceFilter !== null && maxPriceFilter !== null) {
            if (!movieMinPrice) return null; // Skip if no price data
            
            // Check if movie's price range overlaps with selected range
            const priceMatches = (
              (movieMinPrice >= minPriceFilter && movieMinPrice <= maxPriceFilter) ||
              (movieMaxPrice >= minPriceFilter && movieMaxPrice <= maxPriceFilter) ||
              (movieMinPrice <= minPriceFilter && movieMaxPrice >= maxPriceFilter)
            );
            
            if (!priceMatches) return null; // Skip this movie
          }

          // Get available schedules if filters are applied
          let availableSchedules = [];
          if (isNowShowing && (show_time || show_end_time || date)) {
            const scheduleConditions = [
              'schm.movie_id = ?',
              'schm.show_date = ?',
              'schm.status = "1"',
              'schm.deleted_at IS NULL'
            ];
            const scheduleParams = [movie.id, showDate];

            if (show_time) {
              scheduleConditions.push('TIME(schm.show_time) >= ?');
              scheduleParams.push(show_time);
            }

            if (show_end_time) {
              scheduleConditions.push('TIME(schm.show_time) <= ?');
              scheduleParams.push(show_end_time);
            }

            const schedules = await db.query(
              `SELECT COUNT(*) as count
               FROM schedule_managements schm
               WHERE ${scheduleConditions.join(' AND ')}`,
              scheduleParams
            );

            availableSchedules = schedules[0]?.count || 0;
            
            // If time filters are applied and no schedules match, skip this movie
            if ((show_time || show_end_time) && availableSchedules === 0) {
              return null;
            }
          }

          // Get theater info
          let theaterInfo = null;
          if (movie.theaters_id) {
            const theater = await db.queryOne(
              `SELECT id, theater_name, city FROM theaters WHERE id = ? AND deleted_at IS NULL`,
              [movie.theaters_id]
            );

            if (theater) {
              const theaterTranslation = await db.queryOne(
                `SELECT tt.theater_name, tt.city
                 FROM theater_translations tt
                 JOIN languages l ON tt.language_id = l.id
                 WHERE tt.theater_id = ? AND l.code = ? AND l.is_active = 1`,
                [theater.id, language]
              );

              const cityMapping = {
                '0': 'Bengaluru',
                '1': 'Mysore'
              };

              theaterInfo = {
                id: theater.id,
                name: theaterTranslation?.theater_name || theater.theater_name,
                city: theaterTranslation?.city || cityMapping[theater.city] || theater.city
              };
            }
          }

          return {
            id: movie.id,
            title: translation?.movie_title || movie.movie_title,
            genres: translation?.genres || movie.genres,
            duration: movie.duration,
            release_date: movie.release_date ? new Date(movie.release_date).toISOString().split('T')[0] : null,
            cbfc_rating: movie.cbfc_rating === '0' ? 'A' : 'U',
            rating_advice: translation?.rating_advice || movie.rating_advice,
            languages: languages,
            experience_formats: experienceFormats,
            poster_url: posterUrl,
            trailer_link: movie.trailer_link,
            status: isNowShowing ? 'now_showing' : 'coming_soon',
            price_range: moviePriceRange,
            theater: theaterInfo,
            available_shows: availableSchedules > 0 ? availableSchedules : null
          };
        })
      );

      // Remove null entries (filtered out movies)
      formattedMovies = formattedMovies.filter(movie => movie !== null);
    }

    // ========== FORMAT THEATERS RESPONSE ==========
    let formattedTheaters = [];
    if (theaters && theaters.length > 0) {
      formattedTheaters = await Promise.all(
        theaters.map(async (theater) => {
          // Get theater translation
          const theaterTranslation = await db.queryOne(
            `SELECT tt.theater_name, tt.address, tt.city
             FROM theater_translations tt
             JOIN languages l ON tt.language_id = l.id
             WHERE tt.theater_id = ? AND l.code = ? AND l.is_active = 1`,
            [theater.id, language]
          );

          const cityMapping = {
            '0': 'Bengaluru',
            '1': 'Mysore'
          };

          // Get current movies count at this theater
          const movieCount = await db.queryOne(
            `SELECT COUNT(DISTINCT sm.id) as count
             FROM show_managements sm
             JOIN schedule_managements schm ON sm.id = schm.movie_id
             WHERE sm.theaters_id = ?
             AND sm.status = '1'
             AND sm.deleted_at IS NULL
             AND schm.show_date >= CURDATE()
             AND schm.status = '1'
             AND schm.deleted_at IS NULL`,
            [theater.id]
          );

          return {
            id: theater.id,
            name: theaterTranslation?.theater_name || theater.theater_name,
            city: theaterTranslation?.city || cityMapping[theater.city] || theater.city,
            address: theaterTranslation?.address || theater.full_address,
            movies_showing: movieCount?.count || 0
          };
        })
      );
    }

    // Calculate total results
    const totalResults = formattedMovies.length + formattedTheaters.length;

    // Build applied filters object
    const appliedFilters = {};
    if (status) appliedFilters.status = status;
    if (genre) appliedFilters.genre = genre;
    if (movie_lang) appliedFilters.language = movie_lang;
    if (format) appliedFilters.format = format;
    if (rating) appliedFilters.rating = rating;
    if (price_range) appliedFilters.price_range = price_range;
    if (show_time) appliedFilters.show_time = show_time;
    if (show_end_time) appliedFilters.show_end_time = show_end_time;
    if (city) appliedFilters.city = city;
    if (date) appliedFilters.date = date;

    if (totalResults === 0) {
      return successResponse(res, 'No results found', {
        search_query: query,
        total_results: 0,
        movies: [],
        theaters: [],
        filters: Object.keys(appliedFilters).length > 0 ? appliedFilters : null
      });
    }

    return successResponse(res, 'Search results fetched successfully', {
      search_query: query,
      total_results: totalResults,
      movies: formattedMovies,
      theaters: formattedTheaters,
      filters: Object.keys(appliedFilters).length > 0 ? appliedFilters : null
    });

  } catch (error) {
    console.error('Search Error:', error);
    return errorResponse(res, 'Failed to search', 500);
  }
};

// Autocomplete Suggestions (unchanged)
const getSearchSuggestions = async (req, res) => {
  try {
    console.log('========== GET SEARCH SUGGESTIONS ==========');
    const { query, language = 'en', limit = 5 } = req.query;

    if (!query || query.trim().length < 2) {
      return successResponse(res, 'Query too short', { movies: [], theaters: [] });
    }

    const searchTerm = `%${query.trim()}%`;

    // Get movie suggestions
    const movieSuggestions = await db.query(
      `SELECT 
        sm.id,
        sm.movie_title
      FROM show_managements sm
      WHERE sm.deleted_at IS NULL
      AND sm.status = '1'
      AND sm.movie_title LIKE ?
      ORDER BY 
        CASE 
          WHEN sm.movie_title LIKE ? THEN 1
          ELSE 2
        END,
        sm.movie_title ASC
      LIMIT ?`,
      [searchTerm, `${query.trim()}%`, parseInt(limit)]
    );

    // Get theater suggestions
    const theaterSuggestions = await db.query(
      `SELECT 
        t.id,
        t.theater_name,
        t.city
      FROM theaters t
      WHERE t.deleted_at IS NULL
      AND t.status = '1'
      AND t.theater_name LIKE ?
      ORDER BY 
        CASE 
          WHEN t.theater_name LIKE ? THEN 1
          ELSE 2
        END,
        t.theater_name ASC
      LIMIT ?`,
      [searchTerm, `${query.trim()}%`, parseInt(limit)]
    );

    // Format movie suggestions
    const formattedMovies = await Promise.all(
      (movieSuggestions || []).map(async (movie) => {
        const translation = await getMovieTranslation(movie.id, language);
        const posterUrl = await getMoviePosterUrl(movie.id);

        return {
          id: movie.id,
          title: translation?.movie_title || movie.movie_title,
          poster_url: posterUrl,
          type: 'movie'
        };
      })
    );

    // Format theater suggestions
    const formattedTheaters = await Promise.all(
      (theaterSuggestions || []).map(async (theater) => {
        const theaterTranslation = await db.queryOne(
          `SELECT tt.theater_name, tt.city
           FROM theater_translations tt
           JOIN languages l ON tt.language_id = l.id
           WHERE tt.theater_id = ? AND l.code = ? AND l.is_active = 1`,
          [theater.id, language]
        );

        const cityMapping = {
          '0': 'Bengaluru',
          '1': 'Mysore'
        };

        return {
          id: theater.id,
          name: theaterTranslation?.theater_name || theater.theater_name,
          city: theaterTranslation?.city || cityMapping[theater.city] || theater.city,
          type: 'theater'
        };
      })
    );

    return successResponse(res, 'Suggestions fetched successfully', {
      movies: formattedMovies,
      theaters: formattedTheaters
    });

  } catch (error) {
    console.error('Get Search Suggestions Error:', error);
    return errorResponse(res, 'Failed to fetch suggestions', 500);
  }
};

module.exports = {
  getNowShowingMovies,
  getComingSoonMovies,
  getMovieDetails,
  getRelatedMovies,
  getTheatersSchedules,
  searchMovies,
  getSearchSuggestions
};