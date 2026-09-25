const express = require('express');
const router = express.Router();
const { 
    submitRating, 
    getRatings, 
    getPatientReviews, 
    updateReview, 
    deleteReview, 
    searchTargets 
} = require('../controllers/rating_controller');
const { publicWriteLimiter, publicReadLimiter } = require('../utils/security_middleware');

// Public search for rateable healthcare targets (doctors, clinics, labs)
router.get('/search', publicReadLimiter, searchTargets);

// Patient panel: Retrieve all reviews submitted by this patient
router.get('/my-reviews', publicReadLimiter, getPatientReviews);

// Patient panel: Edit/update an existing review
router.put('/:reviewId', publicWriteLimiter, updateReview);

// Patient panel: Delete a review
router.delete('/:reviewId', publicWriteLimiter, deleteReview);

// Public rating submission with rate limiting (creates new or updates existing)
router.post('/', publicWriteLimiter, submitRating);

// Public rating and review retrieval (patient identity masked as "Verified Patient")
router.get('/:targetType/:targetId', publicReadLimiter, getRatings);

module.exports = router;
