const Patient = require("../models/Patient");
const Queue = require("../models/Queue");
const User = require("../models/User");
const Clinic = require("../models/Clinic");
const { generateToken } = require('../utils/auth_helper');
const { normalizeIndianPhone } = require('../utils/phone_helper');
const MedicalRecord = require('../models/MedicalRecord');
const Otp = require('../models/Otp');
const bcrypt = require('bcryptjs');
const { generateSecureOtp, storeSecureOtp, verifyAndConsumeOtp } = require('../utils/otp_helper');

// 🔑 TWILIO INITIALIZATION
const twilio = require('twilio');
const getTwilioClient = () => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) return null;
    try {
        return twilio(accountSid, authToken);
    } catch (e) {
        console.error("Twilio client init error:", e.message);
        return null;
    }
};

/**
 * 1️⃣ SEND OTP (Real SMS via Twilio)
 */
exports.sendOTP = async (req, res) => {
    try {
        const { phone, isRegistration } = req.body;
        const { isValid, normalized: cleanPhone, error: phoneError } = normalizeIndianPhone(phone);

        if (!isValid) {
            return res.status(400).json({ success: false, message: phoneError });
        }

        // CHECK FOR DUPLICATE REGISTRATION
        if (isRegistration) {
            const existingPatient = await Patient.findOne({
                phone: cleanPhone,
                $or: [
                    { isPrimaryAccount: true },
                    { passwordHash: { $exists: true, $ne: null } }
                ]
            });
            if (existingPatient) {
                return res.status(400).json({
                    success: false,
                    message: "This phone number is already registered. Please login instead.",
                    isDuplicate: true
                });
            }
        }

        const otp = generateSecureOtp();
        await storeSecureOtp({ identifier: cleanPhone, type: 'patient_phone', otp, expiryMinutes: 5 });

        const formattedPhone = `+91${cleanPhone}`;

        // REAL SMS CODE
        try {
            const client = getTwilioClient();
            if (!client || !process.env.TWILIO_PHONE_NUMBER) {
                return res.status(200).json({
                    success: true,
                    message: process.env.NODE_ENV === 'development'
                        ? "OTP generated (Twilio not configured)."
                        : "OTP service not configured."
                });
            }

            await client.messages.create({
                body: `Your appointory OTP is: ${otp}. Valid for 5 minutes.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });

            res.status(200).json({
                success: true,
                message: "OTP sent successfully!"
            });

        } catch (smsError) {
            console.error("Twilio SMS Error:", smsError.message);
            res.status(500).json({
                success: false,
                message: "Failed to send SMS."
            });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * 2️⃣ VERIFY OTP FOR CHECK-IN (Consumes OTP)
 */
exports.verifyOTPForCheckin = async (req, res) => {
    try {
        let { phone, otp } = req.body;
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        
        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanPhone,
            type: 'patient_phone',
            otp,
            consume: true
        });

        if (!verifyResult.valid) {
            return res.status(400).json({ success: false, message: verifyResult.message || "Invalid or expired OTP" });
        }

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
 * 2.5️⃣ VALIDATE OTP ONLY (Does not consume OTP - for multi-step flows)
 */
exports.validateOTP = async (req, res) => {
    try {
        let { phone, otp } = req.body;
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanPhone,
            type: ['patient_phone', 'password_reset'],
            otp,
            consume: false
        });

        if (!verifyResult.valid) {
            return res.status(400).json({ success: false, message: verifyResult.message || "Invalid or expired OTP" });
        }

        res.status(200).json({
            success: true,
            message: "OTP is valid.",
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
        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanPhone,
            type: 'patient_phone',
            otp,
            consume: true
        });

        if (!verifyResult.valid) {
            return res.status(400).json({
                success: false,
                message: verifyResult.message || "Invalid or expired OTP. Please request a new OTP."
            });
        }

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
        const { clinicId, doctorId, appointmentDate, reason, rescheduleAppointmentId, patientMemberId, holdToken } = req.body;
        const patientId = req.user?.id;
        const patientPhone = req.user?.phone;

        console.log('🔍 Booking appointment:', { clinicId, doctorId, appointmentDate, reason, patientId, rescheduleAppointmentId, patientMemberId });

        if (!clinicId || !doctorId || !appointmentDate) {
            return res.status(400).json({ success: false, message: "Clinic, doctor, and date are required" });
        }

        // Get primary patient info — try by ID first, then fall back to phone
        let patient = null;
        if (patientId) {
            try { patient = await Patient.findById(patientId); } catch (_) {}
        }
        if (!patient && patientPhone) {
            const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
            patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$') });
        }
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient profile not found. Please register to book an appointment." });
        }

        // Resolve target patient (Primary user vs. Saved Family Member)
        let bookingPatient = patient;
        if (patientMemberId && patientMemberId.toString() !== patient._id.toString()) {
            const memberDoc = await Patient.findOne({
                _id: patientMemberId,
                $or: [
                    { accountId: patient._id },
                    { _id: patient._id }
                ]
            });
            if (!memberDoc) {
                return res.status(404).json({ success: false, message: "Selected family member profile not found." });
            }
            bookingPatient = memberDoc;
        }

        const { checkAndLinkPatient } = require('../utils/auth_middleware');
        try {
            await checkAndLinkPatient(patient.phone, clinicId);
        } catch (limitErr) {
            return res.status(400).json({ success: false, message: limitErr.message });
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

        // Parse appointmentDate safely (handles both ISO and local datetime strings like "2026-05-21T10:00")
        let parsedAppointmentDate;
        if (appointmentDate.length <= 16) {
            // Local datetime without timezone — treat as local time
            parsedAppointmentDate = new Date(appointmentDate + ':00');
        } else {
            parsedAppointmentDate = new Date(appointmentDate);
        }
        if (isNaN(parsedAppointmentDate.getTime())) {
            return res.status(400).json({ success: false, message: "Invalid appointment date format." });
        }

        // 🛑 STRICT HOLIDAY, LEAVE & WEEKLY OFF VALIDATION
        const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const apptWeekday = WEEKDAY_NAMES[parsedAppointmentDate.getDay()];

        // 1️⃣ Validate Clinic Working Days (e.g. Sunday or custom off-days)
        const clinicWorkingDays = clinic.workingDays && clinic.workingDays.length > 0
            ? clinic.workingDays.map(d => d.toLowerCase())
            : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        
        if (!clinicWorkingDays.includes(apptWeekday)) {
            const formattedDay = apptWeekday.charAt(0).toUpperCase() + apptWeekday.slice(1);
            return res.status(400).json({
                success: false,
                message: `Clinic is closed on ${formattedDay}s (Weekly Holiday). Please select a working day.`
            });
        }

        // 2️⃣ Validate Doctor Available Days
        if (doctor.availableDays && doctor.availableDays.length > 0) {
            const docAvailableDays = doctor.availableDays.map(d => d.toLowerCase());
            if (!docAvailableDays.includes(apptWeekday)) {
                const formattedDay = apptWeekday.charAt(0).toUpperCase() + apptWeekday.slice(1);
                return res.status(400).json({
                    success: false,
                    message: `Dr. ${doctor.name} is not available on ${formattedDay}s. Please choose another date or doctor.`
                });
            }
        }

        // 3️⃣ Validate Clinic Holidays and Doctor Leaves from Leave model
        const Leave = require('../models/Leave');
        const activeLeaves = await Leave.find({
            clinicId,
            startDate: { $lte: parsedAppointmentDate },
            endDate: { $gte: parsedAppointmentDate }
        });

        // Check for clinic-wide holiday
        const clinicHoliday = activeLeaves.find(l => !l.doctorId || l.type === 'clinic_holiday');
        if (clinicHoliday) {
            return res.status(400).json({
                success: false,
                message: `Clinic is closed on this date for "${clinicHoliday.title}". Appointments cannot be booked on holidays.`
            });
        }

        // Check for doctor-specific leave
        const doctorLeave = activeLeaves.find(l => l.doctorId && l.doctorId.toString() === doctorId.toString());
        if (doctorLeave) {
            return res.status(400).json({
                success: false,
                message: `Dr. ${doctor.name} is on leave on this date ("${doctorLeave.title}"). Appointments cannot be booked on this date.`
            });
        }

        // 4️⃣ Block appointments if doctor is LIVE on the walk-in queue for this date range
        if (doctor.isAvailable === false) {
            const apptDateOnly = new Date(parsedAppointmentDate); apptDateOnly.setHours(0, 0, 0, 0);
            const serverTodayOnly = new Date(); serverTodayOnly.setHours(0, 0, 0, 0);
            // Determine the end of the live period (liveUntilDate or today only)
            const liveEndDate = doctor.liveUntilDate
                ? new Date(doctor.liveUntilDate)
                : new Date(serverTodayOnly);
            liveEndDate.setHours(23, 59, 59, 999);

            if (apptDateOnly >= serverTodayOnly && apptDateOnly <= liveEndDate) {
                const untilStr = doctor.liveUntilDate
                    ? `until ${new Date(doctor.liveUntilDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                    : 'today';
                return res.status(400).json({
                    success: false,
                    message: `Dr. ${doctor.name} is on live walk-in queue ${untilStr} and is not accepting appointments during this period. Please book after that date.`
                });
            }
        }

        if (rescheduleAppointmentId) {
            // Find existing queue entry (supports queueId or patient appointment subdocument ID)
            let queueEntry = null;
            try {
                queueEntry = await Queue.findById(rescheduleAppointmentId);
            } catch (_) {}

            if (!queueEntry) {
                const matchedInPatient = patient.appointments.find(app => app._id?.toString() === rescheduleAppointmentId || app.queueId?.toString() === rescheduleAppointmentId);
                if (matchedInPatient?.queueId) {
                    try {
                        queueEntry = await Queue.findById(matchedInPatient.queueId);
                    } catch (_) {}
                }
            }

            if (!queueEntry) {
                return res.status(404).json({ success: false, message: "Original appointment not found." });
            }

            // Update queue entry
            queueEntry.clinicId = clinicId;
            queueEntry.doctorId = doctorId;
            queueEntry.appointmentDate = parsedAppointmentDate;
            queueEntry.reason = reason || queueEntry.reason || '';
            queueEntry.status = 'Pending-Approval';
            queueEntry.isApproved = false;
            await queueEntry.save();

            // Find patient and update their appointment record
            const appointmentIndex = patient.appointments.findIndex(app => 
                (queueEntry._id && app.queueId?.toString() === queueEntry._id.toString()) ||
                app.queueId?.toString() === rescheduleAppointmentId ||
                app._id?.toString() === rescheduleAppointmentId
            );
            if (appointmentIndex !== -1) {
                patient.appointments[appointmentIndex].appointmentDate = parsedAppointmentDate;
                patient.appointments[appointmentIndex].status = 'Scheduled';
                patient.appointments[appointmentIndex].clinicId = clinicId;
                patient.appointments[appointmentIndex].clinicName = clinic.name;
                patient.appointments[appointmentIndex].doctorId = doctorId;
                patient.appointments[appointmentIndex].doctorName = doctor.name;
            } else {
                patient.appointments.push({
                    queueId: queueEntry._id,
                    clinicId,
                    clinicName: clinic.name,
                    doctorId,
                    doctorName: doctor.name,
                    appointmentDate: parsedAppointmentDate,
                    status: 'Scheduled'
                });
            }

            await patient.save();

            // Send rescheduled request submitted SMS
            try {
                const cleanPhone = patient.phone.replace(/\D/g, '').slice(-10);
                const formattedPhone = `+91${cleanPhone}`;
                if (process.env.TWILIO_PHONE_NUMBER) {
                    await client.messages.create({
                        body: `Your appointment reschedule request has been submitted to ${clinic.name} with Dr. ${doctor.name}. New Date: ${new Date(appointmentDate).toLocaleDateString()}. The receptionist will verify and confirm shortly. Request ID: ${queueEntry._id}`,
                        from: process.env.TWILIO_PHONE_NUMBER,
                        to: formattedPhone
                    });
                }
            } catch (smsError) {
                console.error("❌ Reschedule SMS Error:", smsError.message);
            }

            return res.status(200).json({
                success: true,
                message: "Appointment reschedule request submitted successfully. Receptionist will verify and confirm shortly.",
                data: {
                    appointmentId: queueEntry._id,
                    clinicName: clinic.name,
                    doctorName: doctor.name,
                    appointmentDate,
                    status: 'Pending-Approval'
                }
            });
        }

        // Remove duplicate date parsing block (now handled above)
        // Create queue entry for appointment REQUEST (pending receptionist approval)
        const queueEntry = await Queue.create({
            clinicId,
            doctorId,
            patientId: bookingPatient._id,
            patientName: bookingPatient.name,
            patientPhone: patient.phone, // Account holder's mobile receives notifications
            visitType: 'Appointment',
            appointmentDate: parsedAppointmentDate,
            reason: reason || '',
            status: 'Pending-Approval',
            isApproved: false,
            isEmergency: false
        });

        const apptObj = {
            queueId: queueEntry._id,
            clinicId,
            clinicName: clinic.name,
            doctorId,
            doctorName: doctor.name,
            appointmentDate: parsedAppointmentDate,
            status: 'Scheduled'
        };

        // Add appointment to target patient record
        if (!Array.isArray(bookingPatient.appointments)) {
            bookingPatient.appointments = [];
        }
        bookingPatient.appointments.push(apptObj);
        await bookingPatient.save();

        if (bookingPatient._id.toString() !== patient._id.toString()) {
            if (!Array.isArray(patient.appointments)) {
                patient.appointments = [];
            }
            patient.appointments.push(apptObj);
            await patient.save();
        }

        // Release slot hold if holdToken provided
        if (holdToken) {
            try {
                const SlotHold = require('../models/SlotHold');
                await SlotHold.deleteOne({ holdToken });
            } catch (holdErr) {
                console.warn('⚠️ SlotHold cleanup error:', holdErr.message);
            }
        }

        // Track clinic first appointment milestone for activation metrics
        let isFirstAppointment = false;
        if (!clinic.milestones?.firstAppointmentAt) {
            isFirstAppointment = true;
            if (!clinic.milestones) clinic.milestones = {};
            clinic.milestones.firstAppointmentAt = new Date();
            await clinic.save();
        }

        // Send request submitted SMS (pending receptionist approval)
        try {
            const cleanPhone = patient.phone.replace(/\D/g, '').slice(-10);
            const formattedPhone = `+91${cleanPhone}`;
            const client = getTwilioClient();

            if (client && process.env.TWILIO_PHONE_NUMBER) {
                const dateDisplay = new Date(parsedAppointmentDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
                await client.messages.create({
                    body: `Your appointment request for ${bookingPatient.name} has been submitted to ${clinic.name} with Dr. ${doctor.name} for ${dateDisplay}. Receptionist will verify and confirm shortly. Request ID: ${queueEntry._id}`,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: formattedPhone
                });
                console.log(`✅ SMS Sent to ${formattedPhone}`);
            }
        } catch (smsError) {
            console.error("❌ SMS Error - Patient Phone:", patient.phone, "Error:", smsError.message);
        }

        // 📢 REAL-TIME SOCKET BROADCAST
        if (req.io) {
            req.io.to(clinicId.toString()).emit('newAppointment', queueEntry);
            req.io.to(clinicId.toString()).emit('queueUpdated', { clinicId });
            const patientCleanPhone = (patient.phone || '').replace(/\D/g, '').slice(-10);
            if (patientCleanPhone) {
                req.io.to(patientCleanPhone).emit('queueUpdate', queueEntry);
            }
        }

        res.status(201).json({
            success: true,
            isFirstAppointment,
            message: "Appointment request submitted successfully. Receptionist will verify and confirm shortly.",
            data: {
                appointmentId: queueEntry._id,
                clinicName: clinic.name,
                doctorName: doctor.name,
                patientName: bookingPatient.name,
                appointmentDate,
                status: 'Pending-Approval'
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
 * 8️⃣ GET PATIENT APPOINTMENTS (Unified Queue + Patient Records)
 */
exports.getPatientAppointments = async (req, res) => {
    try {
        const patientId = req.user?.id || req.user?._id;
        const rawPhone = req.user?.phone || '';
        const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
        const phoneRegex = cleanPhone ? new RegExp(cleanPhone + '$') : null;

        let patient = null;
        if (patientId) {
            try {
                patient = await Patient.findById(patientId);
            } catch (_) {}
        }
        if (!patient && phoneRegex) {
            patient = await Patient.findOne({ phone: phoneRegex }).sort({ updatedAt: -1 });
        }
        if (!patient && cleanPhone) {
            patient = await Patient.findOne({ phone: cleanPhone }).sort({ updatedAt: -1 });
        }

        // Fetch linked family members
        let familyMembers = [];
        if (patient) {
            const primaryId = patient.accountId || (patient.isPrimaryAccount ? patient._id : patientId);
            if (primaryId) {
                try {
                    familyMembers = await Patient.find({
                        $or: [{ _id: primaryId }, { accountId: primaryId }],
                        mergedInto: null
                    });
                } catch (_) {}
            }
        }

        const patientIds = [
            ...(patient ? [patient._id] : []),
            ...familyMembers.map(m => m._id)
        ];

        const queryOr = [];
        if (patientIds.length > 0) {
            queryOr.push({ patientId: { $in: patientIds } });
        }
        if (phoneRegex) {
            queryOr.push({ patientPhone: phoneRegex });
        }
        if (cleanPhone) {
            queryOr.push({ patientPhone: cleanPhone });
        }

        const queueEntries = queryOr.length > 0
            ? await Queue.find({ $or: queryOr })
                .populate('clinicId', 'name address contactPhone clinicCode')
                .populate('doctorId', 'name specialization education')
                .sort({ appointmentDate: -1, createdAt: -1 })
                .lean()
            : [];

        const patientDocAppointments = [];
        if (patient && Array.isArray(patient.appointments)) {
            patientDocAppointments.push(...patient.appointments);
        }
        familyMembers.forEach(mem => {
            if (Array.isArray(mem.appointments)) {
                patientDocAppointments.push(...mem.appointments);
            }
        });

        const seenMap = new Map();
        queueEntries.forEach(q => {
            const key = q._id.toString();
            seenMap.set(key, {
                _id: q._id,
                queueId: q._id,
                clinicId: q.clinicId?._id || q.clinicId,
                clinicName: q.clinicId?.name || 'Clinic Facility',
                clinicAddress: q.clinicId?.address || '',
                clinicPhone: q.clinicId?.contactPhone || '',
                doctorId: q.doctorId?._id || q.doctorId,
                doctorName: q.doctorId?.name || 'Doctor',
                doctorSpecialization: q.doctorId?.specialization || '',
                patientId: q.patientId,
                patientName: q.patientName || patient?.name || 'Patient',
                patientPhone: q.patientPhone || patient?.phone || '',
                tokenNumber: q.tokenNumber || null,
                appointmentDate: q.appointmentDate || q.createdAt,
                status: q.status || (q.isApproved ? 'Scheduled' : 'Pending-Approval'),
                isApproved: Boolean(q.isApproved),
                visitType: q.visitType || 'Appointment',
                reason: q.reason || '',
                createdAt: q.createdAt
            });
        });

        patientDocAppointments.forEach(item => {
            const key = item.queueId ? item.queueId.toString() : (item._id ? item._id.toString() : null);
            if (key && !seenMap.has(key)) {
                seenMap.set(key, {
                    _id: item._id || item.queueId,
                    queueId: item.queueId || item._id,
                    clinicId: item.clinicId?._id || item.clinicId,
                    clinicName: item.clinicId?.name || item.clinicName || 'Clinic Facility',
                    doctorId: item.doctorId?._id || item.doctorId,
                    doctorName: item.doctorId?.name || item.doctorName || 'Doctor',
                    doctorSpecialization: item.doctorId?.specialization || '',
                    patientId: patient?._id,
                    patientName: patient?.name || 'Patient',
                    patientPhone: patient?.phone || '',
                    tokenNumber: item.tokenNumber || null,
                    appointmentDate: item.appointmentDate || item.createdAt,
                    status: item.status || 'Scheduled',
                    isApproved: true,
                    visitType: 'Appointment',
                    reason: item.reason || '',
                    createdAt: item.createdAt || item.appointmentDate
                });
            }
        });

        const mergedAppointments = Array.from(seenMap.values()).sort(
            (a, b) => new Date(b.appointmentDate || b.createdAt) - new Date(a.appointmentDate || a.createdAt)
        );

        return res.status(200).json({
            success: true,
            data: mergedAppointments
        });
    } catch (error) {
        console.error("❌ getPatientAppointments error:", error);
        return res.status(500).json({ success: false, message: error.message });
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

        // Generate OTP and save securely to MongoDB
        const otp = generateSecureOtp();
        await storeSecureOtp({ identifier: cleanPhone, type: 'password_reset', otp, expiryMinutes: 5 });

        const formattedPhone = `+91${cleanPhone}`;

        // Send OTP via SMS
        const client = getTwilioClient();
        if (client && process.env.TWILIO_PHONE_NUMBER) {
            try {
                await client.messages.create({
                    body: `Your password reset OTP is: ${otp}. Valid for 5 minutes. Do not share this with anyone.`,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: formattedPhone
                });
            } catch (smsError) {
                console.error("SMS Error in forgot password:", smsError.message);
            }
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
        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanPhone,
            type: 'password_reset',
            otp,
            consume: true
        });

        if (!verifyResult.valid) {
            return res.status(400).json({ success: false, message: verifyResult.message || "Invalid or expired OTP" });
        }

        const phoneRegex = new RegExp(cleanPhone + '$');
        const patient = await Patient.findOne({ phone: phoneRegex });

        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found" });
        }

        // Validate password strength (at least 8 characters)
        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long for security."
            });
        }

        // Hash and update the password with salt cost 12, increment tokenVersion to revoke all active JWT sessions
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        patient.passwordHash = hashedPassword;
        patient.tokenVersion = (patient.tokenVersion || 0) + 1;
        await patient.save();

        res.status(200).json({
            success: true,
            message: "Password reset successfully. You can now login with your new password.",
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

/**
 * 🔍 CHECK IF PATIENT PHONE IS REGISTERED
 */
exports.checkPatientPhone = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone number is required" });
        }

        const { isValid, normalized: cleanPhone, error: phoneError } = normalizeIndianPhone(phone);
        if (!isValid) {
            return res.status(400).json({ success: false, message: phoneError || "Invalid phone number" });
        }

        const patient = await Patient.findOne({
            phone: cleanPhone,
            $or: [
                { isPrimaryAccount: true },
                { passwordHash: { $exists: true, $ne: null } }
            ]
        }) || await Patient.findOne({ phone: cleanPhone }).sort({ updatedAt: -1 });

        const isRegistered = Boolean(patient && patient.passwordHash);

        return res.status(200).json({
            success: true,
            cleanPhone,
            isRegistered,
            hasAccount: Boolean(patient),
            name: patient?.name || null
        });
    } catch (error) {
        console.error("Check Phone Error:", error);
        return res.status(500).json({ success: false, message: "Server error checking phone number" });
    }
};

/**
 * 🔐 PASSWORD-BASED LOGIN
 */
exports.patientLoginWithPassword = async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone number and password are required"
            });
        }

        const { isValid, normalized: cleanPhone, error: phoneError } = normalizeIndianPhone(phone);
        if (!isValid) {
            return res.status(400).json({ success: false, message: phoneError });
        }

        const patient = await Patient.findOne({ phone: cleanPhone });

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found. Please register first."
            });
        }

        if (!patient.passwordHash) {
            return res.status(400).json({
                success: false,
                message: "No password set. Please use OTP login or create a password during registration."
            });
        }

        // Compare password
        const isPasswordValid = await bcrypt.compare(password, patient.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid password. Please try again."
            });
        }

        // Ensure isPrimaryAccount is true for registered password users
        if (!patient.isPrimaryAccount) {
            patient.isPrimaryAccount = true;
            await patient.save();
        }

        // Generate token with tokenVersion
        const token = generateToken({
            id: patient._id.toString(),
            phone: cleanPhone,
            role: 'patient',
            tokenVersion: patient.tokenVersion || 0
        });

        console.log(`✅ Patient Login Success: ${patient.name} (${cleanPhone})`);

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            patient: {
                id: patient._id,
                name: patient.name,
                phone: cleanPhone,
                isPrimaryAccount: true,
                relationship: patient.relationship || 'Self'
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({
            success: false,
            message: "Login failed. Please try again."
        });
    }
};

