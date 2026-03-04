const Patient = require("../models/Patient");
const Queue = require("../models/Queue");
const User = require("../models/User");
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
        if (!phone) return res.status(400).json({ message: "Phone number is required" });

        const cleanPhone = phone.replace(/\D/g, '').slice(-10); 
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store with 5-minute expiry
        otpStore[cleanPhone] = { otp, expires: Date.now() + 300000 };

        const formattedPhone = `+91${cleanPhone}`;

        // --- 🚀 REAL SMS CODE ---
        try {
            await client.messages.create({
                body: `Your appointory OTP is: ${otp}. Valid for 5 minutes. Please do not share this with anyone.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });

            /* --- CONSOLE LOGS COMMENTED OUT ---
            console.log("-----------------------------------------");
            console.log(`📱 SMS SENT TO: ${formattedPhone}`);
            console.log(`🔑 OTP: ${otp}`);
            console.log("-----------------------------------------");
            */

            res.status(200).json({ 
                success: true, 
                message: "OTP sent successfully to your mobile." 
            });

        } catch (smsError) {
            console.error("❌ Twilio Error:", smsError.message);
            // Fallback for developers if SMS fails (optional: remove in final prod)
            console.log(`Fallback OTP for ${cleanPhone}: ${otp}`);
            
            res.status(500).json({ 
                success: false, 
                message: "Failed to send SMS. Please check the phone number." 
            });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: "Internal Server Error" });
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
        if (!phone || !otp) {
            return res.status(400).json({ message: "Phone and OTP are required" });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10); 
        const record = otpStore[cleanPhone];

        if (!record || record.otp !== otp || record.expires < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        delete otpStore[cleanPhone];
        
        const phoneRegex = new RegExp(cleanPhone + '$');
        
        const [lockerPatient, medicalHistory] = await Promise.all([
            Patient.findOne({ phone: phoneRegex }),
            MedicalRecord.findOne({ patientPhone: phoneRegex })
        ]);

        if (!lockerPatient && !medicalHistory) {
            return res.status(404).json({ 
                success: false,
                message: "No health records found for this number." 
            });
        }

        const userId = lockerPatient?._id || medicalHistory?._id;
        const userName = lockerPatient?.name || medicalHistory?.patientName || "Valued Patient";

        const token = generateToken({ 
            id: userId.toString(), 
            phone: cleanPhone,
            role: 'patient' 
        });

        /* --- CONSOLE LOG COMMENTED OUT ---
        console.log(`✅ Patient Verified: ${userName} (${cleanPhone})`);
        */

        res.status(200).json({
            success: true,
            token,
            patient: { 
                name: userName, 
                phone: cleanPhone 
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
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