const express = require('express');
const router = express.Router();
const {
    uploadLabReport,
    getLabDashboardStats,
    getRecentReports,
    getLabQueueByStatus,
    getLabAnalytics
} = require('../controllers/lab_controller');
const { protect, authorize } = require('../utils/auth_middleware');
const { storage } = require('../utils/cloudinary_config');
const multer = require('multer');

const upload = multer({ storage });

// ============================================================
// 🔐 ALL ROUTES REQUIRE LAB ROLE AUTHENTICATION
// ============================================================
router.use(protect);
router.use(authorize('lab', 'admin', 'doctor'));

// 📊 GET LAB DASHBOARD STATISTICS
router.get('/dashboard/stats', getLabDashboardStats);

// 📊 GET LAB ANALYTICS
router.get('/analytics', getLabAnalytics);

// 📋 GET RECENT LAB REPORTS
router.get('/reports/recent', getRecentReports);

// 📋 GET LAB QUEUE BY STATUS (Pending, Completed, etc.)
router.get('/queue/:status', getLabQueueByStatus);

// 📤 UPLOAD LAB REPORT
router.post('/upload/:patientPhone/:queueId', upload.single('file'), uploadLabReport);

module.exports = router;
