const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Patient = require('../models/Patient'); 
const { hashPassword } = require('../utils/auth_helper');
const sendStaffCredentials = require('../utils/send_email');

// --- ➕ ADD STAFF ---
exports.addStaff = async (req, res) => {
    try {
        const { name, email, password, role, specialization } = req.body;
        const clinicId = req.user.clinicId; 

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: "A user with this email is already registered." 
            });
        }

        const hashedPassword = await hashPassword(password);

        const newStaff = await User.create({
            clinicId,
            name,
            email,
            password: hashedPassword,
            role,
            specialization: role === 'doctor' ? specialization : undefined,
            isAvailable: true,
            isActive: true, // Ensuring soft-delete readiness
            bio: "",
            education: "",
            experience: 0,
            phoneNumber: ""
        });

        // 📢 SOCKET EMIT: Notify Admin to refresh the staff list
        if (req.io) req.io.to(clinicId.toString()).emit('staffListUpdated');

        const clinic = await Clinic.findById(clinicId);

        try {
            await sendStaffCredentials(
                email, 
                password, 
                name, 
                role, 
                clinic ? clinic.name : "Our Clinic"
            );
        } catch (mailError) {
            console.error("Nodemailer Error:", mailError);
        }

        res.status(201).json({
            success: true,
            message: `${role.charAt(0).toUpperCase() + role.slice(1)} added and credentials emailed!`,
            staff: { id: newStaff._id, name: newStaff.name, role: newStaff.role }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 🔑 RESEND CREDENTIALS ---
exports.resendCredentials = async (req, res) => {
    try {
        const { staffId, newTemporaryPassword } = req.body;
        const staff = await User.findById(staffId);
        const clinic = await Clinic.findById(req.user.clinicId);

        if (!staff) return res.status(404).json({ message: "Staff not found" });

        staff.password = await hashPassword(newTemporaryPassword);
        await staff.save();

        await sendStaffCredentials(staff.email, newTemporaryPassword, staff.name, staff.role, clinic.name);

        res.status(200).json({ success: true, message: "Credentials resent successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 📋 GET ALL STAFF ---
exports.getAllStaff = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const staffMembers = await User.find({ clinicId })
            .select('-password')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, count: staffMembers.length, staff: staffMembers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.toggleAvailability = async (req, res) => {
    try {
        const { staffId } = req.params;
        const targetId = staffId === 'me' ? req.user.id : staffId;
        
        const user = await User.findById(targetId);
        if (!user) return res.status(404).json({ message: "Staff member not found" });

        user.isAvailable = !user.isAvailable;
        await user.save();

        // 📢 DEBUG LOG
        console.log(`🩺 Emit: doctorStatusChanged for Dr. ${user.name} to Room: ${user.clinicId}`);
        if (req.io) {
            req.io.to(user.clinicId.toString()).emit('doctorStatusChanged', {
                doctorId: user._id,
                isAvailable: user.isAvailable
            });
        }

        res.status(200).json({ success: true, isAvailable: user.isAvailable });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
// --- 🏥 PUBLIC: GET DOCTORS ---
// --- 🏥 PUBLIC: GET DOCTORS (Update this in staff_controller.js) ---
exports.getPublicDoctors = async (req, res) => {
    try {
        console.log("IO EXISTS:", !!req.io);
        const { clinicCode } = req.params;
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });

        const doctors = await User.find({ 
            clinicId: clinic._id, 
            role: 'doctor'
        }).select('name specialization education experience _id isAvailable'); // 🔑 Added isAvailable here

        res.status(200).json({ success: true, clinicName: clinic.name, doctors });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 🗄️ GET PATIENT FULL PROFILE (The Digital Locker) ---
exports.getPatientFullProfile = async (req, res) => {
    try {
        const { phone } = req.params;
        
        // Normalize phone to search (last 10 digits)
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$') });
        
        if (!patient) {
            return res.status(404).json({ 
                success: false, 
                message: "This patient hasn't set up a Digital Locker yet." 
            });
        }

        res.status(200).json({
            success: true,
            data: patient
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 🗑️ HARD DELETE STAFF (Keep for cleanup) ---
exports.deleteStaff = async (req, res) => {
    try {
        const { staffId } = req.params;
        if (req.user.id === staffId) {
            return res.status(400).json({ success: false, message: "Security violation: Self-deletion blocked." });
        }

        const user = await User.findByIdAndDelete(staffId);
        if (!user) return res.status(404).json({ success: false, message: "Staff member not found." });

        // 📢 SOCKET EMIT: Refresh Admin UI
        if (req.io) req.io.to(user.clinicId.toString()).emit('staffListUpdated');

        res.status(200).json({ success: true, message: "Staff member removed successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updatePatientProfile = async (req, res) => {
    try {
        const { phone } = req.params;
        const { age, gender, bloodGroup, vitals } = req.body;

        // Find patient by last 10 digits to handle country code variations
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$') });

        if (!patient) return res.status(404).json({ success: false, message: "Patient not found" });

        // 1. Update Personal Basic Info
        if (age) patient.age = age;
        if (gender) patient.gender = gender;
        if (bloodGroup) patient.bloodGroup = bloodGroup;

        // 2. Push New Vitals Entry (if provided)
        if (vitals) {
            patient.vitals.push({
                ...vitals,
                recordedBy: req.user.id,
                recordedAt: Date.now()
            });
        }

        await patient.save();

        res.status(200).json({
            success: true,
            message: "Patient health profile updated successfully",
            data: patient
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// --- 🗄️ ARCHIVE STAFF ---
exports.archiveStaff = async (req, res) => {
    try {
        const { staffId } = req.params;

        const user = await User.findByIdAndUpdate(staffId, { 
            isActive: false, 
            deletedAt: Date.now() 
        }, { new: true });

        if (!user) return res.status(404).json({ message: "Staff not found" });

        // 📢 SOCKET EMIT: Remove from active UI lists immediately
        if (req.io) req.io.to(user.clinicId.toString()).emit('staffListUpdated');

        res.status(200).json({ 
            success: true, 
            message: "Staff member archived. Access revoked but records preserved." 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};