const db = require('../config/db');
const axios = require('axios');
const config = require('../config/config');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// Get all active banners
const getBanners = async (req, res) => {
  try {
    console.log('Fetching active mobile app banners');

    // Get all published banners
    const banners = await db.query(
      'SELECT id, status FROM mobile_app_banners WHERE status = "1" AND deleted_at IS NULL ORDER BY id DESC'
    );

    if (!banners || banners.length === 0) {
      return successResponse(res, 'No banners found', []);
    }

    // Fetch images for each banner from media table
    const result = await Promise.all(
      banners.map(async (banner) => {
        try {
          // Get media files for this banner
          const media = await db.queryOne(
            `SELECT id, file_name, mime_type, disk, conversions_disk, uuid, collection_name, size
             FROM media 
             WHERE model_type = 'App\\\\Models\\\\MobileAppBanner' 
             AND model_id = ? 
             AND collection_name = 'mobile_app_banner_banner_image'
             ORDER BY order_column ASC
             LIMIT 1`,
            [banner.id]
          );

          let bannerImage = null;

          if (media) {
            // Construct image URL
            const baseUrl = config.laravel.baseUrl || 'https://nsadmin.webmoon.co.in';
            const storagePath = `/storage/${media.id}`;
            
            bannerImage = `${baseUrl}${storagePath}/${media.file_name}`;
          }

          return {
            id: banner.id,
            status: banner.status === '1' ? 'Published' : 'Unpublished',
            image_url: bannerImage
          };

        } catch (error) {
          console.error(`Error fetching media for banner ${banner.id}:`, error.message);
          return {
            id: banner.id,
            status: banner.status === '1' ? 'Published' : 'Unpublished',
            image_url: null
          };
        }
      })
    );

    return successResponse(res, 'Banners fetched successfully', result);

  } catch (error) {
    console.error('Get Banners Error:', error);
    return errorResponse(res, 'Failed to fetch banners', 500);
  }
};

module.exports = {
  getBanners
};