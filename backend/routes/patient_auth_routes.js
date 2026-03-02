const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patient_auth_controller');

router.post('/send-otp', patientController.sendOTP);
router.post('/verify-otp', patientController.verifyOTPForCheckin);
router.post('/request-checkin', patientController.requestCheckIn);
router.post('/verify-locker', patientController.verifyLockerOTP);
router.get('/queue/public/status/:queueId', patientController.getPublicQueueStatus);

module.exports = router;
