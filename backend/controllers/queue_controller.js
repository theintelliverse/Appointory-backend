const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const Patient = require('../models/Patient');
const twilio = require('twilio');
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;
const client = new twilio(
    twilioAccountSid,
    process.env.TWILIO_AUTH_TOKEN
);
// --- 🛠️ OPTIMIZED SMS SIMULATION (Twilio Rate Limit Protection) ---
const sendTwilioAlert = async (phone, message) => {
    try {
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const formattedPhone = `+91${cleanPhone}`;

        await client.messages.create({
            body: message,
            from: twilioPhoneNumber,
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

        // 📢 DEBUG LOG
        console.log(`📢 Emit: queueUpdate (Approval) to Room: ${clinicId}`);
        if (req.io) req.io.to(clinicId.toString()).emit('queueUpdate');

        res.status(200).json({ success: true, data: entry });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 5️⃣ Start Consultation (SMS REMOVED - Patient is already in waiting room)
exports.startConsultation = async (req, res) => {
    try {
        const entry = await Queue.findByIdAndUpdate(req.params.id, {
            status: 'In-Consultation', startTime: Date.now()
        }, { new: true });

        if (!entry) return res.status(404).json({ message: "Patient not found" });

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
        const { notes } = req.body;

        const queueEntry = await Queue.findById(id).populate('doctorId');
        if (!queueEntry) return res.status(404).json({ message: "Session expired." });

        const patient = await Patient.findOne({ phone: queueEntry.patientPhone });
        if (patient) {
            patient.medicalHistory.push({
                visitId: queueEntry._id,
                doctorName: queueEntry.doctorId.name,
                clinicName: req.user.clinicName || "Our Clinic",
                diagnosis: notes,
                date: Date.now()
            });
            await patient.save();
        }

        const duration = queueEntry.startTime ? Math.round((Date.now() - queueEntry.startTime) / 60000) : 0;
        await MedicalRecord.create({
            clinicId: queueEntry.clinicId,
            doctorId: queueEntry.doctorId._id,
            patientName: queueEntry.patientName,
            patientPhone: queueEntry.patientPhone,
            notes: notes,
            duration,
            visitDate: Date.now()
        });

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
        const queue = await Queue.find({
            clinicId: req.user.clinicId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] }
        }).sort({ createdAt: 1 }).populate('doctorId', 'name specialization');
        res.status(200).json({ success: true, data: queue });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🔟 Doctor spezifisch
exports.getDoctorQueue = async (req, res) => {
    try {
        const doctorId = req.user.id || req.user._id;
        const myQueue = await Queue.find({
            clinicId: req.user.clinicId,
            doctorId: doctorId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] }
        }).sort({ createdAt: 1 });
        res.status(200).json({ success: true, data: myQueue });
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