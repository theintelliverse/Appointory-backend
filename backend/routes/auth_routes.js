const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth_controller');
const patientController = require('../controllers/patient_auth_controller');
const { getPatientProfile, uploadDocument, cancelAppointmentStatus } = require('../controllers/patient_profile_controller');
const { protect, protectPatient, protectLab } = require('../utils/auth_middleware');
const labAuthController = require('../controllers/independent_lab_controller');

// 🔑 Multer + Cloudinary Setup for patient document uploads
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const CloudinaryStoragePkg = require('multer-storage-cloudinary');
const CloudinaryStorage = CloudinaryStoragePkg.CloudinaryStorage || CloudinaryStoragePkg;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const cloudinaryStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'swasthya_mitra/patient_documents',
        allowed_formats: ['jpg', 'jpeg', 'png', 'pdf', 'webp'],
        resource_type: 'auto'
    }
});

const upload = multer({ 
    storage: cloudinaryStorage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * 🏥 CLINIC & STAFF AUTH (PUBLIC)
 */
router.post('/register-clinic', authController.registerClinic);
router.post('/login', authController.loginStaff);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/logout', protect, authController.logoutStaff);

/**
 * 👤 STAFF PROFILE MANAGEMENT (PROTECTED)
 */
router.get('/me', protect, authController.getMe);
router.patch('/update-profile', protect, authController.updateProfile);

/**
 * 📱 PATIENT AUTH & PUBLIC STATUS (PUBLIC)
 */
router.post('/patient/send-otp', patientController.sendOTP);
router.post('/patient/verify-otp', patientController.validateOTP);
router.post('/patient/request-checkin', patientController.requestCheckIn);
router.post('/patient/verify-locker', patientController.verifyLockerOTP);
router.post('/patient/register', patientController.registerPatient);
router.post('/patient/forgot-password', patientController.patientForgotPassword);
router.post('/patient/reset-password', patientController.patientResetPassword);
// 🆕 PASSWORD-BASED AUTHENTICATION ROUTES
router.post('/patient/login-with-password', patientController.patientLoginWithPassword);
router.post('/patient/register-with-otp-password', patientController.registerWithOTPAndPassword);
router.post('/patient/change-password-with-otp', patientController.changePasswordWithOTP);
router.get('/queue/public/status/:queueId', patientController.getPublicQueueStatus);

/**
 * 🔐 PATIENT LOCKER DATA (PROTECTED)
 */
router.get('/patient/profile', protectPatient, getPatientProfile);
router.patch('/patient/update-profile', protectPatient, require('../controllers/patient_profile_controller').updatePatientProfile);
router.post('/patient/book-appointment', protectPatient, patientController.bookAppointment);
router.get('/patient/appointments', protectPatient, patientController.getPatientAppointments);
router.get('/patient/invoices', protectPatient, require('../controllers/billing_controller').getPatientInvoices);
router.delete('/patient/remove-document/:documentId', protectPatient, patientController.removeDocument);

// Middleware to accept either 'document' or 'file' field and handle multer errors cleanly
const documentUploadMiddleware = (req, res, next) => {
    upload.fields([
        { name: 'document', maxCount: 1 },
        { name: 'file', maxCount: 1 }
    ])(req, res, (err) => {
        if (err) {
            console.error('❌ Document Upload Multer Error:', err.message);
            return res.status(400).json({ success: false, message: err.message || 'File upload error' });
        }
        if (req.files) {
            if (req.files.document && req.files.document[0]) {
                req.file = req.files.document[0];
            } else if (req.files.file && req.files.file[0]) {
                req.file = req.files.file[0];
            }
        }
        next();
    });
};

// 🆕 Upload document to Health Locker (Cloudinary)
router.post('/patient/upload-document', protectPatient, documentUploadMiddleware, uploadDocument);

// 🆕 Mark appointment as cancelled in patient record
router.patch('/patient/cancel-appointment/:queueId', protectPatient, cancelAppointmentStatus);

/**
 * 🔬 INDEPENDENT LAB AUTH (PUBLIC)
 */
router.post('/lab/register', labAuthController.registerLab);
router.post('/lab/login', labAuthController.loginLab);
router.post('/lab/forgot-password', labAuthController.labForgotPassword);
router.post('/lab/reset-password', labAuthController.labResetPassword);

/**
 * 🔬 INDEPENDENT LAB PROFILE (PROTECTED — Lab Token)
 */
router.get('/lab/me', protectLab, labAuthController.getLabMe);
router.patch('/lab/update-profile', protectLab, labAuthController.updateLabProfile);

module.exports = router;