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
      min_price,
      max_price,
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
      min_price,
      max_price,
      sort_by
    });

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

    // Get theaters with schedules
    const theaters = await db.query(
      `SELECT DISTINCT
        t.id as theater_id,
        t.theater_name,
        t.city,
        t.full_address,
        t.latitude,
        t.longitude
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

    // Helper function to calculate distance (Haversine formula)
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      if (!lat1 || !lon1 || !lat2 || !lon2) return null;
      
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c; // Distance in km
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

        // Calculate distance from user location (if provided in query)
        let distance = null;
        if (req.query.user_lat && req.query.user_lng && theater.latitude && theater.longitude) {
          distance = calculateDistance(
            parseFloat(req.query.user_lat),
            parseFloat(req.query.user_lng),
            parseFloat(theater.latitude),
            parseFloat(theater.longitude)
          );
        }

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
        if (min_price || max_price) {
          finalSchedules = processedSchedules.filter(schedule => {
            if (!schedule.min_price) return false;
            
            const scheduleMinPrice = schedule.min_price;
            const scheduleMaxPrice = schedule.max_price;
            
            // Check if schedule's price range overlaps with requested price range
            if (min_price && scheduleMaxPrice < parseFloat(min_price)) return false;
            if (max_price && scheduleMinPrice > parseFloat(max_price)) return false;
            
            return true;
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
          distance: distance ? parseFloat(distance.toFixed(2)) : null,
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
      case 'nearest':
        // Sort by distance (nearest first), null distances go to end
        theatersWithSchedules.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
        break;

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

      default:
        // Default to nearest
        theatersWithSchedules.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
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
    if (min_price) appliedFilters.min_price = min_price;
    if (max_price) appliedFilters.max_price = max_price;
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

module.exports = {
  getNowShowingMovies,
  getComingSoonMovies,
  getMovieDetails,
  getRelatedMovies,
  getTheatersSchedules
};