const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const Patient = require('../models/Patient');
const {
    estimateWaitTimeFromDb,
    updatePredictorWithData
} = require('../AI_model/appointment_predictor');
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

// Helper: get clean frontend base URL from env
const getFrontendUrl = () => {
    const raw = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/["']/g, '');
    // Take the first URL if comma-separated
    return raw.split(',')[0].trim().replace(/\/$/, '');
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

        // 📱 Send SMS with live tracking link
        const trackingUrl = `${getFrontendUrl()}/patient/status?id=${newEntry._id}`;
        const smsMsg = `✅ Token: ${tokenNumber} | Track your live queue status here: ${trackingUrl} - Appointory`;
        if (patientPhone) {
            sendTwilioAlert(patientPhone, smsMsg).catch(() => { });
        }

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

        // 📢 DEBUG LOG: Emit so Admin Dashboard instantly sees the new walk-in request
        if (req.io) req.io.to(clinic._id.toString()).emit('queueUpdate');

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
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const pending = await Queue.find({
            clinicId: req.user.clinicId,
            isApproved: false,
            status: 'Pending-Approval',
            $or: [
                { visitType: { $ne: 'Appointment' }, createdAt: { $gte: today } },
                { visitType: 'Appointment', appointmentDate: { $gte: today } }
            ]
        }).sort({ appointmentDate: 1, createdAt: 1 }).populate('doctorId', 'name specialization');
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

        // 📱 Send SMS with live tracking link
        const trackingUrl = `${getFrontendUrl()}/patient/status?id=${entry._id}`;
        const simpleMessage = `✅ Confirmed! Token: ${tokenNumber} | Clinic: ${entry.clinicId.name} | Track live: ${trackingUrl} - Appointory`;

        if (entry.patientPhone) {
            sendTwilioAlert(entry.patientPhone, simpleMessage).catch(err => {
                console.error("❌ SMS Error:", err.message);
            });
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

        // Update Patient's lastVisit immediately when consultation starts
        if (entry.patientId) {
            await Patient.findByIdAndUpdate(entry.patientId, { lastVisit: Date.now() });
        }

        // � Send Simple SMS Notification (Consultation Starting)
        const doctorName = entry.doctorId?.name || 'Doctor';
        const simpleMessage = `Your appointment is starting with Dr. ${doctorName}. Please go to the consultation room. - Appointory`;

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
            patient.lastVisit = Date.now();
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

        updatePredictorWithData({
            clinicId: queueEntry.clinicId,
            doctorId: queueEntry.doctorId?._id || queueEntry.doctorId,
            visit_type: queueEntry.visitType,
            emergency: queueEntry.isEmergency,
            time: queueEntry.startTime || queueEntry.appointmentDate || queueEntry.createdAt,
            problem: diagnosis || notes || queueEntry.reason,
            duration
        });

        // � Send Simple SMS Notification (Consultation Completed)
        const doctorName = queueEntry.doctorId?.name || 'Doctor';
        const completionMessage = `Consultation with Dr. ${doctorName} completed. Your records saved. View anytime in Health Locker. - Appointory`;

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
                { visitType: { $ne: 'Appointment' }, createdAt: { $gte: today, $lt: tomorrow } },
                // Show appointments scheduled for today
                { visitType: 'Appointment', appointmentDate: { $gte: today, $lt: tomorrow } }
            ]
        }).sort({ isEmergency: -1, createdAt: 1 }).populate('doctorId', 'name specialization');

        const queueWithWait = await Promise.all(queue.map(async (item) => {
            const itemObj = item.toObject ? item.toObject() : item;
            try {
                const doctorObjectId = item.doctorId?._id || item.doctorId;
                const waitTime = await estimateWaitTimeFromDb({
                    clinicId: item.clinicId,
                    doctorId: doctorObjectId,
                    visitType: item.visitType,
                    problem: item.reason || item.diagnosis || item.consultationNotes,
                    isEmergency: !!item.isEmergency,
                    tokenNumber: item.tokenNumber,
                    queueId: item._id,
                    appointmentDate: item.appointmentDate || item.createdAt
                });
                itemObj.estimatedWait = waitTime;
            } catch (err) {
                itemObj.estimatedWait = 15;
            }
            return itemObj;
        }));

        res.status(200).json({ success: true, data: queueWithWait });
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

        const myQueueWithWait = await Promise.all(myQueue.map(async (item) => {
            const itemObj = item.toObject ? item.toObject() : item;
            try {
                const waitTime = await estimateWaitTimeFromDb({
                    clinicId: item.clinicId,
                    doctorId: doctorId,
                    visitType: item.visitType,
                    problem: item.reason || item.diagnosis || item.consultationNotes,
                    isEmergency: !!item.isEmergency,
                    tokenNumber: item.tokenNumber,
                    queueId: item._id,
                    appointmentDate: item.appointmentDate || item.createdAt
                });
                itemObj.estimatedWait = waitTime;
            } catch (err) {
                itemObj.estimatedWait = 15;
            }
            return itemObj;
        }));

        res.status(200).json({ success: true, data: myQueueWithWait });
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
            .populate('clinicId', 'name openingTime closingTime')
            .populate('doctorId', 'name isAvailable');

        if (!entry) return res.status(200).json({ isCompleted: true });

        if (!entry.isApproved) {
            return res.status(200).json({ success: true, isPendingApproval: true });
        }

        const doctorObjectId = entry.doctorId?._id || entry.doctorId;

        const clinicObjectId = entry.clinicId?._id || entry.clinicId;

        // Only count TODAY's queue (old stale entries from past days must not count)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);

        // Count people ACTUALLY ahead: same clinic, same doctor, today only
        const aheadQuery = {
            _id: { $ne: entry._id },
            clinicId: clinicObjectId,
            doctorId: doctorObjectId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] },
            createdAt: { $gte: todayStart, $lt: todayEnd },
            $or: [
                // Walk-ins created before this patient
                { visitType: { $ne: 'Appointment' }, createdAt: { $lt: entry.createdAt } },
                // Appointments with earlier slot time
                { visitType: 'Appointment', appointmentDate: { $lt: entry.appointmentDate || entry.createdAt } }
            ]
        };

        const peopleAhead = await Queue.countDocuments(aheadQuery);

        // Debug: log to backend console so we can verify
        console.log(`📊 PatientStatus [${entry.patientName}] → Ahead: ${peopleAhead} | Clinic: ${clinicObjectId} | Doctor: ${doctorObjectId} | Status: ${entry.status}`);

        // Try AI predictor, fall back to simple 14-min-per-person formula
        let estimatedWait;
        try {
            const aiResult = await estimateWaitTimeFromDb({
                clinicId: entry.clinicId,
                doctorId: doctorObjectId,
                visitType: entry.visitType,
                problem: entry.reason || entry.diagnosis || entry.consultationNotes,
                isEmergency: !!entry.isEmergency,
                tokenNumber: entry.tokenNumber,
                peopleAhead
            });
            // Validate: if NaN / falsy / too large, use fallback
            estimatedWait = (typeof aiResult === 'number' && !isNaN(aiResult) && aiResult > 0 && aiResult < 300)
                ? aiResult
                : Math.max(peopleAhead * 14, 5);
        } catch {
            estimatedWait = Math.max(peopleAhead * 14, 5);
        }

        res.status(200).json({
            success: true,
            data: {
                patientName: entry.patientName,
                tokenNumber: entry.tokenNumber,
                status: entry.status,
                clinicName: entry.clinicId?.name || 'Clinic',
                openingTime: entry.clinicId?.openingTime || '09:00',
                closingTime: entry.clinicId?.closingTime || '17:00',
                isEmergency: entry.isEmergency,
                peopleAhead,
                estimatedWait,
                isDoctorOnBreak: !(entry.doctorId && entry.doctorId.isAvailable)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc Get estimated wait time for a doctor (Pre-booking)
 * @route GET /api/queue/public/estimate-wait
 */
exports.getWaitEstimation = async (req, res) => {
    try {
        const { clinicId, doctorId, visitType } = req.query;

        if (!clinicId || !doctorId) {
            return res.status(400).json({ success: false, message: "Clinic and Doctor are required" });
        }

        const estimatedWait = await estimateWaitTimeFromDb({
            clinicId,
            doctorId,
            visitType: visitType || 'new',
            isEmergency: false,
            peopleAhead: 0 // Will be calculated inside estimateWaitTimeFromDb for active queue
        });

        res.status(200).json({
            success: true,
            estimatedWait
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

        // Filter to show only today's patients
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const queue = await Queue.find({
            doctorId: doctorId,
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] },
            currentStage: { $nin: ['Lab-Pending', 'Lab-Processing'] },
            $or: [
                { visitType: { $ne: 'Appointment' }, createdAt: { $gte: today, $lt: tomorrow } },
                { visitType: 'Appointment', appointmentDate: { $gte: today, $lt: tomorrow } }
            ]
        })
            .select('tokenNumber patientName status isEmergency createdAt clinicId doctorId visitType reason diagnosis consultationNotes appointmentDate currentStage')
            .sort({
                status: 1,      // 'In-Consultation' first
                isEmergency: -1, // Emergency second
                createdAt: 1     // Oldest first
            });

        const queueWithWait = await Promise.all(queue.map(async (item) => {
            const itemObj = item.toObject ? item.toObject() : item;
            try {
                const doctorObjectId = item.doctorId?._id || item.doctorId;
                const waitTime = await estimateWaitTimeFromDb({
                    clinicId: item.clinicId,
                    doctorId: doctorObjectId,
                    visitType: item.visitType,
                    problem: item.reason || item.diagnosis || item.consultationNotes,
                    isEmergency: !!item.isEmergency,
                    tokenNumber: item.tokenNumber,
                    queueId: item._id,
                    appointmentDate: item.appointmentDate || item.createdAt
                });
                itemObj.estimatedWait = waitTime;
            } catch (err) {
                itemObj.estimatedWait = 15;
            }
            return itemObj;
        }));

        res.status(200).json({
            success: true,
            data: queueWithWait
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🆕 UPDATE VITALS FOR CURRENT PATIENT
exports.updateVitals = async (req, res) => {
    try {
        const { queueId } = req.params;
        const { bloodPressure, pulseRate, temperature, weight, bmi, sugarLevel, spO2 } = req.body;
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
            sugarLevel,
            spO2,
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

// 🔬 LAB: Create New Test Request (From Lab Dashboard Quick Action)
exports.createTestRequest = async (req, res) => {
    try {
        const { patientName, patientPhone, requiredTest, currentStage, clinicId, tokenNumber } = req.body;
        const userClinicId = req.user.clinicId;

        // Validate required fields
        if (!patientName || !patientPhone) {
            return res.status(400).json({
                success: false,
                message: 'Patient name and phone are required'
            });
        }

        // Create new queue entry for lab test
        const newTestRequest = await Queue.create({
            clinicId: userClinicId || clinicId,
            patientName,
            patientPhone,
            requiredTest: requiredTest || 'General',
            currentStage: currentStage || 'Lab-Pending',
            tokenNumber: tokenNumber || `LAB-${Date.now()}`,
            status: 'Waiting',
            isApproved: true,
            visitType: 'Walk-in',
            isEmergency: false,
            createdAt: new Date()
        });

        console.log(`✅ New test request created: ${newTestRequest._id} for ${patientName}`);

        // 📢 Emit socket update to lab dashboard
        if (req.io) {
            req.io.to(userClinicId.toString()).emit('queueUpdate');
        }

        res.status(201).json({
            success: true,
            message: 'Test request created successfully',
            data: newTestRequest
        });
    } catch (error) {
        console.error('❌ Error creating test request:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create test request: ' + error.message
        });
    }
};

// 🔬 LAB: Update Queue Stage (From Lab Dashboard Quick Action)
exports.updateQueueStage = async (req, res) => {
    try {
        const { id } = req.params;
        const { currentStage } = req.body;

        if (!currentStage) {
            return res.status(400).json({
                success: false,
                message: 'Current stage is required'
            });
        }

        // Find and update the queue entry
        const updatedQueue = await Queue.findByIdAndUpdate(
            id,
            { currentStage, updatedAt: new Date() },
            { new: true }
        );

        if (!updatedQueue) {
            return res.status(404).json({
                success: false,
                message: 'Queue entry not found'
            });
        }

        console.log(`✅ Queue stage updated: ${id} -> ${currentStage}`);

        // 📢 Emit socket update to lab dashboard
        if (req.io) {
            req.io.to(updatedQueue.clinicId.toString()).emit('queueUpdate');
        }

        res.status(200).json({
            success: true,
            message: 'Queue stage updated successfully',
            data: updatedQueue
        });
    } catch (error) {
        console.error('❌ Error updating queue stage:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update queue stage: ' + error.message
        });
    }
};

// 📊 Doctor Dashboard Stats (NEW)
exports.getDoctorDashboardStats = async (req, res) => {
    try {
        const doctorId = req.user.id || req.user._id;
        const clinicId = req.user.clinicId;

        let today = new Date();
        if (req.query.date) {
            today = new Date(req.query.date);
        }
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // 1. Scheduled Appointments for Today
        const scheduledCount = await Queue.countDocuments({
            clinicId,
            doctorId,
            visitType: 'Appointment',
            appointmentDate: { $gte: today, $lt: tomorrow }
        });

        // 2. Currently In Consultation
        const inConsultationCount = await Queue.countDocuments({
            clinicId,
            doctorId,
            status: 'In-Consultation'
        });

        // 3. Pending Follow Ups
        const pendingFollowUps = await Queue.countDocuments({
            clinicId,
            doctorId,
            visitType: 'Walk-in',
            isApproved: true,
            status: 'Waiting'
        });

        // 4. Queue Data for tabs — walk-ins by createdAt (must be approved), appointments by appointmentDate (approved or pending)
        const queueData = await Queue.find({
            clinicId,
            doctorId,
            $or: [
                { visitType: { $ne: 'Appointment' }, isApproved: true, createdAt: { $gte: today, $lt: tomorrow } },
                { visitType: 'Appointment', appointmentDate: { $gte: today, $lt: tomorrow } }
            ]
        }).sort({ isEmergency: -1, appointmentDate: 1, createdAt: 1 });

        const queueWithWait = await Promise.all(queueData.map(async (item) => {
            const itemObj = item.toObject ? item.toObject() : item;
            try {
                const waitTime = await estimateWaitTimeFromDb({
                    clinicId: item.clinicId,
                    doctorId: doctorId,
                    visitType: item.visitType,
                    problem: item.reason || item.diagnosis || item.consultationNotes,
                    isEmergency: !!item.isEmergency,
                    tokenNumber: item.tokenNumber,
                    queueId: item._id,
                    appointmentDate: item.appointmentDate || item.createdAt
                });
                itemObj.estimatedWait = waitTime;
            } catch (err) {
                itemObj.estimatedWait = 15;
            }
            return itemObj;
        }));

        // 5. Avg Wait Time
        const waitingPatients = queueWithWait.filter(p => p.status === 'Waiting');
        let avgWait = 14;
        if (waitingPatients.length > 0) {
            const totalWait = waitingPatients.reduce((sum, p) => sum + (p.estimatedWait || 0), 0);
            avgWait = Math.round(totalWait / waitingPatients.length);
        }

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    scheduled: scheduledCount,
                    inConsultation: inConsultationCount,
                    avgWaitTime: `${avgWait} mins`,
                    pendingFollowUps: pendingFollowUps
                },
                queue: queueWithWait,
                reminders: [
                    { id: 1, type: 'lab', title: 'Review lab reports', patient: 'Rahul Sharma', time: 'Today, 12:00 PM', color: 'red' },
                    { id: 2, type: 'followup', title: 'Follow up', patient: 'Sneha Patel', time: 'Tomorrow, 10:30 AM', color: 'orange' },
                    { id: 3, type: 'prescription', title: 'Pending prescriptions', patient: '3 prescriptions to complete', time: 'Today', color: 'purple' },
                    { id: 4, type: 'patient', title: 'Patient due for follow up', patient: 'Anita Gupta', time: '24 May 2025', color: 'blue' }
                ]
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
