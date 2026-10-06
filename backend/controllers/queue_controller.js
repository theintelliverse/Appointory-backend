const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const Patient = require('../models/Patient');
const PrivateNote = require('../models/PrivateNote');
const {
    estimateWaitTimeFromDb,
    updatePredictorWithData
} = require('../AI_model/appointment_predictor');
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

// --- 🔐 CHECK CLINIC MESSAGING SERVICE SUBSCRIPTION ---
const checkClinicMessagingAccess = async (clinicId) => {
    if (!clinicId) return true;
    try {
        const clinic = await Clinic.findById(clinicId);
        if (!clinic) return false;
        const now = new Date();
        // 1. Full active subscription
        if (clinic.subscriptionExpiresAt && new Date(clinic.subscriptionExpiresAt) > now) {
            return true;
        }
        // 2. Modular 'messaging' service active
        if (clinic.activeServices && clinic.activeServices.length > 0) {
            const svc = clinic.activeServices.find(s => s.service === 'messaging');
            if (svc && svc.expiresAt && new Date(svc.expiresAt) > now) {
                return true;
            }
        }
        return false;
    } catch (err) {
        console.warn("⚠️ Failed to check clinic messaging access:", err.message);
        return false;
    }
};

// --- 🛠️ DUAL NOTIFICATION ENGINE (SMS + WhatsApp Alerts via Twilio Gateway) ---
const sendTwilioAlert = async (phone, message, clinicId = null) => {
    try {
        if (clinicId) {
            const hasAccess = await checkClinicMessagingAccess(clinicId);
            if (!hasAccess) {
                console.log(`🔒 [MESSAGING MODULE LOCKED] Clinic ${clinicId} has no active SMS & WhatsApp subscription. Skipping alert.`);
                return { success: false, serviceLocked: true };
            }
        }

        const client = getTwilioClient();
        if (!client) {
            console.warn("⚠️ Twilio not configured; skipping SMS & WhatsApp alerts.");
            return { success: false, simulated: true };
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        if (!cleanPhone || cleanPhone.length !== 10) return { success: false, reason: 'Invalid phone' };
        const formattedPhone = `+91${cleanPhone}`;

        // 1. 📲 Standard SMS Alert Dispatch
        if (process.env.TWILIO_PHONE_NUMBER) {
            client.messages.create({
                body: message,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            }).then(res => {
                console.log(`✅ [SMS ALERT SENT] SID: ${res.sid} | To: ${formattedPhone}`);
            }).catch(smsErr => {
                console.warn(`⚠️ [SMS DELIVERY NOTE] To: ${formattedPhone} - ${smsErr.message}`);
            });
        }

        // 2. 💬 WhatsApp Alert Dispatch
        const twilioWhatsApp = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
        if (twilioWhatsApp) {
            const fromWhatsApp = twilioWhatsApp.startsWith('whatsapp:') ? twilioWhatsApp : `whatsapp:${twilioWhatsApp}`;
            client.messages.create({
                body: message,
                from: fromWhatsApp,
                to: `whatsapp:${formattedPhone}`
            }).then(res => {
                console.log(`✅ [WHATSAPP ALERT SENT] SID: ${res.sid} | To: whatsapp:${formattedPhone}`);
            }).catch(waErr => {
                console.warn(`⚠️ [WHATSAPP DELIVERY NOTE] To: whatsapp:${formattedPhone} - ${waErr.message}`);
            });
        }
        return { success: true };
    } catch (error) {
        console.error("❌ Notification Delivery Error:", error.message);
        return { success: false, error: error.message };
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
        const { patientName, patientPhone, doctorId, visitType, isEmergency, patientId } = req.body;
        const clinicId = req.user.clinicId;

        const { getFacilityLimits, checkAndLinkPatient } = require('../utils/auth_middleware');
        try {
            await checkAndLinkPatient(patientPhone, clinicId);
        } catch (limitErr) {
            return res.status(400).json({ success: false, message: limitErr.message });
        }

        const limits = await getFacilityLimits(clinicId, 'clinic');
        if (limits && limits.maxQueues > 0) {
            const activeCount = await Queue.countDocuments({
                clinicId,
                isApproved: true,
                status: { $in: ['Waiting', 'In-Consultation'] }
            });
            if (activeCount >= limits.maxQueues) {
                return res.status(400).json({
                    success: false,
                    message: `Queue limit reached. Your subscription plan allows up to ${limits.maxQueues} active queue entries.`
                });
            }
        }

        let resolvedPatientId = patientId;
        if (!resolvedPatientId && patientPhone && patientName) {
            const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
            const Patient = require('../models/Patient');
            const foundPatient = await Patient.findOne({
                phone: new RegExp(cleanPhone + '$'),
                name: new RegExp(`^${patientName.trim().replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'i'),
                mergedInto: null
            });
            if (foundPatient) {
                resolvedPatientId = foundPatient._id;
            }
        }

        const today = new Date().setHours(0, 0, 0, 0);
        const count = await Queue.countDocuments({ clinicId, isApproved: true, createdAt: { $gte: today } });
        const tokenNumber = isEmergency ? `E-${count + 1}` : `T-${count + 1}`;

        const newEntry = await Queue.create({
            clinicId,
            patientName,
            patientPhone,
            doctorId,
            tokenNumber,
            visitType,
            isEmergency,
            isApproved: true,
            status: 'Waiting',
            patientId: resolvedPatientId || undefined
        });

        // 🔗 If resolvedPatientId exists, append visit/appointment reference to patient digital locker
        if (resolvedPatientId) {
            try {
                const Patient = require('../models/Patient');
                const patientDoc = await Patient.findById(resolvedPatientId);
                if (patientDoc) {
                    patientDoc.appointments = patientDoc.appointments || [];
                    patientDoc.appointments.push({
                        queueId: newEntry._id,
                        clinicId,
                        doctorId,
                        appointmentDate: new Date(),
                        status: 'Scheduled'
                    });
                    patientDoc.lastVisit = new Date();
                    await patientDoc.save();
                }
            } catch (linkErr) {
                console.warn('⚠️ Could not link queue entry to patient record:', linkErr.message);
            }
        }

        // 📱 Send SMS with live tracking link
        const trackingUrl = `${getFrontendUrl()}/patient/status?id=${newEntry._id}`;
        const smsMsg = `✅ Token: ${tokenNumber} | Track your live queue status here: ${trackingUrl} - Appointory`;
        if (patientPhone) {
            sendTwilioAlert(patientPhone, smsMsg, clinicId).catch(() => { });
        }

        // 🎯 Milestone Check: Detect if this is the clinic's very first managed appointment
        let isFirstAppointment = false;
        try {
            const clinicDoc = await Clinic.findById(clinicId);
            if (clinicDoc && !clinicDoc.milestones?.firstAppointmentAt) {
                isFirstAppointment = true;
                clinicDoc.milestones = clinicDoc.milestones || {};
                clinicDoc.milestones.firstAppointmentAt = new Date();
                await clinicDoc.save();
            }
        } catch (mErr) {
            console.warn('Milestone check error:', mErr.message);
        }

        // 📢 DEBUG LOG
        console.log(`📢 Emit: queueUpdate to Room: ${clinicId}`);
        if (req.io) req.io.to(clinicId.toString()).emit('queueUpdate');

        res.status(201).json({ success: true, data: newEntry, isFirstAppointment });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 2️⃣ PUBLIC: Patient Requests Check-In (No SMS - Prevents Spam)
exports.selfCheckIn = async (req, res) => {
    try {
        const { patientName, patientPhone, clinicCode, doctorId } = req.body;
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) return res.status(404).json({ message: "Invalid Clinic Code" });

        const { checkAndLinkPatient } = require('../utils/auth_middleware');
        try {
            await checkAndLinkPatient(patientPhone, clinic._id);
        } catch (limitErr) {
            return res.status(400).json({ success: false, message: limitErr.message });
        }

        let resolvedPatientId = undefined;
        if (patientPhone && patientName) {
            const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
            const Patient = require('../models/Patient');
            const foundPatient = await Patient.findOne({
                phone: new RegExp(cleanPhone + '$'),
                name: new RegExp(`^${patientName.trim().replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'i'),
                mergedInto: null
            });
            if (foundPatient) {
                resolvedPatientId = foundPatient._id;
            }
        }

        const newRequest = await Queue.create({
            clinicId: clinic._id,
            patientName,
            patientPhone,
            doctorId,
            visitType: 'Walk-in',
            status: 'Pending-Approval',
            isApproved: false,
            patientId: resolvedPatientId
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

        const { getFacilityLimits, checkAndLinkPatient } = require('../utils/auth_middleware');
        const limits = await getFacilityLimits(clinicId, 'clinic');
        if (limits && limits.maxQueues > 0) {
            const activeCount = await Queue.countDocuments({
                clinicId,
                isApproved: true,
                status: { $in: ['Waiting', 'In-Consultation'] }
            });
            if (activeCount >= limits.maxQueues) {
                return res.status(400).json({
                    success: false,
                    message: `Queue limit reached. Your subscription plan allows up to ${limits.maxQueues} active queue entries.`
                });
            }
        }

        const pendingEntry = await Queue.findById(id);
        let resolvedPatientId = pendingEntry?.patientId;
        if (pendingEntry) {
            try {
                await checkAndLinkPatient(pendingEntry.patientPhone, clinicId);
            } catch (limitErr) {
                return res.status(400).json({ success: false, message: limitErr.message });
            }
            if (!resolvedPatientId && pendingEntry.patientPhone && pendingEntry.patientName) {
                const cleanPhone = pendingEntry.patientPhone.replace(/\D/g, '').slice(-10);
                const Patient = require('../models/Patient');
                const foundPatient = await Patient.findOne({
                    phone: new RegExp(cleanPhone + '$'),
                    name: new RegExp(`^${pendingEntry.patientName.trim().replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'i'),
                    mergedInto: null
                });
                if (foundPatient) {
                    resolvedPatientId = foundPatient._id;
                }
            }
        }

        const count = await Queue.countDocuments({ clinicId, isApproved: true, createdAt: { $gte: new Date().setHours(0, 0, 0, 0) } });
        const tokenNumber = isEmergency ? `E-${count + 1}` : `P-${count + 1}`;

        const entry = await Queue.findByIdAndUpdate(id, {
            isApproved: true, status: 'Waiting', tokenNumber, isEmergency: !!isEmergency,
            ...(resolvedPatientId ? { patientId: resolvedPatientId } : {})
        }, { new: true }).populate('clinicId', 'name');

        // 📱 Send SMS with live tracking link
        const trackingUrl = `${getFrontendUrl()}/patient/status?id=${entry._id}`;
        const simpleMessage = `✅ Confirmed! Token: ${tokenNumber} | Clinic: ${entry.clinicId.name} | Track live: ${trackingUrl} - Appointory`;

        if (entry.patientPhone) {
            sendTwilioAlert(entry.patientPhone, simpleMessage, clinicId).catch(err => {
                console.error("❌ SMS Error:", err.message);
            });
        }

        // �📢 DEBUG LOG
        console.log(`📢 Emit: queueUpdate (Approval) to Room: ${clinicId}`);
        if (req.io) req.io.to(clinicId.toString()).emit('queueUpdate');

        res.status(200).json({ success: true, data: entry });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5️⃣ Start Consultation (Send SMS notification)
        exports.startConsultation = async (req, res) => {
            try {
                const query = { _id: req.params.id };
                if (req.user.role !== 'superadmin') {
                    query.clinicId = req.user.clinicId;
                }

                const entry = await Queue.findOneAndUpdate(query, {
                    status: 'In-Consultation', startTime: Date.now()
                }, { new: true }).populate('doctorId', 'name');

                if (!entry) return res.status(404).json({ message: "Patient not found or unauthorized cross-clinic access" });

                // Update Patient's lastVisit immediately when consultation starts
                if (entry.patientId) {
                    await Patient.findByIdAndUpdate(entry.patientId, { lastVisit: Date.now() });
                }

                // Send Simple SMS Notification (Consultation Starting)
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

        // 6️⃣ Refer to Lab (SMS with lab details and timings)
        exports.referToLab = async (req, res) => {
            try {
                const { queueId } = req.params;
                const { testName, labId } = req.body;

                const updateFields = {
                    status: 'Waiting',
                    currentStage: 'Lab-Pending',
                    requiredTest: testName,
                    labId: labId || null
                };

                const query = { _id: queueId };
                if (req.user.role !== 'superadmin') {
                    query.clinicId = req.user.clinicId;
                }

                const entry = await Queue.findOneAndUpdate(query, updateFields, { new: true });
                if (!entry) return res.status(404).json({ success: false, message: "Queue record not found or unauthorized cross-clinic referral." });

                if (labId) {
                    const IndependentLab = require('../models/IndependentLab');
                    const ExternalLabRequest = require('../models/ExternalLabRequest');

                    const lab = await IndependentLab.findById(labId);
                    if (lab) {
                        // Create external lab request
                        await ExternalLabRequest.create({
                            labId,
                            clinicId: entry.clinicId,
                            patientId: entry.patientId || null,
                            patientName: entry.patientName,
                            patientPhone: entry.patientPhone,
                            testName,
                            notes: entry.consultationNotes || '',
                            queueId: entry._id
                        });

                        // Send SMS with timings & details
                        const timingStr = `${lab.openingTime || '08:00'} to ${lab.closingTime || '20:00'}`;
                        const trackingUrl = `${getFrontendUrl()}/patient/status?id=${entry._id}`;
                        const smsMsg = `✅ Token: ${entry.tokenNumber || 'T-1'} | referred for "${testName}" at ${lab.labName}.\n📍 Address: ${lab.address}\n📞 Phone: ${lab.phone}\n⏰ Timings: ${timingStr}\nTrack your live queue status here: ${trackingUrl} - Appointory`;

                        if (entry.patientPhone) {
                            sendTwilioAlert(entry.patientPhone, smsMsg, entry.clinicId).catch(() => { });
                        }

                        if (req.io) {
                            req.io.to(`lab_${labId}`).emit('testRequestUpdate');
                        }
                    }
                }

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
                const query = { _id: queueId };
                if (req.user.role !== 'superadmin' && req.user.clinicId) {
                    query.clinicId = req.user.clinicId;
                }

                const updated = await Queue.findOneAndUpdate(query, { currentStage: 'Lab-Completed' });
                if (!updated) return res.status(404).json({ success: false, message: "Queue entry not found or unauthorized." });

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

                const query = { _id: id };
                if (req.user.role !== 'superadmin') {
                    query.clinicId = req.user.clinicId;
                }

                const queueEntry = await Queue.findOne(query).populate('doctorId');
                if (!queueEntry) return res.status(404).json({ message: "Session expired or unauthorized cross-clinic access." }); ry = await Queue.findById(id).populate('doctorId');
                if (!queueEntry) return res.status(404).json({ message: "Session expired." });

                // Resolve exact patient (primary account or specific family member)
                let patient = null;
                if (queueEntry.patientId) {
                    try { patient = await Patient.findById(queueEntry.patientId); } catch (_) { }
                }
                if (!patient && queueEntry.patientPhone && queueEntry.patientName) {
                    const cleanPhone = queueEntry.patientPhone.replace(/\D/g, '').slice(-10);
                    const escapedName = queueEntry.patientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    patient = await Patient.findOne({
                        phone: new RegExp(cleanPhone + '$'),
                        name: new RegExp('^' + escapedName + '$', 'i'),
                        mergedInto: null
                    });
                }
                if (!patient && queueEntry.patientPhone) {
                    const cleanPhone = queueEntry.patientPhone.replace(/\D/g, '').slice(-10);
                    patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$'), mergedInto: null });
                }

                if (patient) {
                    patient.medicalHistory.push({
                        visitId: queueEntry._id,
                        doctorName: queueEntry.doctorId?.name || req.user?.name || "Doctor",
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

                // Create medical record with diagnosis, medicines and exact patientId
                await MedicalRecord.create({
                    clinicId: queueEntry.clinicId,
                    doctorId: queueEntry.doctorId._id,
                    patientName: queueEntry.patientName,
                    patientPhone: queueEntry.patientPhone,
                    patientId: queueEntry.patientId || patient?._id || null,
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
                await Queue.findOneAndDelete(query);

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
                        // Show active walk-ins (regardless of date, since they are still in the active queue)
                        { visitType: { $ne: 'Appointment' } },
                        // Show appointments scheduled for today or past days (to avoid losing uncompleted ones)
                        { visitType: 'Appointment', appointmentDate: { $lt: tomorrow } }
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
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);

                const doctorId = req.user.id || req.user._id;
                const myQueue = await Queue.find({
                    clinicId: req.user.clinicId,
                    doctorId: doctorId,
                    isApproved: true,
                    status: { $in: ['Waiting', 'In-Consultation'] },
                    $or: [
                        { visitType: { $ne: 'Appointment' }, createdAt: { $gte: today, $lt: tomorrow } },
                        { visitType: 'Appointment', appointmentDate: { $gte: today, $lt: tomorrow } }
                    ]
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
                        itemObj.estimatedWait = Math.min(Math.max(waitTime, 5), 180);
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
                    .populate('doctorId', 'name isAvailable')
                    .populate('labId', 'labName address phone logo openingTime closingTime');

                if (!entry) return res.status(200).json({ isCompleted: true });

                if (!entry.isApproved) {
                    return res.status(200).json({ success: true, isPendingApproval: true });
                }

                const doctorObjectId = entry.doctorId?._id || entry.doctorId;
                const clinicObjectId = entry.clinicId?._id || entry.clinicId;

                // Determine the target date of the appointment
                const entryDate = entry.appointmentDate || entry.createdAt || new Date();
                const entryDateStart = new Date(entryDate);
                entryDateStart.setHours(0, 0, 0, 0);

                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);

                const isFutureDay = entryDateStart.getTime() > todayStart.getTime();
                const isPastDay = entryDateStart.getTime() < todayStart.getTime();

                // Calculate start and end of that specific target day
                const targetDayStart = new Date(entryDateStart);
                const targetDayEnd = new Date(targetDayStart);
                targetDayEnd.setDate(targetDayEnd.getDate() + 1);

                // Count people ahead on that specific day
                const aheadQuery = {
                    _id: { $ne: entry._id },
                    clinicId: clinicObjectId,
                    doctorId: doctorObjectId,
                    isApproved: true,
                    status: { $in: ['Waiting', 'In-Consultation'] },
                    $or: [
                        {
                            visitType: { $ne: 'Appointment' },
                            createdAt: { $gte: targetDayStart, $lt: targetDayEnd, $lt: entry.createdAt }
                        },
                        {
                            visitType: 'Appointment',
                            appointmentDate: { $gte: targetDayStart, $lt: targetDayEnd, $lt: entry.appointmentDate || entry.createdAt }
                        }
                    ]
                };

                const peopleAhead = await Queue.countDocuments(aheadQuery);

                // Estimate queue delay (wait time relative to their slot/clinic opening)
                let estimatedWait;
                try {
                    estimatedWait = await estimateWaitTimeFromDb({
                        clinicId: entry.clinicId,
                        doctorId: doctorObjectId,
                        visitType: entry.visitType,
                        problem: entry.reason || entry.diagnosis || entry.consultationNotes,
                        isEmergency: !!entry.isEmergency,
                        tokenNumber: entry.tokenNumber,
                        peopleAhead
                    });
                } catch {
                    estimatedWait = Math.max(peopleAhead * 14, 5);
                }

                // Get Clinic Opening Time
                const openingTimeStr = entry.clinicId?.openingTime || '09:00';
                const [openHours, openMins] = openingTimeStr.split(':').map(Number);

                // Define when the clinic opens on that day
                const clinicOpenDate = new Date(entryDateStart);
                clinicOpenDate.setHours(openHours || 9, openMins || 0, 0, 0);

                // Base time to start queue on that day
                let baseTimeDate = new Date(clinicOpenDate);
                if (entry.visitType === 'Appointment' && entry.appointmentDate) {
                    baseTimeDate = new Date(entry.appointmentDate);
                } else {
                    const checkInTime = new Date(entry.createdAt);
                    if (checkInTime > clinicOpenDate) {
                        baseTimeDate = checkInTime;
                    }
                }

                // Predicted turn time is baseTimeDate + estimatedWait minutes
                const predictedTurnDate = new Date(baseTimeDate.getTime() + estimatedWait * 60000);

                // Calculate display minutes safely
                let displayWaitMinutes = estimatedWait;
                if (!isFutureDay) {
                    const now = new Date();
                    if (now < clinicOpenDate) {
                        const diffMs = clinicOpenDate.getTime() - now.getTime();
                        displayWaitMinutes = Math.max(Math.round(diffMs / 60000) + estimatedWait, 5);
                    } else {
                        displayWaitMinutes = Math.max(estimatedWait, 5);
                    }
                }
                displayWaitMinutes = Math.min(Math.max(displayWaitMinutes, 5), 180);

                // Helper to format predicted turn time nicely
                const formatTurnTime = (date) => {
                    const target = new Date(date);
                    const targetStart = new Date(target);
                    targetStart.setHours(0, 0, 0, 0);

                    const timeStr = target.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

                    if (targetStart.getTime() === todayStart.getTime()) {
                        return `Today at ${timeStr}`;
                    } else {
                        const tomorrowStart = new Date(todayStart);
                        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
                        if (targetStart.getTime() === tomorrowStart.getTime()) {
                            return `Tomorrow at ${timeStr}`;
                        } else {
                            const options = { day: 'numeric', month: 'short' };
                            return `${target.toLocaleDateString('en-US', options)} at ${timeStr}`;
                        }
                    }
                };

                const predictedTurnTimeStr = formatTurnTime(predictedTurnDate);

                // Calculate Lab Queue People Ahead
                let labPeopleAhead = 0;
                if (entry.labId) {
                    try {
                        const ExternalLabRequest = require('../models/ExternalLabRequest');
                        const currentReq = await ExternalLabRequest.findOne({ queueId: entry._id });
                        if (currentReq) {
                            labPeopleAhead = await ExternalLabRequest.countDocuments({
                                labId: entry.labId,
                                status: { $in: ['Pending', 'Accepted', 'Processing'] },
                                createdAt: { $lt: currentReq.createdAt }
                            });
                        }
                    } catch (err) {
                        console.error("Error calculating external lab people ahead:", err);
                    }
                } else if (entry.currentStage === 'Lab-Pending') {
                    try {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        labPeopleAhead = await Queue.countDocuments({
                            clinicId: entry.clinicId?._id || entry.clinicId,
                            currentStage: 'Lab-Pending',
                            createdAt: { $gte: today, $lt: entry.createdAt }
                        });
                    } catch (err) {
                        console.error("Error calculating in-house lab people ahead:", err);
                    }
                }

                res.status(200).json({
                    success: true,
                    data: {
                        patientName: entry.patientName,
                        tokenNumber: entry.tokenNumber,
                        status: entry.status,
                        currentStage: entry.currentStage,
                        requiredTest: entry.requiredTest,
                        clinicName: entry.clinicId?.name || 'Clinic',
                        openingTime: entry.clinicId?.openingTime || '09:00',
                        closingTime: entry.clinicId?.closingTime || '17:00',
                        isEmergency: entry.isEmergency,
                        peopleAhead,
                        estimatedWait: displayWaitMinutes,
                        predictedTurnTime: predictedTurnTimeStr,
                        isFutureDay,
                        isDoctorOnBreak: !(entry.doctorId && entry.doctorId.isAvailable),
                        labDetails: entry.labId || null,
                        labPeopleAhead
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
                        { visitType: { $ne: 'Appointment' } },
                        { visitType: 'Appointment', appointmentDate: { $lt: tomorrow } }
                    ]
                })
                    .populate('clinicId', 'name openingTime closingTime')
                    .select('tokenNumber patientName status isEmergency createdAt clinicId doctorId visitType reason diagnosis consultationNotes appointmentDate currentStage')
                    .sort({
                        status: 1,      // 'In-Consultation' first
                        isEmergency: -1, // Emergency second
                        createdAt: 1     // Oldest first
                    });

                const queueWithWait = await Promise.all(queue.map(async (item, index) => {
                    const itemObj = item.toObject ? item.toObject() : item;
                    try {
                        const doctorObjectId = item.doctorId?._id || item.doctorId;

                        // Count people ahead in this sorted list
                        const peopleAhead = index;

                        let estimatedWait;
                        try {
                            estimatedWait = await estimateWaitTimeFromDb({
                                clinicId: item.clinicId?._id || item.clinicId,
                                doctorId: doctorObjectId,
                                visitType: item.visitType,
                                problem: item.reason || item.diagnosis || item.consultationNotes,
                                isEmergency: !!item.isEmergency,
                                tokenNumber: item.tokenNumber,
                                peopleAhead
                            });
                        } catch {
                            estimatedWait = Math.max(peopleAhead * 14, 5);
                        }

                        // Get Clinic Opening Time
                        const openingTimeStr = item.clinicId?.openingTime || '09:00';
                        const [openHours, openMins] = openingTimeStr.split(':').map(Number);

                        // Today's opening time
                        const entryDate = item.appointmentDate || item.createdAt || new Date();
                        const entryDateStart = new Date(entryDate);
                        entryDateStart.setHours(0, 0, 0, 0);

                        const clinicOpenDate = new Date(entryDateStart);
                        clinicOpenDate.setHours(openHours || 9, openMins || 0, 0, 0);

                        // Base time
                        let baseTimeDate = new Date(clinicOpenDate);
                        if (item.visitType === 'Appointment' && item.appointmentDate) {
                            baseTimeDate = new Date(item.appointmentDate);
                        } else {
                            const checkInTime = new Date(item.createdAt);
                            if (checkInTime > clinicOpenDate) {
                                baseTimeDate = checkInTime;
                            }
                        }

                        // Predicted turn time is baseTimeDate + estimatedWait minutes
                        const predictedTurnDate = new Date(baseTimeDate.getTime() + estimatedWait * 60000);

                        // Calculate display minutes safely
                        const now = new Date();
                        let displayWaitMinutes = estimatedWait;

                        const apptDateObj = item.appointmentDate ? new Date(item.appointmentDate) : null;
                        if (apptDateObj && apptDateObj.toDateString() === now.toDateString() && apptDateObj > now) {
                            const diffMs = apptDateObj.getTime() - now.getTime();
                            displayWaitMinutes = Math.max(Math.round(diffMs / 60000), 5);
                        }
                        displayWaitMinutes = Math.min(Math.max(displayWaitMinutes, 5), 180);

                        itemObj.estimatedWait = displayWaitMinutes;
                        itemObj.predictedTurnTime = new Date(now.getTime() + displayWaitMinutes * 60000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                    } catch (err) {
                        itemObj.estimatedWait = 15;
                    }

                    // 🔒 PRIVACY HARDENING: Return ONLY tokens and timing to public TV displays (no names, no diagnoses, no notes)
                    return {
                        _id: item._id,
                        tokenNumber: item.tokenNumber,
                        status: item.status,
                        isEmergency: !!item.isEmergency,
                        currentStage: item.currentStage,
                        estimatedWait: itemObj.estimatedWait,
                        predictedTurnTime: itemObj.predictedTurnTime || 'Shortly'
                    };
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

                // Resolve exact target patient (primary or family member)
                let patient = null;
                if (queueEntry.patientId) {
                    try { patient = await Patient.findById(queueEntry.patientId); } catch (_) { }
                }
                if (!patient && queueEntry.patientPhone && queueEntry.patientName) {
                    const cleanPhone = queueEntry.patientPhone.replace(/\D/g, '').slice(-10);
                    const escapedName = queueEntry.patientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    patient = await Patient.findOne({
                        phone: new RegExp(cleanPhone + '$'),
                        name: new RegExp('^' + escapedName + '$', 'i'),
                        mergedInto: null
                    });
                }
                if (!patient && queueEntry.patientPhone) {
                    const cleanPhone = queueEntry.patientPhone.replace(/\D/g, '').slice(-10);
                    patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$'), mergedInto: null });
                }

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

                // 4. Queue Data for tabs — walk-ins by createdAt, appointments by appointmentDate, or pending check-ins
                const queueData = await Queue.find({
                    clinicId,
                    doctorId,
                    $or: [
                        { status: { $in: ['Pending-Approval', 'Waiting', 'In-Consultation'] } },
                        { visitType: { $ne: 'Appointment' }, createdAt: { $gte: today, $lt: tomorrow } },
                        { visitType: 'Appointment', appointmentDate: { $gte: today, $lt: tomorrow } },
                        { isApproved: false }
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

        // --- 🔒 DOCTOR'S PRIVATE NOTES ---
        exports.savePrivateNote = async (req, res) => {
            try {
                const { patientPhone, note, patientId, patientName } = req.body;
                const doctorId = req.user.id || req.user._id;

                if (!patientPhone && !patientId) {
                    return res.status(400).json({ success: false, message: "Patient phone or ID is required" });
                }

                const cleanPhone = patientPhone ? patientPhone.replace(/\D/g, '').slice(-10) : '';

                const newNote = await PrivateNote.create({
                    patientPhone: cleanPhone,
                    patientId: patientId || null,
                    patientName: patientName || '',
                    doctorId,
                    note: note || ""
                });

                res.status(201).json({
                    success: true,
                    message: "Private note stored successfully!",
                    data: newNote
                });
            } catch (error) {
                res.status(500).json({ success: false, message: error.message });
            }
        };

        exports.getPrivateNotes = async (req, res) => {
            try {
                const { phone } = req.params;
                const { patientId, patientName } = req.query;
                const doctorId = req.user.id || req.user._id;

                if (!phone && !patientId) {
                    return res.status(400).json({ success: false, message: "Patient phone or ID is required" });
                }

                const cleanPhone = phone ? phone.replace(/\D/g, '').slice(-10) : '';

                // Query scoped strictly to the specific active family member
                let query = { doctorId };
                if (patientId) {
                    query.patientId = patientId;
                } else if (cleanPhone && patientName) {
                    const escapedName = patientName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    query.patientPhone = cleanPhone;
                    query.$or = [
                        { patientName: new RegExp('^' + escapedName + '$', 'i') },
                        { patientName: { $exists: false } },
                        { patientName: '' }
                    ];
                } else if (cleanPhone) {
                    query.patientPhone = cleanPhone;
                }

                const notes = await PrivateNote.find(query).sort({ createdAt: -1 });

                res.status(200).json({
                    success: true,
                    data: notes
                });
            } catch (error) {
                res.status(500).json({ success: false, message: error.message });
            }
        };

        // 📲 Manually dispatch / resend SMS & WhatsApp Alert from Staff Dashboard (Protected by messaging paid module)
        exports.sendQueueAlert = async (req, res) => {
            try {
                const { id } = req.params;
                const entry = await Queue.findById(id).populate('clinicId', 'name').populate('doctorId', 'name');
                if (!entry) {
                    return res.status(404).json({ success: false, message: 'Queue record not found.' });
                }
                if (!entry.patientPhone) {
                    return res.status(400).json({ success: false, message: 'Patient phone number is missing.' });
                }

                const clinicId = entry.clinicId?._id || req.user.clinicId;
                const trackingUrl = `${getFrontendUrl()}/patient/status?id=${entry._id}`;
                const clinicName = entry.clinicId?.name || 'Clinic';
                const docName = entry.doctorId?.name ? `with Dr. ${entry.doctorId.name}` : '';
                const msg = `💬 SMS & WhatsApp Alert: Namaste ${entry.patientName || 'Patient'}, your Token is ${entry.tokenNumber || 'Registered'} ${docName} at ${clinicName}. Status: ${entry.status}. Track live wait times here: ${trackingUrl} - Appointory`;

                const alertRes = await sendTwilioAlert(entry.patientPhone, msg, clinicId);

                if (alertRes && alertRes.serviceLocked) {
                    return res.status(403).json({
                        success: false,
                        serviceLocked: true,
                        serviceName: 'messaging',
                        message: "The 'messaging' service module is not active in your clinic subscription. Please upgrade your subscription to enable the SMS & WhatsApp Gateway."
                    });
                }

                return res.status(200).json({
                    success: true,
                    message: `SMS & WhatsApp alert dispatched to ${entry.patientPhone} successfully.`
                });
            } catch (err) {
                return res.status(500).json({ success: false, message: err.message });
            }
        };

