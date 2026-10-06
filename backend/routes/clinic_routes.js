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
 * @route   GET /api/clinic/seo
 * @desc    Fetch clinic SEO & Google listing settings
 * @access  Private (Admin only)
 */
router.get('/seo', protect, authorize('admin'), clinicController.getClinicSeo);

const multer = require('multer');
const { storage } = require('../utils/cloudinary_config');
const upload = multer({ storage });

/**
 * @route   POST /api/clinic/upload-og-image
 * @desc    Upload OG preview image to Cloudinary
 * @access  Private (Admin only)
 */
router.post('/upload-og-image', protect, authorize('admin'), upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image uploaded' });
        }
        const imageUrl = req.file.path || req.file.secure_url;
        return res.status(200).json({ success: true, url: imageUrl });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @route   PUT /api/clinic/seo
 * @desc    Update clinic SEO & Google listing settings
 * @access  Private (Admin only)
 */
router.put('/seo', protect, authorize('admin'), clinicController.updateClinicSeo);

/**
 * @route   DELETE /api/clinic/deactivate
 * @desc    Request clinic deactivation (Danger Zone)
 * @access  Private (Admin)
 */
router.delete('/deactivate', protect, authorize('admin'), clinicController.deactivateClinic);

module.exports = router;