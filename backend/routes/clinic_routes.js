const express = require('express');
const router = express.Router();
const clinicController = require('../controllers/clinic_controller');
const { protect, authorize } = require('../utils/auth_middleware');

/**
 * PUBLIC ROUTES (No Authentication Required)
 */
router.get('/public/list', clinicController.getAllClinics);
router.get('/public/doctors/:clinicId', clinicController.getClinicDoctors);
router.get('/public/booked-slots/:clinicId/:doctorId', clinicController.getBookedSlots);

/**
 * PROTECTED ROUTES (Admin Only)
 * All routes below require the user to be logged in and have the 'admin' role.
 */

/**
 * @route   GET /api/clinic/me
 * @desc    Fetch current clinic details for the Settings page
 * @access  Private (Admin)
 */
router.get('/me', protect, authorize('admin'), clinicController.getClinicProfile);

/**
 * @route   PATCH /api/clinic/settings
 * @desc    Update Clinic Name, Code, Address, or Contact Number
 * @access  Private (Admin)
 */
router.patch('/settings', protect, authorize('admin'), clinicController.updateClinicSettings);

/**
 * @route   DELETE /api/clinic/deactivate
 * @desc    Request clinic deactivation (Danger Zone)
 * @access  Private (Admin)
 */
router.delete('/deactivate', protect, authorize('admin'), clinicController.deactivateClinic);

module.exports = router;