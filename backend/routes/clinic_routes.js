const express = require('express');
const router = express.Router();
const clinicController = require('../controllers/clinic_controller');
const { protect, authorize } = require('../utils/auth_middleware');

/**
 * All routes in this file require the user to be logged in 
 * and have the 'admin' role.
 */
router.use(protect);
router.use(authorize('admin'));

/**
 * @route   GET /api/clinic/me
 * @desc    Fetch current clinic details for the Settings page
 * @access  Private (Admin)
 */
router.get('/me', clinicController.getClinicProfile);

/**
 * @route   PATCH /api/clinic/settings
 * @desc    Update Clinic Name, Code, Address, or Contact Number
 * @access  Private (Admin)
 */
router.patch('/settings', clinicController.updateClinicSettings);

/**
 * @route   DELETE /api/clinic/deactivate
 * @desc    Request clinic deactivation (Danger Zone)
 * @access  Private (Admin)
 */
router.delete('/deactivate', clinicController.deactivateClinic);

module.exports = router;