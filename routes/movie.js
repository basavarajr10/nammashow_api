const express = require('express');
const router = express.Router();
const movieController = require('../controllers/movieController');
router.get('/movies/search', movieController.searchMovies);
router.get('/movies/search/suggestions', movieController.getSearchSuggestions);

router.get('/movies/now-showing', movieController.getNowShowingMovies);
router.get('/movies/coming-soon', movieController.getComingSoonMovies);
router.get('/movies/:id', movieController.getMovieDetails);
router.get('/movies/:id/related', movieController.getRelatedMovies);
router.get('/movies/:id/theaters-schedules', movieController.getTheatersSchedules);


module.exports = router;