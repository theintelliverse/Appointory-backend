const CallRequest = require('../models/CallRequest');
const Patient = require('../models/Patient');
const User = require('../models/User');
const Clinic = require('../models/Clinic');
const twilio = require('twilio');
const schedule = require('node-schedule');

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// Store scheduled jobs for cleanup
const scheduledJobs = {};

/**
 * 📞 DOCTOR INITIATES CALL & SENDS WHATSAPP NOTIFICATION
 * @route POST /api/call/initiate-call
 */
exports.initiateCall = async (req, res) => {
    try {
        const { patientPhone, patientName, reminderTimings, notes } = req.body;
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId;

        // ✅ Validation
        if (!patientPhone) {
            return res.status(400).json({ success: false, message: "Patient phone is required" });
        }

        // Clean patient phone
        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);

        // Find clinic
        const clinic = await Clinic.findById(clinicId);
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic not found" });
        }

        // Find doctor
        const doctor = await User.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        // Check if patient exists
        const patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$') });
        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found" });
        }

        // Parse reminder timings (default: 5, 10, 15 minutes)
        const timings = reminderTimings || [5, 10, 15];
        if (!Array.isArray(timings)) {
            return res.status(400).json({ success: false, message: "Reminder timings must be an array" });
        }

        // ✅ Create Call Request Record
        const callRequest = await CallRequest.create({
            clinicId,
            doctorId,
            patientPhone: cleanPhone,
            patientName: patientName || patient.name,
            reminderTimings: timings,
            notes: notes || null
        });

        console.log(`📞 Call initiated from Dr. ${doctor.name} to ${cleanPhone} | Call ID: ${callRequest._id}`);

        // ✅ Send Initial SMS Message
        const initialMessage = `Hi ${patient.name || 'there'}! Dr. ${doctor.name} is calling you for your appointment at ${clinic.name}. Please reply "Yes" to confirm. We will remind you if you don't respond. - SwasthyaMitra`;

        try {
            const formattedPhone = `+91${cleanPhone}`;
            const smsResult = await client.messages.create({
                body: initialMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });

            callRequest.smsSent = true;
            callRequest.smsMessageSid = smsResult.sid;
            callRequest.smsSentAt = new Date();
            callRequest.status = 'notified';
            await callRequest.save();

            console.log(`✅ Initial SMS sent successfully | SID: ${smsResult.sid}`);

            // ✅ SCHEDULE REMINDER MESSAGES
            scheduleReminders(callRequest, doctor, clinic, patient);

            // ✅ NOTIFY DOCTOR VIA SOCKET.IO
            if (req.io) {
                req.io.to(clinicId.toString()).emit('callInitiated', {
                    callId: callRequest._id,
                    doctorName: doctor.name,
                    patientName: patient.name,
                    patientPhone: cleanPhone,
                    status: 'smsSent',
                    timestamp: new Date()
                });

                // Emit to doctor's personal room
                req.io.to(doctorId.toString()).emit('callStatusUpdate', {
                    callId: callRequest._id,
                    message: `SMS sent to ${patient.name}`,
                    status: 'sent'
                });
            }

            return res.status(201).json({
                success: true,
                message: "SMS notification sent to patient",
                callId: callRequest._id,
                smsSid: smsResult.sid
            });
        } catch (smsError) {
            console.error(`❌ Failed to send SMS: ${smsError.message}`);

            // Notify doctor of failure
            if (req.io) {
                req.io.to(doctorId.toString()).emit('callStatusUpdate', {
                    callId: callRequest._id,
                    message: `Failed to send WhatsApp: ${whatsappResult.error}`,
                    status: 'failed'
                });
            }

            return res.status(500).json({
                success: false,
                message: "Failed to send WhatsApp",
                error: whatsappResult.error
            });
        }
    } catch (error) {
        console.error('❌ Initiate Call Error:', error.message);
        res.status(500).json({
            success: false,
            message: "Error initiating call",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * ⏰ SCHEDULE REMINDER MESSAGES
 */
const scheduleReminders = async (callRequest, doctor, clinic, patient) => {
    try {
        const { reminderTimings } = callRequest;
        const callId = callRequest._id.toString();

        // Sort timings and schedule each reminder
        const sortedTimings = reminderTimings.sort((a, b) => a - b);

        for (const minutesAfter of sortedTimings) {
            const reminderTime = new Date(callRequest.whatsappSentAt.getTime() + minutesAfter * 60000);

            const jobKey = `${callId}_${minutesAfter}`;

            // Schedule the reminder
            const job = schedule.scheduleJob(jobKey, reminderTime, async () => {
                console.log(`⏰ Sending ${minutesAfter}-minute reminder for Call ID: ${callId}`);
                await sendReminder(callRequest, doctor, clinic, patient, minutesAfter);

                // Clean up the scheduled job
                delete scheduledJobs[jobKey];
            });

            scheduledJobs[jobKey] = job;
            console.log(`✅ Scheduled ${minutesAfter}-min reminder at ${reminderTime.toISOString()}`);
        }
    } catch (error) {
        console.error('❌ Error scheduling reminders:', error.message);
    }
};

/**
 * 🔔 SEND REMINDER MESSAGE (SMS)
 */
const sendReminder = async (callRequest, doctor, clinic, patient, minutesAfter) => {
    try {
        const reminderMessage = `Reminder: Dr. ${doctor.name} is still waiting for you at ${clinic.name}! Please reply "Yes" to confirm you're joining the consultation. - SwasthyaMitra`;

        try {
            const formattedPhone = `+91${callRequest.patientPhone}`;
            const smsResult = await client.messages.create({
                body: reminderMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: formattedPhone
            });

            // Update call request with reminder details
            callRequest.remindersSent.push({
                minutesAfter,
                sentAt: new Date(),
                messageSid: smsResult.sid,
                status: 'sent'
            });
            callRequest.status = 'reminded';
            await callRequest.save();

            console.log(`✅ ${minutesAfter}-minute SMS reminder sent | SID: ${smsResult.sid}`);
        } catch (smsError) {
            console.error(`❌ Failed to send ${minutesAfter}-minute SMS reminder: ${smsError.message}`);

            callRequest.remindersSent.push({
                minutesAfter,
                sentAt: new Date(),
                messageSid: null,
                status: 'failed'
            });
            await callRequest.save();
        }
    } catch (error) {
        console.error('❌ Error sending reminder:', error.message);
    }
};

/**
 * ✅ PATIENT CONFIRMS RECEIPT
 * @route POST /api/call/confirm-call/:callId
 */
exports.confirmCall = async (req, res) => {
    try {
        const { callId } = req.params;

        const callRequest = await CallRequest.findById(callId);
        if (!callRequest) {
            return res.status(404).json({ success: false, message: "Call request not found" });
        }

        // Update confirmation
        callRequest.patientConfirmed = true;
        callRequest.patientConfirmedAt = new Date();
        callRequest.status = 'confirmed';
        callRequest.actualJoinTime = new Date();
        await callRequest.save();

        console.log(`✅ Patient confirmed call: ${callId}`);

        // Notify doctor via Socket.io
        const callPopulated = await callRequest.populate(['doctorId', 'clinicId']);
        if (req.io) {
            req.io.to(callRequest.clinicId.toString()).emit('patientConfirmed', {
                callId,
                patientName: callRequest.patientName,
                doctorName: callPopulated.doctorId?.name,
                confirmedAt: callRequest.patientConfirmedAt
            });
        }

        res.status(200).json({
            success: true,
            message: "Call confirmed successfully",
            callId
        });
    } catch (error) {
        console.error('❌ Confirm Call Error:', error.message);
        res.status(500).json({
            success: false,
            message: "Error confirming call"
        });
    }
};

/**
 * 📋 GET CALL HISTORY FOR DOCTOR
 * @route GET /api/call/history
 */
exports.getCallHistory = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const clinicId = req.user.clinicId;

        const callRequests = await CallRequest.find({
            clinicId,
            doctorId
        })
            .sort({ createdAt: -1 })
            .limit(50);

        res.status(200).json({
            success: true,
            count: callRequests.length,
            data: callRequests
        });
    } catch (error) {
        console.error('❌ Get Call History Error:', error.message);
        res.status(500).json({
            success: false,
            message: "Error retrieving call history"
        });
    }
};

/**
 * 📊 GET CALL STATISTICS
 * @route GET /api/call/stats
 */
exports.getCallStats = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const doctorId = req.user.id;

        const stats = await CallRequest.aggregate([
            { $match: { clinicId: require('mongoose').Types.ObjectId(clinicId), doctorId: require('mongoose').Types.ObjectId(doctorId) } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    confirmed: { $sum: { $cond: ['$patientConfirmed', 1, 0] } },
                    missed: { $sum: { $cond: ['$patientConfirmed', 0, 1] } },
                    whatsappSent: { $sum: { $cond: ['$whatsappSent', 1, 0] } }
                }
            }
        ]);

        const result = stats[0] || { total: 0, confirmed: 0, missed: 0, whatsappSent: 0 };
        const confirmationRate = result.total > 0 ? ((result.confirmed / result.total) * 100).toFixed(2) : 0;

        res.status(200).json({
            success: true,
            stats: {
                ...result,
                confirmationRate: `${confirmationRate}%`
            }
        });
    } catch (error) {
        console.error('❌ Get Call Stats Error:', error.message);
        res.status(500).json({
            success: false,
            message: "Error retrieving call statistics"
        });
    }
};

/**
 * 🛑 CANCEL SCHEDULED REMINDERS
 * @route POST /api/call/cancel-reminders/:callId
 */
exports.cancelReminders = async (req, res) => {
    try {
        const { callId } = req.params;

        const callRequest = await CallRequest.findById(callId);
        if (!callRequest) {
            return res.status(404).json({ success: false, message: "Call request not found" });
        }

        // Cancel all scheduled jobs for this call
        const jobKeys = Object.keys(scheduledJobs).filter(key => key.startsWith(callId));
        jobKeys.forEach(key => {
            scheduledJobs[key].cancel();
            delete scheduledJobs[key];
            console.log(`✅ Cancelled scheduled job: ${key}`);
        });

        res.status(200).json({
            success: true,
            message: "Reminders cancelled successfully",
            cancelledCount: jobKeys.length
        });
    } catch (error) {
        console.error('❌ Cancel Reminders Error:', error.message);
        res.status(500).json({
            success: false,
            message: "Error cancelling reminders"
        });
    }
};

module.exports = exports;
