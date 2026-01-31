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

// 1. Get Now Showing Movies
const getNowShowingMovies = async (req, res) => {
  try {
    console.log('========== GET NOW SHOWING MOVIES ==========');
    const { language = 'kn', page = 1, limit = 10 } = req.query;
    
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
      [parseInt(limit), parseInt(offset)]
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

        // Parse JSON fields
        const languages = movie.languages ? JSON.parse(movie.languages) : [];
        const experienceFormats = movie.experience_formats ? JSON.parse(movie.experience_formats) : [];

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
    const { language = 'kn', page = 1, limit = 10 } = req.query;
    
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
      [parseInt(limit), parseInt(offset)]
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

        // Parse JSON fields
        const languages = movie.languages ? JSON.parse(movie.languages) : [];
        const experienceFormats = movie.experience_formats ? JSON.parse(movie.experience_formats) : [];

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
    const { language = 'kn' } = req.query;

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

    // Parse JSON fields
    const languages = movie.languages ? JSON.parse(movie.languages) : [];
    const experienceFormats = movie.experience_formats ? JSON.parse(movie.experience_formats) : [];
    const castData = translation?.cast_data ? JSON.parse(translation.cast_data) : (movie.cast_data ? JSON.parse(movie.cast_data) : []);
    const crewData = translation?.crew_data ? JSON.parse(translation.crew_data) : (movie.crew_data ? JSON.parse(movie.crew_data) : []);

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
    const { language = 'kn', limit = 5 } = req.query;

    // Get current movie's languages
    const currentMovie = await db.queryOne(
      `SELECT languages FROM show_managements WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );

    if (!currentMovie) {
      return errorResponse(res, 'Movie not found', 404);
    }

    const currentLanguages = currentMovie.languages ? JSON.parse(currentMovie.languages) : [];

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
          const movieLanguages = movie.languages ? JSON.parse(movie.languages) : [];
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
    const { date, movie_lang, format, lang = 'kn' } = req.query;

    // Use today if no date provided
    const showDate = date || new Date().toISOString().split('T')[0];

    console.log('Filters:', { movieId: id, date: showDate, movie_lang, format, display_lang: lang });

    // Build WHERE conditions
    const conditions = ['schm.movie_id = ?', 'schm.show_date = ?', 'schm.status = "1"', 'schm.deleted_at IS NULL'];
    const params = [id, showDate];

    if (format) {
      conditions.push('schm.experience_format = ?');
      params.push(format);
    }

    // Get theaters with schedules
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
          WHERE schm.movie_id = ?
          AND sm.theaters_id = ?
          AND schm.show_date = ?
          AND schm.status = '1'
          AND schm.deleted_at IS NULL
          ${format ? 'AND schm.experience_format = ?' : ''}
          ORDER BY schm.show_time ASC`,
          format ? [id, theater.theater_id, showDate, format] : [id, theater.theater_id, showDate]
        );

        // Filter by movie language if provided
        let filteredSchedules = schedules;
        if (movie_lang) {
          filteredSchedules = schedules.filter(schedule => {
            const movieLanguages = schedule.movie_languages ? JSON.parse(schedule.movie_languages) : [];
            return movieLanguages.includes(movie_lang);
          });
        }

        return {
          theater_id: theater.theater_id,
          theater_name: theaterTranslation?.theater_name || theater.theater_name,
          city: theaterTranslation?.city || cityName,
          address: theaterTranslation?.address || theater.full_address,
          // Distance will be calculated later when user location is available
          distance: null,
          schedules: filteredSchedules.map(schedule => {
            const movieLanguages = schedule.movie_languages ? JSON.parse(schedule.movie_languages) : [];
            const pricingData = schedule.pricing_data ? JSON.parse(schedule.pricing_data) : null;
            
            // Determine price type based on date
            const scheduleDate = new Date(schedule.show_date);
            const dayOfWeek = scheduleDate.getDay(); // 0=Sunday, 6=Saturday
            const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
            
            // TODO: Check for holidays from holiday_managements table
            const isHoliday = false;
            
            // Get current prices for each category
            let priceRange = null;
            if (pricingData) {
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
                const minPrice = Math.min(...currentPrices);
                const maxPrice = Math.max(...currentPrices);
                priceRange = `₹${minPrice}-₹${maxPrice}`;
              }
            }
            
            return {
              schedule_id: schedule.id,
              show_time: schedule.show_time,
              show_end_time: schedule.show_end_time,
              format: schedule.experience_format,
              languages: movieLanguages,
              price_range: priceRange // "₹1000-₹1500"
            };
          })
        };
      })
    );

    // Filter out theaters with no schedules
    const theatersWithSchedules = result.filter(theater => theater.schedules.length > 0);

    return successResponse(res, 'Theaters and schedules fetched successfully', {
      date: showDate,
      theaters: theatersWithSchedules
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