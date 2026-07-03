const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth_controller');
const patientController = require('../controllers/patient_auth_controller');
const { getPatientProfile } = require('../controllers/patient_profile_controller');
const { protect, protectPatient, protectLab } = require('../utils/auth_middleware');
const labAuthController = require('../controllers/independent_lab_controller');

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
// 🆕 NEW PASSWORD-BASED AUTHENTICATION ROUTES
router.post('/patient/login-with-password', patientController.patientLoginWithPassword);
router.post('/patient/register-with-otp-password', patientController.registerWithOTPAndPassword);
router.post('/patient/change-password-with-otp', patientController.changePasswordWithOTP);
router.get('/queue/public/status/:queueId', patientController.getPublicQueueStatus);

/**
 * 🔐 PATIENT LOCKER DATA (PROTECTED)
 * Hits: http://localhost:5000/api/auth/patient/profile
 */
router.get('/patient/profile', protectPatient, getPatientProfile);
router.patch('/patient/update-profile', protectPatient, require('../controllers/patient_profile_controller').updatePatientProfile);
router.post('/patient/book-appointment', protectPatient, patientController.bookAppointment);
router.get('/patient/appointments', protectPatient, patientController.getPatientAppointments);
router.delete('/patient/remove-document/:documentId', protectPatient, patientController.removeDocument);

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