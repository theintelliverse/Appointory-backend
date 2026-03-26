/**
 * Appointment Reminder Scheduler
 * Schedules SMS messages to be sent 15 min and 5 min before appointment
 */

const schedule = require('node-schedule');
const twilio = require('twilio');
const Queue = require('../models/Queue');

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// In-memory store of scheduled jobs
const scheduledReminders = new Map();

/**
 * Schedule reminder messages for an appointment
 * @param {String} queueId - Queue entry ID
 * @param {String} patientPhone - Patient phone number
 * @param {Number} estimatedDurationMinutes - How long the appointment should take
 * @param {String} doctorName - Doctor's name
 */
async function scheduleAppointmentReminders(queueId, patientPhone, estimatedDurationMinutes, doctorName) {
    try {
        // Current time when appointment starts
        const appointmentStartTime = new Date();
        
        // When appointment will end (estimated)
        const appointmentEndTime = new Date(appointmentStartTime.getTime() + estimatedDurationMinutes * 60000);

        // When to send 15 min reminder (15 min before appointment ends)
        const reminder15MinTime = new Date(appointmentEndTime.getTime() - 15 * 60000);

        // When to send 5 min reminder (5 min before appointment ends)
        const reminder5MinTime = new Date(appointmentEndTime.getTime() - 5 * 60000);

        // Only schedule if times are in the future
        const now = new Date();
        
        // 15-minute reminder
        if (reminder15MinTime > now) {
            const jobId15 = `reminder_15_${queueId}`;
            
            const job15 = schedule.scheduleJob(jobId15, reminder15MinTime, async () => {
                try {
                    const message15 = `⏰ Reminder: Your consultation with Dr. ${doctorName} is ending soon! Please wrap up in about 15 minutes. Thank you! - SwasthyaMitra`;
                    
                    // Send SMS instead of WhatsApp
                    if (patientPhone) {
                        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
                        const formattedPhone = `+91${cleanPhone}`;
                        
                        try {
                            await client.messages.create({
                                body: message15,
                                from: process.env.TWILIO_PHONE_NUMBER,
                                to: formattedPhone
                            });
                            console.log(`✅ 15-min SMS reminder sent for ${queueId} to ${formattedPhone}`);
                        } catch (smsError) {
                            console.error('Error sending 15-min SMS reminder:', smsError.message);
                        }
                    }
                } catch (error) {
                    console.error('Error scheduling 15-min reminder:', error);
                }
            });

            scheduledReminders.set(jobId15, job15);
            console.log(`📅 Scheduled 15-min SMS reminder for ${queueId} at ${reminder15MinTime.toLocaleTimeString()}`);
        }

        // 5-minute reminder
        if (reminder5MinTime > now) {
            const jobId5 = `reminder_5_${queueId}`;
            
            const job5 = schedule.scheduleJob(jobId5, reminder5MinTime, async () => {
                try {
                    const message5 = `⏰ Final Reminder: Your appointment is ending in 5 minutes! Please conclude the consultation. Thank you! - SwasthyaMitra`;
                    
                    // Send SMS instead of WhatsApp
                    if (patientPhone) {
                        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
                        const formattedPhone = `+91${cleanPhone}`;
                        
                        try {
                            await client.messages.create({
                                body: message5,
                                from: process.env.TWILIO_PHONE_NUMBER,
                                to: formattedPhone
                            });
                            console.log(`✅ 5-min SMS reminder sent for ${queueId} to ${formattedPhone}`);
                        } catch (smsError) {
                            console.error('Error sending 5-min SMS reminder:', smsError.message);
                        }
                    }
                } catch (error) {
                    console.error('Error scheduling 5-min reminder:', error);
                }
            });

            scheduledReminders.set(jobId5, job5);
            console.log(`📅 Scheduled 5-min SMS reminder for ${queueId} at ${reminder5MinTime.toLocaleTimeString()}`);
        }

        return {
            success: true,
            reminder15minTime: reminder15MinTime,
            reminder5minTime: reminder5MinTime,
            estimatedDuration: estimatedDurationMinutes
        };

    } catch (error) {
        console.error('Error scheduling reminders:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Cancel scheduled reminders for an appointment
 * @param {String} queueId - Queue entry ID
 */
function cancelAppointmentReminders(queueId) {
    try {
        const jobId15 = `reminder_15_${queueId}`;
        const jobId5 = `reminder_5_${queueId}`;

        // Cancel 15-min reminder
        if (scheduledReminders.has(jobId15)) {
            const job15 = scheduledReminders.get(jobId15);
            job15.cancel();
            scheduledReminders.delete(jobId15);
            console.log(`❌ Cancelled 15-min reminder for ${queueId}`);
        }

        // Cancel 5-min reminder
        if (scheduledReminders.has(jobId5)) {
            const job5 = scheduledReminders.get(jobId5);
            job5.cancel();
            scheduledReminders.delete(jobId5);
            console.log(`❌ Cancelled 5-min reminder for ${queueId}`);
        }

        return { success: true };
    } catch (error) {
        console.error('Error cancelling reminders:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get status of scheduled reminders
 * @param {String} queueId - Queue entry ID (optional)
 */
function getReminderStatus(queueId = null) {
    if (queueId) {
        const jobId15 = `reminder_15_${queueId}`;
        const jobId5 = `reminder_5_${queueId}`;
        
        return {
            reminder15min: scheduledReminders.has(jobId15),
            reminder5min: scheduledReminders.has(jobId5)
        };
    }

    return {
        totalScheduled: scheduledReminders.size,
        jobs: Array.from(scheduledReminders.keys())
    };
}

module.exports = {
    scheduleAppointmentReminders,
    cancelAppointmentReminders,
    getReminderStatus
};
