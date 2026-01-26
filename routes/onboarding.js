const express = require('express');
const router = express.Router();
const onboardingController = require('../controllers/onboardingController');
const upload = require('../middleware/upload');

router.post('/onboarding/theatre-owner', onboardingController.submitTheatreOwner);

router.post('/onboarding/event-organizer', onboardingController.submitEventOrganizer);

router.post('/onboarding/talent', 
  upload.fields([
    { name: 'talent_profile_image', maxCount: 1 },
    { name: 'id_proof', maxCount: 1 }
  ]),
  onboardingController.submitTalent
);

router.post('/onboarding/host-show',
  upload.fields([
    { name: 'poster_image', maxCount: 1 }
  ]),
  onboardingController.submitHostShow
);

router.post('/onboarding/festival', onboardingController.submitFestival);

router.post('/onboarding/join-us', onboardingController.submitJoinUs);

module.exports = router;