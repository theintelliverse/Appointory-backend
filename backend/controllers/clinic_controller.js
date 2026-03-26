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
        const {
            name,
            address,
            contactNumber,
            contactPhone,
            clinicCode,
            openingTime,
            closingTime,
            breakStartTime,
            breakEndTime,
            slotDurationMinutes,
            workingDays
        } = req.body;
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
                contactPhone: contactPhone || contactNumber,
                clinicCode: clinicCode ? clinicCode.toUpperCase() : undefined,
                openingTime,
                closingTime,
                breakStartTime,
                breakEndTime,
                slotDurationMinutes,
                workingDays
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

/**
 * @desc    Get all active clinics (PUBLIC - for patient browsing)
 * @route   GET /api/clinic/public/list
 * @access  Public
 */
exports.getAllClinics = async (req, res) => {
    try {
        console.log('📋 Fetching all active clinics...');
        
        const User = require('../models/User');
        
        const clinics = await Clinic.find({ isActive: true }).select('_id name address contactPhone clinicCode openingTime closingTime breakStartTime breakEndTime slotDurationMinutes workingDays');
        
        // For each clinic, fetch the count of active doctors
        const clinicsWithDoctorCount = await Promise.all(
            clinics.map(async (clinic) => {
                const doctorCount = await User.countDocuments({
                    clinicId: clinic._id,
                    role: 'doctor',
                    isActive: true
                });
                return {
                    ...clinic.toObject(),
                    doctorCount
                };
            })
        );
        
        console.log(`✅ Found ${clinicsWithDoctorCount.length} clinics with doctor counts`);
        
        res.status(200).json({
            success: true,
            data: clinicsWithDoctorCount,
            count: clinicsWithDoctorCount.length
        });
    } catch (error) {
        console.error('❌ Error fetching clinics:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get doctors by clinic (PUBLIC - for patient appointment booking)
 * @route   GET /api/clinic/public/doctors/:clinicId
 * @access  Public
 */
exports.getClinicDoctors = async (req, res) => {
    try {
        const User = require('../models/User');
        const { clinicId } = req.params;

        console.log(`🔍 Searching for doctors with clinicId: ${clinicId}, role: doctor, isActive: true`);

        const doctors = await User.find({
            clinicId,
            role: 'doctor',
            isActive: true
        }).select('_id name specialization isAvailable experience education');

        console.log(`✅ Found ${doctors.length} doctors for clinic ${clinicId}`);

        res.status(200).json({
            success: true,
            data: doctors,
            count: doctors.length,
            clinicId: clinicId
        });
    } catch (error) {
        console.error('❌ Error fetching doctors:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get booked appointment slots for a doctor at a clinic
 * @route   GET /api/clinic/public/booked-slots/:clinicId/:doctorId
 * @access  Public
 * @query   startDate, endDate (ISO format)
 */
exports.getBookedSlots = async (req, res) => {
    try {
        const Patient = require('../models/Patient');
        const { clinicId, doctorId } = req.params;
        const { startDate, endDate } = req.query;

        console.log(`🔍 Fetching booked slots for doctor ${doctorId} at clinic ${clinicId}`);
        console.log(`   Date range: ${startDate} to ${endDate}`);

        // Query all patients with appointments for this doctor/clinic in the date range
        const patients = await Patient.find({
            'appointments.clinicId': clinicId,
            'appointments.doctorId': doctorId,
            'appointments.status': 'Scheduled'
        });

        // Extract the booked appointment times
        const bookedSlots = [];
        patients.forEach(patient => {
            patient.appointments.forEach(apt => {
                if (
                    apt.clinicId.toString() === clinicId &&
                    apt.doctorId.toString() === doctorId &&
                    apt.status === 'Scheduled'
                ) {
                    const apptDate = new Date(apt.appointmentDate);
                    
                    // If date range provided, filter by it
                    if (startDate && endDate) {
                        const start = new Date(startDate);
                        const end = new Date(endDate);
                        if (apptDate >= start && apptDate <= end) {
                            bookedSlots.push({
                                appointmentDate: apt.appointmentDate,
                                timeSlot: apptDate.toISOString().slice(0, 16)
                            });
                        }
                    } else {
                        bookedSlots.push({
                            appointmentDate: apt.appointmentDate,
                            timeSlot: apptDate.toISOString().slice(0, 16)
                        });
                    }
                }
            });
        });

        console.log(`✅ Found ${bookedSlots.length} booked slots`);

        res.status(200).json({
            success: true,
            data: bookedSlots,
            count: bookedSlots.length
        });
    } catch (error) {
        console.error('❌ Error fetching booked slots:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};