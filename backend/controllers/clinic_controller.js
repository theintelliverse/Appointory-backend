const Clinic = require('../models/Clinic');

/**
 * @desc    Get current clinic profile details
 * @route   GET /api/clinic/me
 * @access  Private (Admin)
 */
exports.getClinicProfile = async (req, res) => {
    try {
        const clinic = await Clinic.findById(req.user.clinicId);
        
        if (!clinic) {
            return res.status(404).json({ 
                success: false, 
                message: "Clinic profile not found." 
            });
        }

        res.status(200).json({ 
            success: true, 
            data: clinic 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};

/**
 * @desc    Update clinic settings (Name, Code, Contact, Address)
 * @route   PATCH /api/clinic/settings
 * @access  Private (Admin)
 */
exports.updateClinicSettings = async (req, res) => {
    try {
        const { name, address, contactNumber, clinicCode } = req.body;
        const clinicId = req.user.clinicId;

        // 1. Unique Clinic Code Validation
        if (clinicCode) {
            const existing = await Clinic.findOne({ 
                clinicCode: clinicCode.toUpperCase(), 
                _id: { $ne: clinicId } 
            });
            if (existing) {
                return res.status(400).json({ 
                    success: false, 
                    message: "This Clinic Code is already taken by another facility." 
                });
            }
        }

        // 2. Update Clinic
        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            { 
                name, 
                address, 
                contactNumber, 
                clinicCode: clinicCode ? clinicCode.toUpperCase() : undefined 
            },
            { new: true, runValidators: true }
        );

        if (!updatedClinic) {
            return res.status(404).json({ 
                success: false, 
                message: "Update failed. Clinic record not found." 
            });
        }

        // 📢 SOCKET UPDATE: Notify all connected devices in the clinic
        // This ensures the TV Display and Dashboards update branding instantly
        if (req.io) {
            req.io.to(clinicId.toString()).emit('clinicSettingsUpdated', {
                name: updatedClinic.name,
                clinicCode: updatedClinic.clinicCode
            });
        }

        res.status(200).json({ 
            success: true, 
            message: "Clinic settings updated successfully", 
            data: updatedClinic 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
};

/**
 * @desc    Deactivate Clinic
 */
exports.deactivateClinic = async (req, res) => {
    try {
        // Broadcast deactivation if necessary
        res.status(501).json({ 
            success: false, 
            message: "Deactivation requires manual verification for data safety." 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};