const db = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// Get all translations for a specific language
const getTranslations = async (req, res) => {
  try {
    const { language } = req.query;
    const languageCode = language || 'en';

    console.log('Fetching translations for language:', languageCode);

    const languageRecord = await db.queryOne(
      'SELECT id FROM languages WHERE code = ? AND is_active = 1',
      [languageCode]
    );

    if (!languageRecord) {
      return errorResponse(res, 'Language not found or inactive', 404);
    }

    // Get all active translations for this language
    const translations = await db.query(
      'SELECT translation_key, translation_value FROM manual_translations WHERE language_id = ? AND is_active = 1 AND deleted_at IS NULL',
      [languageRecord.id]
    );

    // Convert to key-value object
    const result = {};
    translations.forEach(item => {
      result[item.translation_key] = item.translation_value;
    });

    return successResponse(res, 'Translations fetched successfully', result);

  } catch (error) {
    console.error('Get Translations Error:', error);
    return errorResponse(res, 'Failed to fetch translations', 500);
  }
};

module.exports = {
  getTranslations
};