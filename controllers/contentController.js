const db = require('../config/db');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// Get all content pages with translations
const getAllContent = async (req, res) => {
  try {
    const languageCode = req.query.language || 'en';

    console.log('Fetching all content for language:', languageCode);

    // Get language ID
    const language = await db.queryOne(
      'SELECT id FROM languages WHERE code = ? AND is_active = 1',
      [languageCode]
    );

    if (!language) {
      return errorResponse(res, 'Language not found or inactive', 404);
    }

    // Get all published content
    const contents = await db.query(
      'SELECT * FROM content_managments WHERE status = "1" AND deleted_at IS NULL ORDER BY id DESC'
    );

    // Get translations for all content
    const result = await Promise.all(
      contents.map(async (content) => {
        const translation = await db.queryOne(
          `SELECT t.title, t.description, t.content 
           FROM content_managment_translations t 
           WHERE t.content_managment_id = ? AND t.language_id = ?`,
          [content.id, language.id]
        );

        return {
          id: content.id,
          title: translation?.title || content.title,
          slug: content.slug,
          description: translation?.description || content.description,
          status: content.status === '1' ? 'Published' : 'Unpublished',
          language: languageCode
        };
      })
    );

    return successResponse(res, 'Content list fetched successfully', result);

  } catch (error) {
    console.error('Get All Content Error:', error);
    return errorResponse(res, 'Failed to fetch content list', 500);
  }
};

// Get single content by slug with translation (POST)
const getContentBySlug = async (req, res) => {
  try {
    const { slug, language } = req.body;
    const languageCode = language || 'en';

    console.log('Extracted slug:', slug);
    console.log('Extracted language:', languageCode);

    // Validate slug
    if (!slug) {
      console.log('❌ Slug is missing!');
      return errorResponse(res, 'Slug is required', 400);
    }

    console.log('Fetching content by slug:', slug, 'language:', languageCode);

    // Get language ID
    const languageRecord = await db.queryOne(
      'SELECT id FROM languages WHERE code = ? AND is_active = 1',
      [languageCode]
    );

    if (!languageRecord) {
      return errorResponse(res, 'Language not found or inactive', 404);
    }

    // Get content by slug
    const content = await db.queryOne(
      'SELECT * FROM content_managments WHERE slug = ? AND status = "1" AND deleted_at IS NULL',
      [slug]
    );

    if (!content) {
      return errorResponse(res, 'Content not found', 404);
    }

    // Get translation
    const translation = await db.queryOne(
      `SELECT t.title, t.description, t.content 
       FROM content_managment_translations t 
       WHERE t.content_managment_id = ? AND t.language_id = ?`,
      [content.id, languageRecord.id]
    );

    const result = {
      id: content.id,
      title: translation?.title || content.title,
      slug: content.slug,
      description: translation?.description || content.description,
      status: content.status === '1' ? 'Published' : 'Unpublished',
      language: languageCode
    };

    return successResponse(res, 'Content fetched successfully', result);

  } catch (error) {
    console.error('Get Content By Slug Error:', error);
    return errorResponse(res, 'Failed to fetch content', 500);
  }
};

// Get all active languages
const getLanguages = async (req, res) => {
  try {
    console.log('Fetching active languages');

    const languages = await db.query(
      'SELECT id, name, code,display_code, native_name FROM languages WHERE is_active = 1 AND deleted_at IS NULL ORDER BY sort_order'
    );

    return successResponse(res, 'Languages fetched successfully', languages);

  } catch (error) {
    console.error('Get Languages Error:', error);
    return errorResponse(res, 'Failed to fetch languages', 500);
  }
};

module.exports = {
  getAllContent,
  getContentBySlug,
  getLanguages
};