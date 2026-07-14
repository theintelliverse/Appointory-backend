const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/lab_connection_controller');
const { protect, authorize, protectLab } = require('../utils/auth_middleware');

// =============================================
// 🌐 PUBLIC — Any authenticated clinic user can search labs
// =============================================
router.get('/search', protect, ctrl.searchLabs);

// =============================================
// 🏥 CLINIC ROUTES (Clinic Admin Only)
// =============================================
router.post('/request', protect, authorize('admin'), ctrl.sendConnectionRequest);
router.get('/clinic', protect, authorize('admin'), ctrl.getClinicConnections);
router.get('/clinic/labs', protect, authorize('admin'), ctrl.getAllLabsForClinic);
router.patch('/clinic/:id/respond', protect, authorize('admin'), ctrl.respondToConnectionByClinic);
router.delete('/:id', protect, authorize('admin'), ctrl.disconnectLab);

// Send a test request to a connected lab
router.post('/request-test', protect, authorize('admin', 'doctor', 'receptionist'), ctrl.sendTestRequest);

// Clinic views its sent test requests
router.get('/test-requests/clinic', protect, ctrl.getClinicTestRequests);

// =============================================
// 🔬 INDEPENDENT LAB ROUTES (Lab Token)
// =============================================
router.get('/lab', protectLab, ctrl.getLabConnections);
router.patch('/:id/respond', protectLab, ctrl.respondToConnection);
router.get('/lab/clinics', protectLab, ctrl.getClinicsForLab);
router.post('/lab/request', protectLab, ctrl.sendLabRequestToClinic);

// Lab views received test requests
router.get('/test-requests/lab', protectLab, ctrl.getLabTestRequests);

// Lab creates a test request manually
router.post('/test-requests/lab/create', protectLab, ctrl.createLabTestRequest);

// Lab updates status of a test request
router.patch('/test-requests/:id/status', protectLab, ctrl.updateRequestStatus);

// Lab uploads report for a test request
router.post('/test-requests/:id/upload-report', protectLab, ctrl.uploadReportForRequest);

module.exports = router;
