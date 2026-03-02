const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patient_auth_controller');

router.post('/firebase-login', patientController.firebaseLogin);

module.exports = router;
