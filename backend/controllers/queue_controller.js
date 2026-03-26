const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const Patient = require('../models/Patient');
const twilio = require('twilio');
const client = new twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
// --- 🛠️ OPTIMIZED SMS SIMULATION (Twilio Rate Limit Protection) ---
const sendTwilioAlert = async (phone, message) => {
    try {
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const formattedPhone = `+91${cleanPhone}`;

        await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
        });

        /* --- CONSOLE LOGS COMMENTED OUT ---
        console.log(`To: ${formattedPhone}`);
        console.log(`Msg: ${message}`);
        */
    } catch (error) {
        console.error("❌ Twilio Delivery Error:", error.message);
    }
};

// 1️⃣ Add Patient to Queue (Manual - SMS Triggered)
exports.addToQueue = async (req, res) => {
    try {
        const { patientName, patientPhone, doctorId, visitType, isEmergency } = req.body;
        const clinicId = req.user.clinicId;

        const today = new Date().setHours(0, 0, 0, 0);
        const count = await Queue.countDocuments({ clinicId, isApproved: true, createdAt: { $gte: today } });
        const tokenNumber = isEmergency ? `E-${count + 1}` : `T-${count + 1}`;

        const newEntry = await Queue.create({
            clinicId, patientName, patientPhone, doctorId, tokenNumber, visitType, isEmergency, isApproved: true, status: 'Waiting'
        });

        // 📢 DEBUG LOG
        console.log(`📢 Emit: queueUpdate to Room: ${clinicId}`);
        if (req.io) req.io.to(clinicId.toString()).emit('queueUpdate');

        res.status(201).json({ success: true, data: newEntry });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 2️⃣ PUBLIC: Patient Requests Check-In (No SMS - Prevents Spam)
exports.selfCheckIn = async (req, res) => {
    try {
        const { patientName, patientPhone, clinicCode, doctorId } = req.body;
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) return res.status(404).json({ message: "Invalid Clinic Code" });

        const newRequest = await Queue.create({
            clinicId: clinic._id,
            patientName,
            patientPhone,
            doctorId,
            visitType: 'Walk-in',
            status: 'Pending-Approval',
            isApproved: false
        });

        res.status(201).json({
            success: true,
            message: "Request sent. Please check the screen for approval.",
            id: newRequest._id
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3️⃣ RECEPTIONIST: Get pending
exports.getPendingRequests = async (req, res) => {
    try {
        const pending = await Queue.find({
            clinicId: req.user.clinicId,
            isApproved: false,
            status: 'Pending-Approval'
        }).sort({ createdAt: 1 }).populate('doctorId', 'name specialization');
        res.status(200).json({ success: true, data: pending });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4️⃣ RECEPTIONIST: Approve (SMS Triggered)
exports.approvePatient = async (req, res) => {
    try {
        const { id } = req.params;
        const { isEmergency } = req.body;
        const clinicId = req.user.clinicId;

        const count = await Queue.countDocuments({ clinicId, isApproved: true, createdAt: { $gte: new Date().setHours(0, 0, 0, 0) } });
        const tokenNumber = isEmergency ? `E-${count + 1}` : `P-${count + 1}`;

        const entry = await Queue.findByIdAndUpdate(id, {
            isApproved: true, status: 'Waiting', tokenNumber, isEmergency: !!isEmergency
        }, { new: true }).populate('clinicId', 'name');

        // 📱 Send Simple SMS Notification (OTP-style)
        const simpleMessage = `Appointment Confirmed! Token: ${tokenNumber} | Clinic: ${entry.clinicId.name} | Arrive 10 mins early. - SwasthyaMitra`;

        try {
            if (!entry.patientPhone) {
                console.error("❌ SMS Error - No patient phone number in queue entry");
                return;
            }
            if (!process.env.TWILIO_PHONE_NUMBER) {
                console.error("❌ SMS Error - Missing TWILIO_PHONE_NUMBER env var");
                return;
            }
            
            const cleanPhone = entry.patientPhone.replace(/\D/g, '').slice(-10);
            const formattedPhone = `+91${cleanPhone}`;
            
            const smsResult = await client.messages.create({
                body: simpleMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            console.log(`✅ SMS Sent to ${formattedPhone} | SID: ${smsResult.sid}`);
        } catch (smsError) {
            console.error("❌ SMS Error - Phone:", entry.patientPhone, "Formatted:", `+91${entry.patientPhone?.replace(/\D/g, '').slice(-10)}`, "Error:", smsError.message, "Code:", smsError.code);
        }

        // �📢 DEBUG LOG
        console.log(`📢 Emit: queueUpdate (Approval) to Room: ${clinicId}`);
        if (req.io) req.io.to(clinicId.toString()).emit('queueUpdate');

        res.status(200).json({ success: true, data: entry });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 5️⃣ Start Consultation (Send SMS notification)
exports.startConsultation = async (req, res) => {
    try {
        const entry = await Queue.findByIdAndUpdate(req.params.id, {
            status: 'In-Consultation', startTime: Date.now()
        }, { new: true }).populate('doctorId', 'name');

        if (!entry) return res.status(404).json({ message: "Patient not found" });

        // � Send Simple SMS Notification (Consultation Starting)
        const doctorName = entry.doctorId?.name || 'Doctor';
        const simpleMessage = `Your appointment is starting with Dr. ${doctorName}. Please go to the consultation room. - SwasthyaMitra`;

        try {
            if (!entry.patientPhone) {
                console.error("❌ SMS Error - No patient phone number");
                return;
            }
            if (!process.env.TWILIO_PHONE_NUMBER) {
                console.error("❌ SMS Error - Missing TWILIO_PHONE_NUMBER env var");
                return;
            }
            
            const cleanPhone = entry.patientPhone.replace(/\D/g, '').slice(-10);
            const formattedPhone = `+91${cleanPhone}`;
            
            const smsResult = await client.messages.create({
                body: simpleMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            console.log(`✅ SMS Sent to ${formattedPhone} | SID: ${smsResult.sid}`);
        } catch (smsError) {
            console.error("❌ SMS Error - Phone:", entry.patientPhone, "Formatted:", `+91${entry.patientPhone?.replace(/\D/g, '').slice(-10)}`, "Error:", smsError.message, "Code:", smsError.code);
        }

        // 📢 DEBUG LOG
        console.log(`📢 Emit: queueUpdate (Start) to Room: ${entry.clinicId}`);
        if (req.io) req.io.to(entry.clinicId.toString()).emit('queueUpdate');

        res.status(200).json({ success: true, data: entry });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 6️⃣ Refer to Lab (SMS REMOVED - Doctor informs patient directly)
exports.referToLab = async (req, res) => {
    try {
        const { queueId } = req.params;
        const { testName } = req.body;
        const entry = await Queue.findByIdAndUpdate(queueId, {
            status: 'Waiting',
            currentStage: 'Lab-Pending',
            requiredTest: testName
        }, { new: true });

        // 📢 SOCKET EMIT: Lab Dashboard updates instantly
        if (req.io) req.io.to(entry.clinicId.toString()).emit('queueUpdate');

        res.status(200).json({ success: true, message: "Referral saved." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7️⃣ Lab Task Completed
exports.completeLabTask = async (req, res) => {
    try {
        const { queueId } = req.params;
        await Queue.findByIdAndUpdate(queueId, { currentStage: 'Lab-Completed' });
        res.status(200).json({ success: true, message: "Sync complete." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 8️⃣ Complete Visit (ID LINKING ADDED)
exports.completeVisit = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, diagnosis, medicines } = req.body;

        const queueEntry = await Queue.findById(id).populate('doctorId');
        if (!queueEntry) return res.status(404).json({ message: "Session expired." });

        const patient = await Patient.findOne({ phone: queueEntry.patientPhone });
        if (patient) {
            patient.medicalHistory.push({
                visitId: queueEntry._id,
                doctorName: queueEntry.doctorId.name,
                clinicName: req.user.clinicName || "Our Clinic",
                diagnosis: diagnosis || notes,
                date: Date.now(),
                medicines: medicines || [],
                symptoms: notes
            });
            await patient.save();
        }

        const duration = queueEntry.startTime ? Math.round((Date.now() - queueEntry.startTime) / 60000) : 0;

        // Create medical record with diagnosis and medicines
        await MedicalRecord.create({
            clinicId: queueEntry.clinicId,
            doctorId: queueEntry.doctorId._id,
            patientName: queueEntry.patientName,
            patientPhone: queueEntry.patientPhone,
            notes: notes,
            diagnosis: diagnosis,
            medicines: medicines || [],
            duration,
            visitDate: Date.now()
        });

        // � Send Simple SMS Notification (Consultation Completed)
        const doctorName = queueEntry.doctorId?.name || 'Doctor';
        const completionMessage = `Consultation with Dr. ${doctorName} completed. Your records saved. View anytime in Health Locker. - SwasthyaMitra`;

        try {
            if (!queueEntry.patientPhone) {
                console.error("❌ SMS Error - No patient phone number");
                return;
            }
            if (!process.env.TWILIO_PHONE_NUMBER) {
                console.error("❌ SMS Error - Missing TWILIO_PHONE_NUMBER env var");
                return;
            }
            
            const cleanPhone = queueEntry.patientPhone.replace(/\D/g, '').slice(-10);
            const formattedPhone = `+91${cleanPhone}`;
            
            const smsResult = await client.messages.create({
                body: completionMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });
            console.log(`✅ SMS Sent to ${formattedPhone} | SID: ${smsResult.sid}`);
        } catch (smsError) {
            console.error("❌ SMS Error - Phone:", queueEntry.patientPhone, "Formatted:", `+91${queueEntry.patientPhone?.replace(/\D/g, '').slice(-10)}`, "Error:", smsError.message, "Code:", smsError.code);
        }

        const clinicId = queueEntry.clinicId.toString();
        await Queue.findByIdAndDelete(id);

        // 📢 SOCKET EMIT: Clear patient from all dashboards and TV
        if (req.io) req.io.to(clinicId).emit('queueUpdate');

        res.status(200).json({ success: true, message: "Record locked." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 9️⃣ Live Queue for Dashboard
exports.getLiveQueue = async (req, res) => {
    try {
        // Filter to show only today's appointments
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const queue = await Queue.find({
            clinicId: req.user.clinicId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] },
            $or: [
                // Show walk-ins created today
                { visitType: 'Walk-in', createdAt: { $gte: today, $lt: tomorrow } },
                // Show appointments scheduled for today
                { visitType: 'Appointment', appointmentDate: { $gte: today, $lt: tomorrow } }
            ]
        }).sort({ isEmergency: -1, createdAt: 1 }).populate('doctorId', 'name specialization');
        res.status(200).json({ success: true, data: queue });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🔟 Doctor specific - Show only today's queue
exports.getDoctorQueue = async (req, res) => {
    try {
        // Filter to show only today's appointments
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const doctorId = req.user.id || req.user._id;
        const myQueue = await Queue.find({
            clinicId: req.user.clinicId,
            doctorId: doctorId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] },
            createdAt: { $gte: today }
        }).sort({ createdAt: 1 });
        res.status(200).json({ success: true, data: myQueue });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 📅 Get all confirmed appointments (scheduled appointments menu)
exports.getConfirmedAppointments = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const appointments = await Queue.find({
            clinicId: req.user.clinicId,
            visitType: 'Appointment',
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation', 'Completed'] },
            appointmentDate: { $gte: today } // Show only approved appointments from today onwards
        }).sort({ appointmentDate: 1, createdAt: 1 })
          .populate('doctorId', 'name specialization')
          .populate('clinicId', 'name');
        
        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 📅 Get appointments for next 7 days
exports.getNext7DaysAppointments = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const next7days = new Date(today);
        next7days.setDate(next7days.getDate() + 7);
        
        const appointments = await Queue.find({
            clinicId: req.user.clinicId,
            visitType: 'Appointment',
            isApproved: true,
            appointmentDate: { $gte: today, $lt: next7days }
        }).sort({ appointmentDate: 1, createdAt: 1 })
          .populate('doctorId', 'name specialization')
          .populate('clinicId', 'name');
        
        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 📅 Doctor: Get my scheduled appointments for next 7 days
exports.getDoctorScheduledAppointments = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const next7days = new Date(today);
        next7days.setDate(next7days.getDate() + 7);
        
        const doctorId = req.user.id || req.user._id;
        const appointments = await Queue.find({
            clinicId: req.user.clinicId,
            doctorId: doctorId,
            visitType: 'Appointment',
            isApproved: true,
            appointmentDate: { $gte: today, $lt: next7days }
        }).sort({ appointmentDate: 1, createdAt: 1 })
          .populate('clinicId', 'name');
        
        res.status(200).json({ success: true, data: appointments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1️⃣1️⃣ PUBLIC: Live Tracker Status
exports.getPatientStatus = async (req, res) => {
    try {
        const { queueId } = req.params;
        const entry = await Queue.findById(queueId)
            .populate('clinicId', 'name')
            .populate('doctorId', 'name isAvailable');

        if (!entry) return res.status(200).json({ isCompleted: true });

        if (!entry.isApproved) {
            return res.status(200).json({ success: true, isPendingApproval: true });
        }

        const peopleAhead = await Queue.countDocuments({
            doctorId: entry.doctorId._id,
            status: 'Waiting',
            isApproved: true,
            createdAt: { $lt: entry.createdAt }
        });

        res.status(200).json({
            success: true,
            data: {
                patientName: entry.patientName,
                tokenNumber: entry.tokenNumber,
                status: entry.status,
                peopleAhead,
                estimatedWait: (peopleAhead * 12),
                isDoctorOnBreak: !entry.doctorId.isAvailable
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1️⃣2️⃣ Cancel
exports.cancelVisit = async (req, res) => {
    try {
        const entry = await Queue.findById(req.params.queueId);
        const clinicId = entry.clinicId.toString();
        await Queue.findByIdAndDelete(req.params.queueId);

        // 📢 SOCKET EMIT: Update lists
        if (req.io) req.io.to(clinicId).emit('queueUpdate');

        res.status(200).json({ success: true, message: "Cancelled." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 1️⃣3️⃣ Admin History
exports.getMedicalHistory = async (req, res) => {
    try {
        const records = await MedicalRecord.find({ clinicId: req.user.clinicId })
            .sort({ visitDate: -1 })
            .populate('doctorId', 'name specialization');
        res.status(200).json({ success: true, data: records });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// 1️⃣4️⃣ PUBLIC: Full Queue for Live TV Display
// This allows the TV outside the cabin to show the full list of tokens
exports.getPublicDoctorQueue = async (req, res) => {
    try {
        const { doctorId } = req.params;
        console.log("📺 TV Display requesting queue for Doctor ID:", doctorId);

        const queue = await Queue.find({
            doctorId: doctorId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] } // Only show active patients
        })
            .select('tokenNumber patientName status isEmergency createdAt')
            .sort({
                status: 1,      // 'In-Consultation' first
                isEmergency: -1, // Emergency second
                createdAt: 1     // Oldest first
            });

        console.log(`✅ Found ${queue.length} patients for display.`);
        res.status(200).json({
            success: true,
            data: queue
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🆕 UPDATE VITALS FOR CURRENT PATIENT
exports.updateVitals = async (req, res) => {
    try {
        const { queueId } = req.params;
        const { bloodPressure, pulseRate, temperature, weight, bmi } = req.body;
        const doctorId = req.user.id;

        // Validate input
        if (!queueId) {
            return res.status(400).json({
                success: false,
                message: 'Queue ID is required'
            });
        }

        // Find the queue entry to get patient phone
        const queueEntry = await Queue.findById(queueId);
        if (!queueEntry) {
            return res.status(404).json({
                success: false,
                message: 'Patient queue entry not found'
            });
        }

        const { patientPhone } = queueEntry;

        // Find patient by phone
        const patient = await Patient.findOne({ phone: patientPhone });
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient profile not found'
            });
        }

        // Create new vitals entry
        const newVitals = {
            bloodPressure,
            pulseRate,
            temperature,
            weight,
            bmi,
            recordedBy: doctorId,
            recordedAt: new Date()
        };

        // Add vitals to patient
        patient.vitals.push(newVitals);
        await patient.save();

        console.log(`✅ Vitals updated for patient ${patientPhone}`);

        res.status(200).json({
            success: true,
            message: 'Patient vitals updated successfully',
            data: patient.vitals
        });
    } catch (error) {
        console.error('❌ Error updating vitals:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update vitals: ' + error.message
        });
    }
};