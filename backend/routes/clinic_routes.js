const express = require('express');
const router = express.Router();
const clinicController = require('../controllers/clinic_controller');
const { protect, authorize } = require('../utils/auth_middleware');

/**
 * PUBLIC ROUTES (No Authentication Required)
 */
router.get('/public/list', clinicController.getAllClinics);
router.get('/public/queues-live', clinicController.getAllClinicsQueues);
router.get('/public/doctors/:clinicId', clinicController.getClinicDoctors);
router.get('/public/booked-slots/:clinicId/:doctorId', clinicController.getBookedSlots);
router.get('/public/:clinicId', clinicController.getPublicClinicDetails);
router.get('/public/leaves/:clinicId', clinicController.getPublicClinicLeaves);

/**
 * PROTECTED ROUTES (Admin Only)
 * All routes below require the user to be logged in and have the 'admin' role.
 */

/**
 * @route   GET /api/clinic/leaves
 * @desc    Get all leaves & holidays for the clinic
 * @access  Private (Admin)
 */
router.get('/leaves', protect, authorize('admin'), clinicController.getClinicLeaves);

/**
 * @route   POST /api/clinic/leaves
 * @desc    Add a new holiday or doctor leave
 * @access  Private (Admin)
 */
router.post('/leaves', protect, authorize('admin'), clinicController.addClinicLeave);

/**
 * @route   DELETE /api/clinic/leaves/:leaveId
 * @desc    Delete a leave or holiday
 * @access  Private (Admin)
 */
router.delete('/leaves/:leaveId', protect, authorize('admin'), clinicController.deleteClinicLeave);

/**
 * @route   PATCH /api/clinic/doctor-schedule/:doctorId
 * @desc    Update a doctor's weekly available working days
 * @access  Private (Admin)
 */
router.patch('/doctor-schedule/:doctorId', protect, authorize('admin'), clinicController.updateDoctorSchedule);

/**
 * @route   GET /api/clinic/me
 * @desc    Fetch current clinic details for the Settings page
 * @access  Private (Admin)
 */
router.get('/me', protect, authorize('admin', 'lab'), clinicController.getClinicProfile);

/**
 * @route   PATCH /api/clinic/settings
 * @desc    Update Clinic Name, Code, Address, or Contact Number
 * @access  Private (Admin)
 */
router.patch('/settings', protect, authorize('admin', 'lab'), clinicController.updateClinicSettings);

/**
 * @route   PATCH /api/clinic/inventory
 * @desc    Update Pharmacy Inventory for the Clinic
 * @access  Private (Admin)
 */
router.patch('/inventory', protect, authorize('admin', 'lab'), clinicController.updateInventory);

/**
 * @route   DELETE /api/clinic/deactivate
 * @desc    Request clinic deactivation (Danger Zone)
 * @access  Private (Admin)
 */
router.delete('/deactivate', protect, authorize('admin'), clinicController.deactivateClinic);

module.exports = router;