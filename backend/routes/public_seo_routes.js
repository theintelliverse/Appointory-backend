const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/public_seo_controller');
const { publicReadLimiter } = require('../utils/security_middleware');

// Public SEO profile endpoints
router.get('/clinic/:identifier', publicReadLimiter, ctrl.getPublicClinicProfile);
router.get('/doctor/:identifier', publicReadLimiter, ctrl.getPublicDoctorProfile);
router.get('/lab/:identifier', publicReadLimiter, ctrl.getPublicLabProfile);

module.exports = router;
