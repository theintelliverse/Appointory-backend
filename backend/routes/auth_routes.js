const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth_controller');
const patientController = require('../controllers/patient_auth_controller');
const { getPatientProfile } = require('../controllers/patient_profile_controller');
const { protect, protectPatient } = require('../utils/auth_middleware');

/**
 * 🏥 CLINIC & STAFF AUTH (PUBLIC)
 */
router.post('/register-clinic', authController.registerClinic);
router.post('/login', authController.loginStaff);

/**
 * 👤 STAFF PROFILE MANAGEMENT (PROTECTED)
 */
router.get('/me', protect, authController.getMe);
router.patch('/update-profile', protect, authController.updateProfile);

/**
 * 📱 PATIENT AUTH & PUBLIC STATUS (PUBLIC)
 */
router.post('/patient/send-otp', patientController.sendOTP);
router.post('/patient/verify-otp', patientController.verifyOTPForCheckin); 
router.post('/patient/request-checkin', patientController.requestCheckIn);
router.post('/patient/verify-locker', patientController.verifyLockerOTP);
router.get('/queue/public/status/:queueId', patientController.getPublicQueueStatus);

/**
 * 🔐 PATIENT LOCKER DATA (PROTECTED)
 * Hits: http://localhost:5000/api/auth/patient/profile
 */
router.get('/patient/profile', protectPatient, getPatientProfile);

module.exports = router;