/**
 * 📝 REGISTER + OTP VERIFICATION + CREATE PASSWORD
 */
exports.registerWithOTPAndPassword = async (req, res) => {
    try {
        const { phone, otp, name, age, yearOfBirth, gender, bloodGroup, password, whatsappOptIn, consentVersion } = req.body;

        if (!phone || !otp || !name || !password) {
            return res.status(400).json({
                success: false,
                message: "Phone, OTP, name, and password are required"
            });
        }

        const { isValid, normalized: cleanPhone, error: phoneError } = normalizeIndianPhone(phone);
        if (!isValid) {
            return res.status(400).json({ success: false, message: phoneError });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 8 characters long for security."
            });
        }

        // Verify OTP securely
        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanPhone,
            type: 'patient_phone',
            otp,
            consume: true
        });

        if (!verifyResult.valid) {
            return res.status(400).json({
                success: false,
                message: verifyResult.message || "Invalid or expired OTP"
            });
        }

        // Check if primary account already registered
        const existingPatient = await Patient.findOne({
            phone: cleanPhone,
            $or: [
                { isPrimaryAccount: true },
                { passwordHash: { $exists: true, $ne: null } }
            ]
        });
        if (existingPatient) {
            return res.status(400).json({
                success: false,
                message: "Phone number already registered with an account. Please login."
            });
        }

        // Hash password with salt cost 12
        const hashedPassword = await bcrypt.hash(password, 12);

        const parsedAge = age ? parseInt(age) : null;
        const parsedYear = yearOfBirth ? parseInt(yearOfBirth) : (parsedAge ? new Date().getFullYear() - parsedAge : null);

        // Create primary patient account
        const newPatient = await Patient.create({
            phone: cleanPhone,
            name: name.trim(),
            isPrimaryAccount: true,
            relationship: 'Self',
            passwordHash: hashedPassword,
            tokenVersion: 0,
            age: parsedAge,
            yearOfBirth: parsedYear,
            gender: gender || null,
            bloodGroup: bloodGroup || null,
            whatsappOptIn: !!whatsappOptIn,
            whatsappOptInAt: whatsappOptIn ? new Date() : null,
            consentHistory: [{
                version: consentVersion || 'v1.0',
                consentedAt: new Date()
            }],
            registeredOn: new Date()
        });

        // Generate token
        const token = generateToken({
            id: newPatient._id.toString(),
            phone: cleanPhone,
            role: 'patient',
            tokenVersion: 0
        });

        console.log(`✅ New Primary Patient Registered: ${newPatient.name} (${cleanPhone})`);

        res.status(201).json({
            success: true,
            message: "Registration successful",
            token,
            patient: {
                id: newPatient._id,
                name: newPatient.name,
                phone: cleanPhone,
                isPrimaryAccount: true,
                relationship: 'Self'
            }
        });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({
            success: false,
            message: "Registration failed: " + error.message
        });
    }
};

