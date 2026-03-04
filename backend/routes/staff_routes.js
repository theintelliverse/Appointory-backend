const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staff_controller');
const labController = require('../controllers/lab_controller');
const { protect, authorize } = require('../utils/auth_middleware');
const { storage } = require('../utils/cloudinary_config');
const multer = require('multer');
const adminController = require('../controllers/admin_controller');

// Configure Multer
const upload = multer({ storage });

// 🔓 PUBLIC ROUTES
router.get('/public/doctors/:clinicCode', staffController.getPublicDoctors);

// 🔐 PROTECTED ROUTES
router.use(protect);

// --- 👥 STAFF MANAGEMENT ---
router.get('/all', authorize('admin', 'receptionist'), staffController.getAllStaff);
router.post('/add', authorize('admin'), staffController.addStaff);
router.post('/resend-credentials', authorize('admin'), staffController.resendCredentials);
router.patch('/toggle-status/:staffId', authorize('admin', 'doctor', 'receptionist', 'lab'), staffController.toggleAvailability);
router.delete('/delete/:staffId', staffController.archiveStaff);

// --- 🩺 CLINICAL DATA ---
router.patch('/update-patient-profile/:phone', authorize('receptionist', 'doctor', 'admin'), staffController.updatePatientProfile);
router.get('/patient-full-profile/:phone', authorize('doctor', 'admin'), staffController.getPatientFullProfile);

// --- 🔬 LAB OPERATIONS ---

// 🔍 Debug Middleware for Lab Upload
const debugLabUpload = (req, res, next) => {
    console.log("-----------------------------------------");
    console.log(`📡 HIT: Lab Upload Route`);
    console.log(`📱 Params:`, req.params);
    console.log(`👤 User Role:`, req.user?.role);
    next();
};

// 🔑 THE FIX: Ensure the field name 'file' matches your LabDashboard.jsx
/**
 * @desc    Upload Lab Report to Cloudinary and sync with Patient Locker
 * @route   POST /api/staff/lab/upload/:patientPhone/:queueId
 */
router.post(
    '/lab/upload/:patientPhone/:queueId', 
    authorize('lab', 'admin'), 
    upload.single('file'), // 🔑 Field name MUST be 'file' in LabDashboard.jsx
    (req, res, next) => {
        // --- 🔍 Middleware Debugging ---
        console.log("-----------------------------------------");
        console.log(`📡 HIT: Lab Upload Route`);
        console.log(`📱 Params:`, req.params);
        
        if (!req.file) {
            console.error("❌ MULTER FAILED: req.file is undefined.");
            return res.status(400).json({ 
                success: false, 
                message: "Upload failed: No file received or unsupported format." 
            });
        }
        
        console.log("📄 CLOUDINARY SUCCESS: URL ->", req.file.path);
        next(); // Hands over to labController.uploadLabReport
    },
    labController.uploadLabReport
);
// routes/staff_routes.js


router.get(
    '/admin/preview-data', 
    protect, 
    authorize('admin'), 
    adminController.getClinicDataPreview
);

// Feature: Clinical CSV Report Download
router.get(
    '/admin/reports/download', 
    protect, 
    authorize('admin'), 
    adminController.downloadClinicReport
);
module.exports = router;