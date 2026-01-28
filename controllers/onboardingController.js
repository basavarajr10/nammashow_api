const db = require('../config/db');
const axios = require('axios');
const config = require('../config/config');
const { successResponse, errorResponse } = require('../utils/responseHelper');

// 1. Theatre Owner Submission
const submitTheatreOwner = async (req, res) => {
  try {
    console.log('========== THEATRE OWNER SUBMISSION ==========');
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);

    const {
      organization_name,
      contact_person_name,
      screens,
      other_screens,
      district,
      email,
      mobile_number,
      address,
      gst_number
    } = req.body;

    // Validation
    if (!organization_name || !contact_person_name || !screens || !district || !mobile_number) {
      return errorResponse(res, 'Required fields: organization_name, contact_person_name, screens, district, mobile_number', 400);
    }

    // Check for duplicate submission
    const existingSubmission = await db.queryOne(
      'SELECT id FROM onboarding_details WHERE type = ? AND mobile_number = ? AND deleted_at IS NULL',
      ['theatre_owner', mobile_number]
    );

    if (existingSubmission) {
      return errorResponse(res, 'You have already submitted a theatre owner registration with this mobile number', 400);
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO onboarding_details 
      (type, organization_name, contact_person_name, screens, other_screens, district, email, mobile_number, address, gst_number, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        'theatre_owner', 
        organization_name, 
        contact_person_name, 
        screens, 
        other_screens || null, 
        district, 
        email || null, 
        mobile_number, 
        address || null, 
        gst_number || null
      ]
    );

    console.log('✅ Theatre owner registration saved, ID:', result.insertId);

    return successResponse(res, 'Theatre owner registration submitted successfully', {
      id: result.insertId,
      type: 'theatre_owner',
      status: 'pending'
    });

  } catch (error) {
    console.error('Theatre Owner Submission Error:', error);
    return errorResponse(res, 'Failed to submit theatre owner registration', 500);
  }
};

// 2. Event Organizer Submission
const submitEventOrganizer = async (req, res) => {
  try {
    const {
      organization_name,
      category,
      district,
      mobile_number,
      email,
      social_media
    } = req.body;

    // Validation
    if (!organization_name || !category || !district || !mobile_number) {
      return errorResponse(res, 'Required fields: organization_name, category, district, mobile_number', 400);
    }

    // Check for duplicate submission
    const existingSubmission = await db.queryOne(
      'SELECT id FROM onboarding_details WHERE type = ? AND mobile_number = ? AND deleted_at IS NULL',
      ['event_organizer', mobile_number]
    );

    if (existingSubmission) {
      return errorResponse(res, 'You have already submitted an event organizer registration with this mobile number', 400);
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO onboarding_details 
      (type, organization_name, category, district, mobile_number, email, social_media, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        'event_organizer', 
        organization_name, 
        category, 
        district, 
        mobile_number, 
        email || null, 
        social_media || null
      ]
    );

    console.log('✅ Event organizer registration saved, ID:', result.insertId);

    return successResponse(res, 'Event organizer registration submitted successfully', {
      id: result.insertId,
      type: 'event_organizer',
      status: 'pending'
    });

  } catch (error) {
    console.error('Event Organizer Submission Error:', error);
    return errorResponse(res, 'Failed to submit event organizer registration', 500);
  }
};