/**
 * 🔑 CHANGE PASSWORD WITH OTP
 */
exports.changePasswordWithOTP = async (req, res) => {
    try {
        const { phone, otp, newPassword } = req.body;

        if (!phone || !otp || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Phone, OTP, and new password are required"
            });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        // Verify OTP securely
        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanPhone,
            type: ['password_reset', 'patient_phone'],
            otp,
            consume: true
        });

        if (!verifyResult.valid) {
            return res.status(400).json({
                success: false,
                message: verifyResult.message || "Invalid or expired OTP"
            });
        }

        // Find patient
        const patient = await Patient.findOne({ phone: cleanPhone });
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: "Patient not found"
            });
        }

        // Validate password strength (at least 6 characters)
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long for security."
            });
        }

        // Hash new password with salt cost 12 and increment tokenVersion to revoke active sessions
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        patient.passwordHash = hashedPassword;
        patient.tokenVersion = (patient.tokenVersion || 0) + 1;
        await patient.save();

        console.log(`✅ Password Changed for: ${patient.name} (${cleanPhone})`);

        res.status(200).json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        console.error('Change Password Error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to change password: " + error.message
        });
    }
};

/**
 * 📱 SEND OTP TO NEW PHONE NUMBER FOR PHONE CHANGE
 */
