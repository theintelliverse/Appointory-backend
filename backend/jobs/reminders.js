/**
 * Appointment Reminder Cron Job
 * Processes 24-Hour and 2-Hour transactional WhatsApp reminders.
 * Runs on schedule (e.g. every 5 minutes via node-cron or worker).
 * 
 * Features:
 * - Safe matching for legacy appointments ({ $ne: true }, { $not: { $gte: 3 } })
 * - 10-minute backoff on failure (leaves claimedAt set, preventing rapid retry exhaustion)
 * - Strict IST timezone formatting (Asia/Kolkata)
 * - Separated 'no_opt_in' skipped status with attempt decrement ($inc: -1)
 * - Provider messageId tracking for strict send idempotency
 * - Batch claim loop handling up to 50 reminders per cycle
 * - Dry-run mode with verification test dispatch to TEST_REMINDER_PHONE
 */

const Queue = require('../models/Queue');
const Patient = require('../models/Patient');
const Clinic = require('../models/Clinic');
const { sendWhatsAppMessage } = require('../utils/send_whatsapp');
const sendSMS = require('../utils/send_sms');

const IS_DRY_RUN = process.env.REMINDERS_DRY_RUN === 'true';

// Helper to check if clinic has active paid 'messaging' service module
const checkClinicMessagingAccess = async (clinicId) => {
    if (!clinicId) return false;
    try {
        const id = clinicId._id || clinicId;
        const clinic = await Clinic.findById(id);
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

// Helper to format date & time strictly in Indian Standard Time (IST)
const formatIST = (dateObj) => {
    if (!dateObj) return { time: '', date: '' };
    const date = new Date(dateObj);
    return {
        time: date.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit'
        }),
        date: date.toLocaleDateString('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        })
    };
};

/**
 * 24-Hour Reminder Processor (Window: 23h to 25h in future)
 */
async function process24hReminders() {
    const now = Date.now();
    const windowStart = new Date(now + 23 * 3600 * 1000);
    const windowEnd = new Date(now + 25 * 3600 * 1000);
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

    // 1️⃣ DRY RUN: Non-destructive audit
    if (IS_DRY_RUN) {
        const candidates = await Queue.find({
            status: 'Waiting',
            visitType: 'Appointment',
            reminder24hSent: { $ne: true },
            reminder24hSkipped: { $ne: 'no_opt_in' },
            appointmentDate: { $gte: windowStart, $lte: windowEnd }
        }).populate('doctorId clinicId');

        console.log(`[DRY-RUN 24h] Found ${candidates.length} candidates in IST window.`);
        for (const appt of candidates) {
            const { time, date } = formatIST(appt.appointmentDate);
            console.log(`[DRY-RUN 24h] Candidate: ${appt.patientName} (${appt.patientPhone}) on ${date} at ${time}`);
        }

        // Test delivery to admin/dev number if configured
        if (process.env.TEST_REMINDER_PHONE) {
            console.log(`[DRY-RUN 24h] Sending single live verification test to ${process.env.TEST_REMINDER_PHONE}...`);
            try {
                const sampleAppt = candidates[0] || {
                    patientName: 'Demo Patient',
                    doctorId: { name: 'Shah' },
                    clinicId: { name: 'Appointory Health Clinic', address: 'Navrangpura, Ahmedabad' },
                    appointmentDate: new Date(now + 24 * 3600 * 1000)
                };
                const { time } = formatIST(sampleAppt.appointmentDate);
                await sendWhatsAppMessage({
                    to: process.env.TEST_REMINDER_PHONE,
                    template: 'reminder_24h',
                    variables: ['Admin User', sampleAppt.patientName, sampleAppt.doctorId?.name || 'Doctor', time, sampleAppt.clinicId?.name || 'Clinic', sampleAppt.clinicId?.address || '']
                });
                console.log(`[DRY-RUN 24h] ✅ Provider template test verified successfully.`);
            } catch (testErr) {
                console.error(`[DRY-RUN 24h] ❌ Provider template test failed:`, testErr.message);
            }
        }
        return;
    }

    // 2️⃣ LIVE: Batch claim loop with 10-minute backoff on failure
    let processed = 0;
    while (processed < 50) {
        const appt = await Queue.findOneAndUpdate(
            {
                status: 'Waiting',
                visitType: 'Appointment',
                reminder24hSent: { $ne: true },
                reminder24hSkipped: { $ne: 'no_opt_in' },
                reminder24hAttempts: { $not: { $gte: 3 } },
                appointmentDate: { $gte: windowStart, $lte: windowEnd },
                $or: [{ claimedAt: null }, { claimedAt: { $lt: tenMinutesAgo } }]
            },
            { $set: { claimedAt: new Date() }, $inc: { reminder24hAttempts: 1 } },
            { new: true }
        ).populate('doctorId clinicId');

        if (!appt) break;
        processed++;

        // 🛡️ Idempotency guard: If provider already acknowledged dispatch in an earlier run
        if (appt.reminder24hMessageId) {
            console.log(`ℹ️ Appointment ${appt._id} was already dispatched (${appt.reminder24hMessageId}). Finalizing DB state.`);
            await Queue.findByIdAndUpdate(appt._id, { reminder24hSent: true, claimedAt: null });
            continue;
        }

        try {
            // 🔒 Service Gate Check: Verify clinic has active paid messaging subscription
            const hasMessagingAccess = await checkClinicMessagingAccess(appt.clinicId);
            if (!hasMessagingAccess) {
                console.log(`🔒 24h reminder skipped for ${appt._id}: Clinic ${appt.clinicId?._id || appt.clinicId?.name || ''} has no active SMS & WhatsApp service subscription.`);
                await Queue.findByIdAndUpdate(appt._id, {
                    reminder24hSkipped: 'service_locked',
                    $inc: { reminder24hAttempts: -1 },
                    claimedAt: null
                });
                continue;
            }

            // Find primary account or patient record
            let account = null;
            if (appt.patientId) {
                const patientDoc = await Patient.findById(appt.patientId);
                if (patientDoc?.accountId) {
                    account = await Patient.findById(patientDoc.accountId);
                } else {
                    account = patientDoc;
                }
            }
            if (!account && appt.patientPhone) {
                account = await Patient.findOne({ phone: appt.patientPhone, isPrimaryAccount: true });
            }

            const recipientPhone = account?.phone || appt.patientPhone;
            if (!recipientPhone) {
                console.log(`⏭️ 24h reminder skipped for ${appt._id}: Missing patient phone.`);
                await Queue.findByIdAndUpdate(appt._id, {
                    reminder24hSkipped: 'no_phone',
                    claimedAt: null
                });
                continue;
            }

            const { time } = formatIST(appt.appointmentDate);
            let sendResult = null;

            // 1. WhatsApp Dispatch (if opted-in)
            if (account?.whatsappOptIn) {
                try {
                    sendResult = await sendWhatsAppMessage({
                        to: recipientPhone,
                        template: 'reminder_24h',
                        variables: [account.name || appt.patientName, appt.patientName, appt.doctorId?.name || 'Doctor', time, appt.clinicId?.name || 'Clinic', appt.clinicId?.address || '']
                    });
                } catch (waErr) {
                    console.warn(`⚠️ WhatsApp 24h dispatch failed for ${appt._id}:`, waErr.message);
                }
            }

            // 2. Standard SMS Dispatch (multi-channel delivery)
            const smsMsg = `Namaste ${account?.name || appt.patientName}, reminder: you have an appointment with Dr. ${appt.doctorId?.name || 'Doctor'} tomorrow at ${time} at ${appt.clinicId?.name || 'Clinic'}. Address: ${appt.clinicId?.address || ''} - Appointory`;
            await sendSMS(recipientPhone, smsMsg).catch(smsErr => {
                console.warn(`⚠️ SMS 24h dispatch note for ${appt._id}:`, smsErr.message);
            });

            // On success: mark sent, store messageId idempotency key, and clear claim lock
            await Queue.findByIdAndUpdate(appt._id, {
                reminder24hSent: true,
                reminder24hMessageId: sendResult?.messageId || `sent_${Date.now()}`,
                claimedAt: null
            });
            console.log(`✅ 24h reminder dispatched for appt ${appt._id} to ${recipientPhone}`);
        } catch (err) {
            console.error(`❌ Failed to send 24h reminder for ${appt._id}:`, err.message);
            // 🛑 CRITICAL: Do NOT clear claimedAt! The 10-minute timeout serves as natural backoff delay
        }
    }
}

/**
 * 2-Hour Reminder Processor (Window: 1.5h to 2.5h in future)
 */
async function process2hReminders() {
    const now = Date.now();
    const windowStart = new Date(now + Math.round(1.5 * 3600 * 1000));
    const windowEnd = new Date(now + Math.round(2.5 * 3600 * 1000));
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000);

    if (IS_DRY_RUN) {
        const candidates = await Queue.find({
            status: 'Waiting',
            visitType: 'Appointment',
            reminder2hSent: { $ne: true },
            reminder2hSkipped: { $ne: 'no_opt_in' },
            appointmentDate: { $gte: windowStart, $lte: windowEnd }
        }).populate('doctorId clinicId');

        console.log(`[DRY-RUN 2h] Found ${candidates.length} candidates in IST window.`);
        return;
    }

    let processed = 0;
    while (processed < 50) {
        const appt = await Queue.findOneAndUpdate(
            {
                status: 'Waiting',
                visitType: 'Appointment',
                reminder2hSent: { $ne: true },
                reminder2hSkipped: { $ne: 'no_opt_in' },
                reminder2hAttempts: { $not: { $gte: 3 } },
                appointmentDate: { $gte: windowStart, $lte: windowEnd },
                $or: [{ claimedAt: null }, { claimedAt: { $lt: tenMinutesAgo } }]
            },
            { $set: { claimedAt: new Date() }, $inc: { reminder2hAttempts: 1 } },
            { new: true }
        ).populate('doctorId clinicId');

        if (!appt) break;
        processed++;

        if (appt.reminder2hMessageId) {
            console.log(`ℹ️ Appointment ${appt._id} was already dispatched for 2h alert. Finalizing DB state.`);
            await Queue.findByIdAndUpdate(appt._id, { reminder2hSent: true, claimedAt: null });
            continue;
        }

        try {
            // 🔒 Service Gate Check: Verify clinic has active paid messaging subscription
            const hasMessagingAccess = await checkClinicMessagingAccess(appt.clinicId);
            if (!hasMessagingAccess) {
                console.log(`🔒 2h reminder skipped for ${appt._id}: Clinic ${appt.clinicId?._id || appt.clinicId?.name || ''} has no active SMS & WhatsApp service subscription.`);
                await Queue.findByIdAndUpdate(appt._id, {
                    reminder2hSkipped: 'service_locked',
                    $inc: { reminder2hAttempts: -1 },
                    claimedAt: null
                });
                continue;
            }

            let account = null;
            if (appt.patientId) {
                const patientDoc = await Patient.findById(appt.patientId);
                if (patientDoc?.accountId) {
                    account = await Patient.findById(patientDoc.accountId);
                } else {
                    account = patientDoc;
                }
            }
            if (!account && appt.patientPhone) {
                account = await Patient.findOne({ phone: appt.patientPhone, isPrimaryAccount: true });
            }

            const recipientPhone = account?.phone || appt.patientPhone;
            if (!recipientPhone) {
                console.log(`⏭️ 2h alert skipped for ${appt._id}: Missing patient phone.`);
                await Queue.findByIdAndUpdate(appt._id, {
                    reminder2hSkipped: 'no_phone',
                    claimedAt: null
                });
                continue;
            }

            const { time } = formatIST(appt.appointmentDate);
            let sendResult = null;

            // 1. WhatsApp Dispatch (if opted-in)
            if (account?.whatsappOptIn) {
                try {
                    sendResult = await sendWhatsAppMessage({
                        to: recipientPhone,
                        template: 'reminder_2h',
                        variables: [account.name || appt.patientName, appt.patientName, appt.doctorId?.name || 'Doctor', time, appt.tokenNumber || 'Token Assigned on Arrival', appt.clinicId?.name || 'Clinic']
                    });
                } catch (waErr) {
                    console.warn(`⚠️ WhatsApp 2h dispatch failed for ${appt._id}:`, waErr.message);
                }
            }

            // 2. Standard SMS Dispatch (multi-channel delivery)
            const tokenStr = appt.tokenNumber ? `Token: ${appt.tokenNumber}` : `Please collect token upon arrival`;
            const smsMsg = `Namaste ${account?.name || appt.patientName}, your appointment for ${appt.patientName} with Dr. ${appt.doctorId?.name || 'Doctor'} is in 2 hours (${time}) at ${appt.clinicId?.name || 'Clinic'}. ${tokenStr}. - Appointory`;
            await sendSMS(recipientPhone, smsMsg).catch(smsErr => {
                console.warn(`⚠️ SMS 2h dispatch note for ${appt._id}:`, smsErr.message);
            });

            await Queue.findByIdAndUpdate(appt._id, {
                reminder2hSent: true,
                reminder2hMessageId: sendResult?.messageId || `sent_${Date.now()}`,
                claimedAt: null
            });
            console.log(`✅ 2h alert dispatched for appt ${appt._id} to ${recipientPhone}`);
        } catch (err) {
            console.error(`❌ Failed to send 2h alert for ${appt._id}:`, err.message);
            // Leave claimedAt set so 10-minute backoff applies
        }
    }
}

/**
 * Main Scheduler Entry Point
 */
async function runReminderCycle() {
    console.log(`⏱️ Starting Reminder Cycle (${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST)...`);
    try {
        await process24hReminders();
        await process2hReminders();
    } catch (cycleErr) {
        console.error('❌ Reminder cycle error:', cycleErr);
    }
}

module.exports = { runReminderCycle, process24hReminders, process2hReminders };