// 3. Talent Registration Submission
const submitTalent = async (req, res) => {
  try {
    console.log('========== TALENT REGISTRATION SUBMISSION ==========');
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);

    const {
      talent_full_name,
      talent_type,
      other_talent_type,
      video_link,
      experience,
      talent_district,
      other_district,
      taluk,
      talent_mobile_number,
      instagram_link,
      facebook_link,
      youtube_link
    } = req.body;

    // Validation
    if (!talent_full_name || !talent_type || !video_link || !talent_district || !talent_mobile_number) {
      return errorResponse(res, 'Required fields: talent_full_name, talent_type, video_link, talent_district, talent_mobile_number', 400);
    }

    // Check for duplicate submission
    const existingSubmission = await db.queryOne(
      'SELECT id FROM onboarding_details WHERE type = ? AND talent_mobile_number = ? AND deleted_at IS NULL',
      ['talent', talent_mobile_number]
    );

    if (existingSubmission) {
      return errorResponse(res, 'You have already submitted a talent registration with this mobile number', 400);
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO onboarding_details 
      (type, talent_full_name, talent_type, other_talent_type, video_link, experience, talent_district, other_district, taluk, talent_mobile_number, instagram_link, facebook_link, youtube_link, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        'talent', 
        talent_full_name, 
        talent_type, 
        other_talent_type || null, 
        video_link, 
        experience || null, 
        talent_district, 
        other_district || null, 
        taluk || null, 
        talent_mobile_number, 
        instagram_link || null, 
        facebook_link || null, 
        youtube_link || null
      ]
    );

    const recordId = result.insertId;
    console.log('✅ Talent registration saved, ID:', recordId);

    // Handle file uploads if present
    if (req.files) {
      // Handle talent_profile_image
      if (req.files.talent_profile_image) {
        try {
          const FormData = require('form-data');
          const formData = new FormData();
          formData.append('model_type', 'App\\Models\\OnboardingDetail');
          formData.append('model_id', recordId);
          formData.append('collection_name', 'onboarding_detail_talent_profile_image');
          formData.append('file', req.files.talent_profile_image[0].buffer, {
            filename: req.files.talent_profile_image[0].originalname,
            contentType: req.files.talent_profile_image[0].mimetype
          });

          await axios.post(`${config.laravel.apiUrl}/v1/media/upload`, formData, {
            headers: formData.getHeaders()
          });
          console.log('✅ Talent profile image uploaded');
        } catch (uploadError) {
          console.error('❌ Profile image upload failed:', uploadError.message);
        }
      }

      // Handle id_proof
      if (req.files.id_proof) {
        try {
          const FormData = require('form-data');
          const formData = new FormData();
          formData.append('model_type', 'App\\Models\\OnboardingDetail');
          formData.append('model_id', recordId);
          formData.append('collection_name', 'onboarding_detail_id_proof');
          formData.append('file', req.files.id_proof[0].buffer, {
            filename: req.files.id_proof[0].originalname,
            contentType: req.files.id_proof[0].mimetype
          });

          await axios.post(`${config.laravel.apiUrl}/v1/media/upload`, formData, {
            headers: formData.getHeaders()
          });
          console.log('✅ ID proof uploaded');
        } catch (uploadError) {
          console.error('❌ ID proof upload failed:', uploadError.message);
        }
      }
    }

    return successResponse(res, 'Talent registration submitted successfully', {
      id: recordId,
      type: 'talent',
      status: 'pending'
    });

  } catch (error) {
    console.error('Talent Registration Submission Error:', error);
    return errorResponse(res, 'Failed to submit talent registration', 500);
  }
};