exports.sendChangePhoneOTP = async (req, res) => {
    try {
        const { newPhone } = req.body;
        const patientId = req.user?.id || req.user?._id;

        if (!newPhone) {
            return res.status(400).json({ success: false, message: "New mobile number is required" });
        }

        const { isValid, normalized: cleanNewPhone, error: phoneError } = normalizeIndianPhone(newPhone);
        if (!isValid) {
            return res.status(400).json({ success: false, message: phoneError || "Invalid mobile number" });
        }

        // Check if user is trying to change to the same number
        const currentPatient = await Patient.findById(patientId);
        if (currentPatient && currentPatient.phone === cleanNewPhone) {
            return res.status(400).json({
                success: false,
                message: "The new phone number is identical to your current phone number."
            });
        }

        // Check if another primary account already uses this phone
        const existingPrimary = await Patient.findOne({
            phone: cleanNewPhone,
            isPrimaryAccount: true,
            _id: { $ne: patientId }
        });

        if (existingPrimary) {
            return res.status(400).json({
                success: false,
                message: "This mobile number is already linked to another registered account."
            });
        }

        // Generate 6-digit OTP securely
        const otp = generateSecureOtp();
        await storeSecureOtp({
            identifier: cleanNewPhone,
            type: 'patient_change_phone',
            otp,
            expiryMinutes: 5
        });

        const client = getTwilioClient();
        if (client && process.env.TWILIO_PHONE_NUMBER) {
            try {
                await client.messages.create({
                    body: `Your Appointory phone number update OTP is: ${otp}. Valid for 5 minutes.`,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: `+91${cleanNewPhone}`
                });
            } catch (smsError) {
                console.error("SMS Error:", smsError.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: `OTP sent successfully to +91 ${cleanNewPhone}`
        });
    } catch (error) {
        console.error("Send Change Phone OTP Error:", error);
        return res.status(500).json({ success: false, message: "Failed to send OTP to new number" });
    }
};

/**
 * 📱 VERIFY OTP AND UPDATE PHONE NUMBER
 */
exports.verifyChangePhone = async (req, res) => {
    try {
        const { newPhone, otp } = req.body;
        const patientId = req.user?.id || req.user?._id;

        if (!newPhone || !otp) {
            return res.status(400).json({ success: false, message: "New mobile number and OTP are required" });
        }

        const { isValid, normalized: cleanNewPhone } = normalizeIndianPhone(newPhone);
        if (!isValid) {
            return res.status(400).json({ success: false, message: "Invalid mobile number" });
        }

        // Verify OTP securely
        const verifyResult = await verifyAndConsumeOtp({
            identifier: cleanNewPhone,
            type: 'patient_change_phone',
            otp,
            consume: true
        });

        if (!verifyResult.valid) {
            return res.status(400).json({
                success: false,
                message: verifyResult.message || "Invalid or expired OTP. Please request a new one."
            });
        }

        // Update patient document
        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient profile not found" });
        }

        patient.phone = cleanNewPhone;
        patient.tokenVersion = (patient.tokenVersion || 0) + 1;
        await patient.save();

        // Also update any dependent family members if linked
        await Patient.updateMany(
            { accountId: patient._id },
            { $set: { updatedAt: new Date() } }
        );

        // Generate updated session token
        const newToken = generateToken({
            id: patient._id.toString(),
            phone: cleanNewPhone,
            role: 'patient',
            tokenVersion: patient.tokenVersion
        });

        console.log(`✅ Patient Phone Updated: ${patient.name} -> ${cleanNewPhone}`);

        return res.status(200).json({
            success: true,
            message: "Phone number updated successfully!",
            newPhone: cleanNewPhone,
            token: newToken,
            patient: {
                id: patient._id,
                name: patient.name,
                phone: cleanNewPhone
            }
        });
    } catch (error) {
        console.error("Verify Change Phone Error:", error);
        return res.status(500).json({ success: false, message: "Failed to update phone number" });
    }
};

