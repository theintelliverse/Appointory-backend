const Patient = require("../models/Patient");
const Queue = require("../models/Queue");
const User = require("../models/User");
const Clinic = require("../models/Clinic");
const { generateToken } = require('../utils/auth_helper');
const MedicalRecord = require('../models/MedicalRecord');

// 🔑 TWILIO INITIALIZATION
const twilio = require('twilio');
const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Temporary store for OTPs (In production, use Redis)
let otpStore = {};

/**
 * 1️⃣ SEND OTP (Real SMS via Twilio)
 */
exports.sendOTP = async (req, res) => {
    try {
        let { phone } = req.body;

        // ✅ Validate phone input
        if (!phone) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        // ✅ Validate phone length
        if (cleanPhone.length !== 10) {
            return res.status(400).json({
                success: false,
                message: "Invalid phone number. Please enter a 10-digit number."
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // ✅ Store with 5-minute expiry
        otpStore[cleanPhone] = { otp, expires: Date.now() + 300000 };
        console.log(`✅ OTP Generated for ${cleanPhone}: ${otp} (Expires in 5 min)`);

        const formattedPhone = `+91${cleanPhone}`;

        // --- 🚀 REAL SMS CODE ---
        try {
            // ✅ Check if Twilio credentials are configured
            if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
                throw new Error('Twilio credentials not configured');
            }

            const response = await client.messages.create({
                body: `Your appointory OTP is: ${otp}. Valid for 5 minutes. Please do not share this with anyone.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });

            console.log(`📱 SMS SENT successfully to ${formattedPhone} | SID: ${response.sid}`);

            res.status(200).json({
                success: true,
                message: "OTP sent successfully to your mobile. Please check your phone.",
                debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined
            });

        } catch (smsError) {
            console.error(`❌ Twilio SMS Error: ${smsError.message}`);
            // ✅ Show fallback OTP in development mode for testing
            console.log(`📋 DEVELOPMENT FALLBACK OTP for ${cleanPhone}: ${otp}`);

            res.status(500).json({
                success: false,
                message: "Failed to send SMS. Please check the phone number and try again.",
                debugOtp: process.env.NODE_ENV === 'development' ? otp : undefined
            });
        }

    } catch (error) {
        console.error(`❌ Send OTP Error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Error sending OTP. Please try again later."
        });
    }
};

/**
 * 2️⃣ VERIFY OTP FOR CHECK-IN
 */
exports.verifyOTPForCheckin = async (req, res) => {
    try {
        let { phone, otp } = req.body;
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const record = otpStore[cleanPhone];

        if (!record || record.otp !== otp || record.expires < Date.now()) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        delete otpStore[cleanPhone]; // Clear OTP after use

        res.status(200).json({
            success: true,
            message: "Phone verified. You can now request check-in.",
            phone: cleanPhone
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 3️⃣ REQUEST CHECK-IN
 */
exports.requestCheckIn = async (req, res) => {
    try {
        const { phone, name, clinicCode, doctorId, visitType } = req.body;
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        const clinic = await User.findOne({ clinicCode: clinicCode.toUpperCase(), role: 'admin' });
        if (!clinic) return res.status(404).json({ message: "Invalid Clinic Code" });

        const pendingEntry = await Queue.create({
            clinicId: clinic.clinicId || clinic._id,
            doctorId,
            patientName: name,
            patientPhone: cleanPhone,
            visitType: visitType || 'Walk-in',
            status: 'Pending-Approval',
            isApproved: false
        });

        if (req.io) {
            const roomName = (clinic.clinicId || clinic._id).toString();
            req.io.to(roomName).emit('newCheckInRequest', {
                message: `New request from ${name}`,
                requestId: pendingEntry._id
            });
        }

        res.status(200).json({
            success: true,
            message: "Request sent. Waiting for receptionist approval.",
            requestId: pendingEntry._id
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 4️⃣ VERIFY OTP FOR LOCKER ACCESS (Dual-Lookup Enabled)
 */
exports.verifyLockerOTP = async (req, res) => {
    try {
        let { phone, otp } = req.body;

        // ✅ Validate input
        if (!phone || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone and OTP are required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const record = otpStore[cleanPhone];

        // ✅ Check if OTP exists
        if (!record) {
            console.warn(`⚠️  No OTP found for phone: ${cleanPhone}`);
            return res.status(400).json({
                success: false,
                message: "OTP not found. Please request a new OTP."
            });
        }

        // ✅ Check if OTP is correct
        if (record.otp !== otp) {
            console.warn(`⚠️  Invalid OTP attempt for phone: ${cleanPhone}`);
            return res.status(400).json({
                success: false,
                message: "OTP is incorrect. Please try again."
            });
        }

        // ✅ Check if OTP is expired
        if (record.expires < Date.now()) {
            delete otpStore[cleanPhone];
            console.warn(`⚠️  Expired OTP for phone: ${cleanPhone}`);
            return res.status(400).json({
                success: false,
                message: "OTP has expired. Please request a new OTP."
            });
        }

        // ✅ OTP is valid, delete it
        delete otpStore[cleanPhone];
        console.log(`✅ OTP verified for phone: ${cleanPhone}`);

        const phoneRegex = new RegExp(cleanPhone + '$');

        // ✅ Look up patient and medical records
        const [lockerPatient, medicalHistory] = await Promise.all([
            Patient.findOne({ phone: phoneRegex }),
            MedicalRecord.findOne({ patientPhone: phoneRegex })
        ]);

        // ✅ Check if patient exists
        if (!lockerPatient && !medicalHistory) {
            console.warn(`⚠️  No health records found for phone: ${cleanPhone}`);
            return res.status(404).json({
                success: false,
                message: "No health records found for this number. Please register first."
            });
        }

        const userId = lockerPatient?._id || medicalHistory?._id;
        const userName = lockerPatient?.name || medicalHistory?.patientName || "Valued Patient";

        const token = generateToken({
            id: userId.toString(),
            phone: cleanPhone,
            role: 'patient'
        });

        console.log(`✅ Patient Verified: ${userName} (${cleanPhone})`);

        res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            token,
            patient: {
                name: userName,
                phone: cleanPhone
            }
        });
    } catch (error) {
        console.error(`❌ Verify Locker OTP Error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: "Error verifying OTP. Please try again.",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * 5️⃣ PUBLIC LIVE STATUS
 */
exports.getPublicQueueStatus = async (req, res) => {
    try {
        const { queueId } = req.params;

        const entry = await Queue.findById(queueId)
            .populate('doctorId', 'name isAvailable')
            .populate('clinicId', 'name');

        if (!entry) return res.status(404).json({ message: "Token not found" });

        if (!entry.isApproved) {
            return res.status(200).json({ success: true, isPendingApproval: true });
        }

        if (entry.status === 'Completed') {
            return res.status(200).json({ isCompleted: true });
        }

        const peopleAhead = await Queue.countDocuments({
            doctorId: entry.doctorId._id,
            status: 'Waiting',
            createdAt: { $lt: entry.createdAt },
            isApproved: true
        });

        res.status(200).json({
            success: true,
            data: {
                patientName: entry.patientName,
                tokenNumber: entry.tokenNumber,
                status: entry.status,
                clinicName: entry.clinicId.name,
                peopleAhead,
                estimatedWait: (peopleAhead * 12),
                isDoctorOnBreak: !entry.doctorId.isAvailable
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 6️⃣ PATIENT SELF-REGISTRATION
 */
exports.registerPatient = async (req, res) => {
    try {
        const { phone, name, age, gender, bloodGroup } = req.body;

        if (!phone || !name) {
            return res.status(400).json({ success: false, message: "Phone and name are required" });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        // Check if patient already exists
        let patient = await Patient.findOne({ phone: cleanPhone });

        if (patient) {
            return res.status(400).json({ success: false, message: "Phone number already registered" });
        }

        // Create new patient
        patient = await Patient.create({
            name,
            phone: cleanPhone,
            age: age || null,
            gender: gender || null,
            bloodGroup: bloodGroup || null
        });

        const token = generateToken({
            id: patient._id.toString(),
            phone: cleanPhone,
            role: 'patient'
        });

        res.status(201).json({
            success: true,
            message: "Patient registered successfully",
            token,
            patient: {
                id: patient._id,
                name: patient.name,
                phone: cleanPhone
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 7️⃣ BOOK APPOINTMENT
 */
exports.bookAppointment = async (req, res) => {
    try {
        const { clinicId, doctorId, appointmentDate } = req.body;
        const patientId = req.user?.id;

        console.log('🔍 Booking appointment:', { clinicId, doctorId, appointmentDate, patientId });

        if (!clinicId || !doctorId || !appointmentDate) {
            return res.status(400).json({ success: false, message: "Clinic, doctor, and date are required" });
        }

        // Get patient info
        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found" });
        }

        // Get clinic and doctor info
        const clinic = await Clinic.findById(clinicId);
        const doctor = await User.findById(doctorId);

        if (!clinic) {
            console.error(`❌ Clinic not found with ID: ${clinicId}`);
            return res.status(404).json({ success: false, message: "Clinic not found. Please select a valid clinic." });
        }

        if (!doctor) {
            console.error(`❌ Doctor not found with ID: ${doctorId}`);
            return res.status(404).json({ success: false, message: "Doctor not found. Please select a valid doctor." });
        }

        console.log(`✅ Found clinic: ${clinic.name}, doctor: Dr. ${doctor.name}`);

        // Create queue entry for appointment
        const queueEntry = await Queue.create({
            clinicId,
            doctorId,
            patientName: patient.name,
            patientPhone: patient.phone,
            visitType: 'Appointment',
            status: 'Waiting',
            isApproved: true,
            isEmergency: false
        });

        // Add appointment to patient record
        patient.appointments.push({
            queueId: queueEntry._id,
            clinicId,
            clinicName: clinic.name,
            doctorId,
            doctorName: doctor.name,
            appointmentDate: new Date(appointmentDate),
            status: 'Scheduled'
        });

        await patient.save();

        // Send confirmation SMS
        const formattedPhone = `+91${patient.phone}`;
        try {
            await client.messages.create({
                body: `Your appointment is confirmed at ${clinic.name} with Dr. ${doctor.name}. Date: ${new Date(appointmentDate).toLocaleDateString()}. Token: ${queueEntry._id}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            console.log(`📱 SMS sent to ${formattedPhone}`);
        } catch (smsError) {
            console.error("❌ SMS Error:", smsError.message);
        }

        res.status(201).json({
            success: true,
            message: "Appointment booked successfully",
            data: {
                appointmentId: queueEntry._id,
                clinicName: clinic.name,
                doctorName: doctor.name,
                appointmentDate,
                status: 'Scheduled'
            }
        });
    } catch (error) {
        console.error('❌ Booking appointment error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to book appointment. Please try again.'
        });
    }
};

/**
 * 8️⃣ GET PATIENT APPOINTMENTS
 */
exports.getPatientAppointments = async (req, res) => {
    try {
        const patientId = req.user?.id;

        const patient = await Patient.findById(patientId)
            .populate('appointments.clinicId', 'name')
            .populate('appointments.doctorId', 'name specialization');

        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found" });
        }

        res.status(200).json({
            success: true,
            data: patient.appointments
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 9️⃣ PATIENT FORGOT PASSWORD - SEND OTP
 */
exports.patientForgotPassword = async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone number is required" });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        // Check if patient exists
        const phoneRegex = new RegExp(cleanPhone + '$');
        const patient = await Patient.findOne({ phone: phoneRegex });

        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found with this phone number" });
        }

        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore[cleanPhone] = {
            otp,
            expires: Date.now() + 300000,
            type: 'password-reset'
        };

        const formattedPhone = `+91${cleanPhone}`;

        // Send OTP via SMS
        try {
            await client.messages.create({
                body: `Your password reset OTP is: ${otp}. Valid for 5 minutes. Do not share this with anyone.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
        } catch (smsError) {
            console.error("SMS Error:", smsError.message);
            return res.status(500).json({ success: false, message: "Failed to send OTP" });
        }

        res.status(200).json({
            success: true,
            message: "OTP sent to your phone number"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 🔟 PATIENT RESET PASSWORD WITH OTP
 */
exports.patientResetPassword = async (req, res) => {
    try {
        const { phone, otp, newPassword } = req.body;

        if (!phone || !otp || !newPassword) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const record = otpStore[cleanPhone];

        // Verify OTP
        if (!record || record.otp !== otp || record.expires < Date.now()) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        if (record.type !== 'password-reset') {
            return res.status(400).json({ success: false, message: "Invalid OTP type" });
        }

        const phoneRegex = new RegExp(cleanPhone + '$');
        const patient = await Patient.findOne({ phone: phoneRegex });

        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found" });
        }

        // Note: Patient model doesn't have password field as they use OTP
        // This is for future-proofing if they add password-based login
        // For now, just confirm OTP success
        delete otpStore[cleanPhone];

        res.status(200).json({
            success: true,
            message: "Password request verified. Please login with OTP.",
            patientPhone: cleanPhone
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 🗑️ REMOVE BROKEN DOCUMENT from Patient Locker
 */
exports.removeDocument = async (req, res) => {
    try {
        const { documentId } = req.params;
        const { phone } = req.body;

        if (!documentId || !phone) {
            return res.status(400).json({
                success: false,
                message: "Document ID and phone number are required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        // Find patient by phone
        const patient = await Patient.findOne({ phone: cleanPhone });

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found"
            });
        }

        // Remove document from patient's documents array
        patient.documents = patient.documents.filter(doc => doc._id.toString() !== documentId);
        await patient.save();

        console.log(`✅ Document ${documentId} removed from patient ${cleanPhone}`);

        res.status(200).json({
            success: true,
            message: "Broken document removed from your health locker",
            remainingDocuments: patient.documents.length
        });
    } catch (error) {
        console.error('Error removing document:', error);
        res.status(500).json({
            success: false,
            message: "Failed to remove document: " + error.message
        });
    }
};