// 4. Host My Show Submission
const submitHostShow = async (req, res) => {
  try {
    console.log('========== HOST MY SHOW SUBMISSION ==========');
    console.log('Request body:', req.body);
    console.log('Request files:', req.files);

    const {
      show_title,
      category,
      date,
      show_time,
      venue,
      ticket_price,
      total_capacity,
      artist_bio,
      contact_number
    } = req.body;

    // Validation
    if (!show_title || !category || !date || !show_time || !venue || !ticket_price || !total_capacity || !artist_bio || !contact_number) {
      return errorResponse(res, 'Required fields: show_title, category, date, show_time, venue, ticket_price, total_capacity, artist_bio, contact_number', 400);
    }

    // Check for duplicate submission (same show title and contact number)
    const existingSubmission = await db.queryOne(
      'SELECT id FROM onboarding_details WHERE type = ? AND contact_number = ? AND show_title = ? AND deleted_at IS NULL',
      ['host_show', contact_number, show_title]
    );

    if (existingSubmission) {
      return errorResponse(res, 'You have already submitted this show with the same contact number', 400);
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO onboarding_details 
      (type, show_title, category, date, show_time, venue, ticket_price, total_capacity, artist_bio, contact_number, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      ['host_show', show_title, category, date, show_time, venue, ticket_price, total_capacity, artist_bio, contact_number]
    );

    const recordId = result.insertId;
    console.log('✅ Host show registration saved, ID:', recordId);

    // Handle poster_image upload
    if (req.files && req.files.poster_image) {
      try {
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('model_type', 'App\\Models\\OnboardingDetail');
        formData.append('model_id', recordId);
        formData.append('collection_name', 'onboarding_detail_poster_image');
        formData.append('file', req.files.poster_image[0].buffer, {
          filename: req.files.poster_image[0].originalname,
          contentType: req.files.poster_image[0].mimetype
        });

        await axios.post(`${config.laravel.apiUrl}/v1/media/upload`, formData, {
          headers: formData.getHeaders()
        });
        console.log('✅ Poster image uploaded');
      } catch (uploadError) {
        console.error('❌ Poster upload failed:', uploadError.message);
      }
    }

    return successResponse(res, 'Show registration submitted successfully', {
      id: recordId,
      type: 'host_show',
      status: 'pending'
    });

  } catch (error) {
    console.error('Host Show Submission Error:', error);
    return errorResponse(res, 'Failed to submit show registration', 500);
  }
};

// 5. Festival Participation Submission
const submitFestival = async (req, res) => {
  try {
    console.log('========== FESTIVAL PARTICIPATION SUBMISSION ==========');
    console.log('Request body:', req.body);

    const {
      participation_type,
      individual_group_name,
      art_form,
      other_art_form,
      festival_district,
      other_district,
      available_season,
      festival_mobile_number
    } = req.body;

    // Validation
    if (!participation_type || !individual_group_name || !art_form || !festival_district || !festival_mobile_number) {
      return errorResponse(res, 'Required fields: participation_type, individual_group_name, art_form, festival_district, festival_mobile_number', 400);
    }

    // Check for duplicate submission
    const existingSubmission = await db.queryOne(
      'SELECT id FROM onboarding_details WHERE type = ? AND festival_mobile_number = ? AND deleted_at IS NULL',
      ['festival', festival_mobile_number]
    );

    if (existingSubmission) {
      return errorResponse(res, 'You have already submitted a festival participation with this mobile number', 400);
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO onboarding_details 
      (type, participation_type, individual_group_name, art_form, other_art_form, festival_district, other_district, available_season, festival_mobile_number, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        'festival', 
        participation_type, 
        individual_group_name, 
        art_form, 
        other_art_form || null, 
        festival_district, 
        other_district || null, 
        available_season || null, 
        festival_mobile_number
      ]
    );

    console.log('✅ Festival participation saved, ID:', result.insertId);

    return successResponse(res, 'Festival participation submitted successfully', {
      id: result.insertId,
      type: 'festival',
      status: 'pending'
    });

  } catch (error) {
    console.error('Festival Participation Submission Error:', error);
    return errorResponse(res, 'Failed to submit festival participation', 500);
  }
};

// 6. Join Us Submission
const submitJoinUs = async (req, res) => {
  try {
    console.log('========== JOIN US SUBMISSION ==========');
    console.log('Request body:', req.body);

    const {
      organization_name,
      contact_person_name,
      gst_number,
      district,
      mobile_number,
      interests
    } = req.body;

    // Validation
    if (!organization_name || !contact_person_name || !district || !mobile_number) {
      return errorResponse(res, 'Required fields: organization_name, contact_person_name, district, mobile_number', 400);
    }

    // Check for duplicate submission
    const existingSubmission = await db.queryOne(
      'SELECT id FROM onboarding_details WHERE type = ? AND mobile_number = ? AND deleted_at IS NULL',
      ['join_us', mobile_number]
    );

    if (existingSubmission) {
      return errorResponse(res, 'You have already submitted a partnership request with this mobile number', 400);
    }

    // Insert into database
    const result = await db.query(
      `INSERT INTO onboarding_details 
      (type, organization_name, contact_person_name, gst_number, district, mobile_number, interests, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        'join_us', 
        organization_name, 
        contact_person_name, 
        gst_number || null, 
        district, 
        mobile_number, 
        interests || null
      ]
    );

    console.log('✅ Join us registration saved, ID:', result.insertId);

    return successResponse(res, 'Partnership registration submitted successfully', {
      id: result.insertId,
      type: 'join_us',
      status: 'pending'
    });

  } catch (error) {
    console.error('Join Us Submission Error:', error);
    return errorResponse(res, 'Failed to submit partnership registration', 500);
  }
};

module.exports = {
  submitTheatreOwner,
  submitEventOrganizer,
  submitTalent,
  submitHostShow,
  submitFestival,
  submitJoinUs
};