/**
 * 👨‍👩‍👧‍👦 GET FAMILY MEMBERS
 * Returns primary account and all linked family member profiles.
 */
exports.getFamilyMembers = async (req, res) => {
    try {
        const patientId = req.user?.id;
        if (!patientId) {
            return res.status(401).json({ success: false, message: 'Unauthorized session.' });
        }

        const primaryPatient = await Patient.findById(patientId);
        if (!primaryPatient) {
            return res.status(404).json({ success: false, message: 'Primary account not found.' });
        }

        const familyMembers = await Patient.find({
            accountId: primaryPatient._id,
            mergedInto: null
        }).sort({ createdAt: 1 });

        res.status(200).json({
            success: true,
            primary: {
                _id: primaryPatient._id,
                name: primaryPatient.name,
                phone: primaryPatient.phone,
                relationship: 'Self',
                gender: primaryPatient.gender,
                age: primaryPatient.age,
                yearOfBirth: primaryPatient.yearOfBirth
            },
            familyMembers: familyMembers.map(m => ({
                _id: m._id,
                name: m.name,
                relationship: m.relationship || 'Family Member',
                isMinor: m.isMinor,
                guardianName: m.guardianName,
                gender: m.gender,
                age: m.age,
                yearOfBirth: m.yearOfBirth,
                bloodGroup: m.bloodGroup,
                allergies: m.allergies
            }))
        });
    } catch (error) {
        console.error('❌ Error fetching family members:', error.message);
        res.status(500).json({ success: false, message: 'Failed to fetch family members.' });
    }
};

