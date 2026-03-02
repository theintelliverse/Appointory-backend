const express = require('express');
const router = express.Router();

const {
    addToQueue,
    getLiveQueue,
    startConsultation,
    completeVisit,
    getDoctorQueue,
    selfCheckIn,
    getPatientStatus,
    getMedicalHistory,
    cancelVisit,
    referToLab,
    completeLabTask,
    // 🆕 NEW GATEKEEPER ACTIONS
    getPendingRequests,
    approvePatient,
    getPublicDoctorQueue
} = require('../controllers/queue_controller');

const { protect, authorize } = require('../utils/auth_middleware');

// ==================================================
// 1️⃣ PUBLIC ROUTES (NO AUTH REQUIRED)
// ==================================================
router.post('/public/checkin', selfCheckIn);
router.get('/public/status/:queueId', getPatientStatus);
router.delete('/public/cancel/:queueId', cancelVisit);

// Add this line to queue_routes.js
router.get('/public/doctor-display/:doctorId', getPublicDoctorQueue);

// ==================================================
// 2️⃣ AUTHENTICATION BARRIER
// ==================================================
router.use(protect);

// ==================================================
// 3️⃣ PROTECTED STAFF ROUTES
// ==================================================

// --- 🛑 GATEKEEPER / APPROVAL SYSTEM ---
// Receptionist sees the list of OTP-verified requests
router.get('/pending', authorize('receptionist', 'admin'), getPendingRequests);
// Receptionist approves and assigns a Token Number
router.patch('/approve/:id', authorize('receptionist', 'admin'), approvePatient);

// --- 👥 STANDARD QUEUE MGMT ---
router.post('/add', authorize('receptionist', 'admin'), addToQueue);
router.get('/live', authorize('receptionist', 'doctor', 'admin', 'lab'), getLiveQueue);

// Doctor
router.get('/my-queue', authorize('doctor'), getDoctorQueue);

// Status Management
router.patch('/start/:id', authorize('receptionist', 'doctor'), startConsultation);
router.patch('/complete/:id', authorize('receptionist', 'doctor'), completeVisit);

// 🔬 Lab Referral Routes
router.patch('/refer/lab/:queueId', authorize('receptionist', 'doctor'), referToLab);
router.patch('/lab/complete/:queueId', authorize('lab', 'admin'), completeLabTask);

// Medical History
router.get('/history', authorize('admin', 'doctor'), getMedicalHistory);

module.exports = router;