/**
 * ➕ ADD FAMILY MEMBER
 * Adds a saved family profile linked to the primary account.
 * Minor consent (DPDP Act) enforced if age < 18.
 */
exports.addFamilyMember = async (req, res) => {
    try {
        const patientId = req.user?.id;
        const { name, relationship, age, yearOfBirth, gender, bloodGroup, allergies, isMinor, guardianConsent } = req.body;

        if (!patientId) {
            return res.status(401).json({ success: false, message: 'Unauthorized session.' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Family member name is required.' });
        }

        const primaryPatient = await Patient.findById(patientId);
        if (!primaryPatient) {
            return res.status(404).json({ success: false, message: 'Primary account not found.' });
        }

        const parsedAge = age ? parseInt(age) : (yearOfBirth ? new Date().getFullYear() - parseInt(yearOfBirth) : null);
        const parsedYear = yearOfBirth ? parseInt(yearOfBirth) : (parsedAge ? new Date().getFullYear() - parsedAge : null);
        const minorFlag = Boolean(isMinor || (parsedAge !== null && parsedAge < 18));

        if (minorFlag && !guardianConsent) {
            return res.status(400).json({
                success: false,
                message: 'Parent or lawful guardian declaration is required for individuals under 18 years of age (DPDP Act).'
            });
        }

        const newMember = await Patient.create({
            name: name.trim(),
            accountId: primaryPatient._id,
            isPrimaryAccount: false,
            relationship: relationship || 'Other',
            isMinor: minorFlag,
            guardianName: minorFlag ? primaryPatient.name : null,
            guardianConsent: minorFlag ? true : false,
            guardianConsentAt: minorFlag ? new Date() : null,
            gender: gender || null,
            age: parsedAge,
            yearOfBirth: parsedYear,
            bloodGroup: bloodGroup || null,
            allergies: allergies || null,
            registeredOn: new Date()
        });

        res.status(201).json({
            success: true,
            message: 'Family member added successfully',
            member: {
                _id: newMember._id,
                name: newMember.name,
                relationship: newMember.relationship,
                isMinor: newMember.isMinor,
                guardianName: newMember.guardianName,
                gender: newMember.gender,
                age: newMember.age,
                yearOfBirth: newMember.yearOfBirth,
                bloodGroup: newMember.bloodGroup,
                allergies: newMember.allergies
            }
        });
    } catch (error) {
        console.error('❌ Error adding family member:', error.message);
        res.status(500).json({ success: false, message: 'Failed to add family member.' });
    }
};

/**
 * ✏️ UPDATE FAMILY MEMBER
 */
exports.updateFamilyMember = async (req, res) => {
    try {
        const patientId = req.user?.id;
        const { memberId } = req.params;
        const { name, relationship, age, yearOfBirth, gender, bloodGroup, allergies } = req.body;

        const member = await Patient.findOne({ _id: memberId, accountId: patientId });
        if (!member) {
            return res.status(404).json({ success: false, message: 'Family member not found.' });
        }

        if (name) member.name = name.trim();
        if (relationship) member.relationship = relationship;
        if (gender) member.gender = gender;
        if (age !== undefined) {
            member.age = age ? parseInt(age) : null;
            if (member.age && !yearOfBirth) {
                member.yearOfBirth = new Date().getFullYear() - member.age;
            }
        }
        if (yearOfBirth !== undefined) member.yearOfBirth = yearOfBirth ? parseInt(yearOfBirth) : null;
        if (bloodGroup !== undefined) member.bloodGroup = bloodGroup;
        if (allergies !== undefined) member.allergies = allergies;

        if (member.age !== null && member.age < 18) {
            member.isMinor = true;
        }

        await member.save();

        res.status(200).json({
            success: true,
            message: 'Family member profile updated',
            member
        });
    } catch (error) {
        console.error('❌ Error updating family member:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update family member profile.' });
    }
};

/**
 * 🗑️ UNLINK FAMILY MEMBER
 * Soft-unlinks member so clinical records remain intact.
 */
exports.deleteFamilyMember = async (req, res) => {
    try {
        const patientId = req.user?.id;
        const { memberId } = req.params;

        const member = await Patient.findOne({ _id: memberId, accountId: patientId });
        if (!member) {
            return res.status(404).json({ success: false, message: 'Family member not found.' });
        }

        member.accountId = null;
        await member.save();

        res.status(200).json({
            success: true,
            message: 'Family member profile unlinked from your account.'
        });
    } catch (error) {
        console.error('❌ Error unlinking family member:', error.message);
        res.status(500).json({ success: false, message: 'Failed to unlink family member.' });
    }
};

/**
 * 🔍 GET UNLINKED FAMILY CANDIDATES (Gated Claiming - Master Plan Section 2.3)
 * Discovers unlinked Patient profiles matching the authenticated account holder's phone.
 * PRIVACY GUARD: Never exposes full names or medical records prior to verification.
 */
exports.getFamilyCandidates = async (req, res) => {
    try {
        const patientId = req.user?.id;
        const currentPatient = await Patient.findById(patientId);
        if (!currentPatient || !currentPatient.phone) {
            return res.status(400).json({ success: false, message: 'Valid account phone required.' });
        }

        const { normalizeIndianPhone } = require('../utils/phone_helper');
        const { isValid, normalized } = normalizeIndianPhone(currentPatient.phone);
        if (!isValid || !normalized) {
            return res.status(400).json({ success: false, message: 'Invalid phone format.' });
        }

        // Find candidate profiles sharing this normalized phone
        // Excluding current user, already-linked family members, and soft-merged records
        const candidates = await Patient.find({
            _id: { $ne: currentPatient._id },
            phone: new RegExp(normalized + '$'),
            accountId: null,
            mergedInto: null
        }).select('_id name age gender visitedClinics appointments lastVisit createdAt');

        if (candidates.length === 0) {
            return res.status(200).json({
                success: true,
                candidateCount: 0,
                candidates: []
            });
        }

        // Check if shared desk/staff phone (>5 profiles or >=3 distinct clinics)
        const allClinics = new Set();
        candidates.forEach(c => (c.visitedClinics || []).forEach(cid => allClinics.add(cid.toString())));
        if (candidates.length > 5 || allClinics.size >= 3) {
            return res.status(200).json({
                success: true,
                isSharedDeskPhone: true,
                candidateCount: 0,
                candidates: [],
                message: 'This mobile number is registered with an institutional or shared reception desk. Individual profiles must be verified at the clinic desk.'
            });
        }

        // Return candidates with privacy-safe masked hints
        const maskedCandidates = candidates.map(c => {
            const trimmedName = (c.name || '').trim();
            const maskedName = trimmedName.length > 2 
                ? `${trimmedName[0]}***${trimmedName.slice(-1)}`
                : '***';

            return {
                candidateId: c._id,
                nameHint: maskedName,
                age: c.age || null,
                gender: c.gender || null
            };
        });

        res.status(200).json({
            success: true,
            candidateCount: maskedCandidates.length,
            candidates: maskedCandidates
        });
    } catch (error) {
        console.error('❌ Error fetching family candidates:', error.message);
        res.status(500).json({ success: false, message: 'Failed to check for family profile candidates.' });
    }
};

/**
 * 🔐 CLAIM FAMILY CANDIDATE (Knowledge-Based Authentication)
 * Verifies candidate identity using past clinic name or visit date.
 */
exports.claimFamilyCandidate = async (req, res) => {
    try {
        const patientId = req.user?.id;
        const { candidateId, verificationType, verificationValue, relationship } = req.body;

        if (!candidateId || !verificationType || !verificationValue) {
            return res.status(400).json({
                success: false,
                message: 'Candidate ID, verification type (clinic_name or visit_date), and verification value are required.'
            });
        }

        const currentPatient = await Patient.findById(patientId);
        if (!currentPatient || !currentPatient.phone) {
            return res.status(400).json({ success: false, message: 'Valid primary account required.' });
        }

        const candidate = await Patient.findById(candidateId).populate('visitedClinics');
        if (!candidate) {
            return res.status(404).json({ success: false, message: 'Candidate profile not found.' });
        }

        if (candidate.accountId || candidate.mergedInto) {
            return res.status(400).json({ success: false, message: 'This profile is already linked or merged.' });
        }

        // Verify phone match
        const { normalizeIndianPhone } = require('../utils/phone_helper');
        const userNorm = normalizeIndianPhone(currentPatient.phone).normalized;
        const candNorm = normalizeIndianPhone(candidate.phone).normalized;
        if (userNorm !== candNorm) {
            return res.status(403).json({ success: false, message: 'Candidate phone does not match account phone.' });
        }

        let isVerified = false;

        if (verificationType === 'clinic_name') {
            const queryNorm = verificationValue.toLowerCase().trim();
            // Check if any visited clinic matches name
            isVerified = (candidate.visitedClinics || []).some(c => {
                const clinicName = (c.name || '').toLowerCase();
                return clinicName.includes(queryNorm) || queryNorm.includes(clinicName);
            });
        } else if (verificationType === 'visit_date') {
            // Check against lastVisit or appointment dates
            const targetDateStr = new Date(verificationValue).toISOString().slice(0, 10);
            
            if (candidate.lastVisit && new Date(candidate.lastVisit).toISOString().slice(0, 10) === targetDateStr) {
                isVerified = true;
            } else if (candidate.appointments && candidate.appointments.length > 0) {
                isVerified = candidate.appointments.some(app => 
                    app.appointmentDate && new Date(app.appointmentDate).toISOString().slice(0, 10) === targetDateStr
                );
            }
        }

        if (!isVerified) {
            return res.status(400).json({
                success: false,
                message: 'Verification details did not match clinic records. For patient safety, please verify with the clinic receptionist.'
            });
        }

        // Verified! Link candidate to current account
        candidate.accountId = currentPatient._id;
        candidate.relationship = relationship || 'Family Member';
        if (candidate.age && candidate.age < 18) {
            candidate.isMinor = true;
            candidate.guardianName = currentPatient.name;
            candidate.guardianConsent = true;
            candidate.guardianConsentAt = new Date();
        }
        await candidate.save();

        // Log to MigrationAuditLog
        try {
            const MigrationAuditLog = require('../models/MigrationAuditLog');
            await MigrationAuditLog.create({
                migrationRunId: `user_claim_${Date.now()}`,
                actionType: 'candidate_gated_link',
                primaryPatientId: currentPatient._id,
                secondaryPatientId: candidate._id,
                phone: userNorm,
                name: candidate.name,
                details: {
                    verificationType,
                    verifiedAt: new Date()
                }
            });
        } catch (auditErr) {
            console.warn('⚠️ MigrationAuditLog error:', auditErr.message);
        }

        res.status(200).json({
            success: true,
            message: `Successfully linked ${candidate.name} to your family profiles.`,
            member: {
                _id: candidate._id,
                name: candidate.name,
                relationship: candidate.relationship,
                age: candidate.age,
                gender: candidate.gender,
                isMinor: candidate.isMinor
            }
        });
    } catch (error) {
        console.error('❌ Error claiming family candidate:', error.message);
        res.status(500).json({ success: false, message: 'Failed to verify and link family profile.' });
    }
};