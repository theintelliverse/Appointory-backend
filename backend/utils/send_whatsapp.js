/**
 * WhatsApp Utility Messaging Service
 * Dispatches transactional notifications (Immediate confirmation, 24h reminder, 2h alert, post-visit feedback)
 * Respects DPDP Act Section 9 (no promotional messages to minors)
 */

const twilio = require('twilio');

const path = require('path');
if (!process.env.TWILIO_AUTH_TOKEN) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

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
 * Sends a WhatsApp message using configured provider or logs in development/dry-run.
 * 
 * @param {Object} options
 * @param {string} options.to - Recipient phone number (normalized 10 digits or E.164)
 * @param {string} options.template - Template identifier ('booking_confirmation', 'reminder_24h', 'reminder_2h', 'post_visit')
 * @param {Array<string>} options.variables - Ordered template variables
 * @param {boolean} [options.isPromotional=false] - Whether the notification is promotional/marketing
 * @param {boolean} [options.isMinor=false] - Whether the patient or recipient profile is a minor (under 18)
 * @param {Object} [options.recipientPatient] - Optional patient object to check minor status
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string, blocked?: boolean, reason?: string }>}
 */
async function sendWhatsAppMessage({ to, template, variables = [], body, isPromotional = false, isMinor = false, recipientPatient = null }) {
    if (!to) {
        throw new Error('Recipient phone number is required');
    }

    // 🛡️ DPDP Act Section 9 Compliance: Targeted marketing or promotional messages to minors are strictly prohibited
    const isMinorTarget = Boolean(isMinor || recipientPatient?.isMinor || (recipientPatient?.age && recipientPatient.age < 18));
    if (isPromotional && isMinorTarget) {
        console.warn(`🛡️ [DPDP ACT SEC 9] Promotional WhatsApp message blocked for minor profile (${to}).`);
        return { success: false, blocked: true, reason: 'DPDP_ACT_SEC_9_MINOR_PROHIBITION' };
    }

    // Ensure format +91XXXXXXXXXX
    const digits = String(to).replace(/\D/g, '').slice(-10);
    const formattedPhone = `whatsapp:+91${digits}`;
    const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_PHONE || process.env.TWILIO_PHONE_NUMBER || '+14155238886';

    // Generate fallback text from template if body not explicitly given
    let messageText = body;
    if (!messageText) {
        switch (template) {
            case 'booking_confirmation':
                messageText = `Namaste ${variables[0] || 'Patient'}, your appointment for ${variables[1] || 'you'} with Dr. ${variables[2] || 'Doctor'} at ${variables[3] || 'Clinic'} is confirmed for ${variables[4] || 'Date'} at ${variables[5] || 'Time'}. Live status: ${variables[6] || 'https://appointory.in'} - Appointory`;
                break;
            case 'reminder_24h':
                messageText = `Namaste ${variables[0] || 'Patient'}, reminder: ${variables[1] || 'you'} have an appointment with Dr. ${variables[2] || 'Doctor'} tomorrow at ${variables[3] || 'Time'} at ${variables[4] || 'Clinic'}. Address: ${variables[5] || ''} - Appointory`;
                break;
            case 'reminder_2h':
                messageText = `Namaste ${variables[0] || 'Patient'}, your appointment for ${variables[1] || 'you'} with Dr. ${variables[2] || 'Doctor'} is in 2 hours (${variables[3] || 'Time'}). Token: ${variables[4] || 'N/A'}. Location: ${variables[5] || ''} - Appointory`;
                break;
            case 'post_visit':
                messageText = `Namaste ${variables[0] || 'Patient'}, thank you for visiting ${variables[1] || 'Clinic'}. Your digital prescription is stored securely in HealthLocker: https://appointory.in/patient/locker. How was your visit? Rate: ${variables[2] || 'https://appointory.in'} - Appointory`;
                break;
            default:
                messageText = `Appointory Notification: ${variables.join(' ')}`;
        }
    }

    // In Dry-Run or missing credentials mode, log and resolve
    if (process.env.REMINDERS_DRY_RUN === 'true' || !process.env.TWILIO_AUTH_TOKEN) {
        console.log(`[WHATSAPP DISPATCH SIMULATION] To: ${formattedPhone} | Template: ${template} | Text: "${messageText}"`);
        return { success: true, simulated: true };
    }

    try {
        const client = getTwilioClient();
        if (!client || !twilioFrom) {
            console.warn(`[WHATSAPP WARNING] WhatsApp gateway not fully configured. Message logged: to=${formattedPhone}`);
            return { success: true, simulated: true };
        }

        const fromNumber = twilioFrom.startsWith('whatsapp:') ? twilioFrom : `whatsapp:${twilioFrom}`;
        const res = await client.messages.create({
            from: fromNumber,
            to: formattedPhone,
            body: messageText
        });

        console.log(`✅ WhatsApp message sent (${res.sid}) to ${formattedPhone}`);
        return { success: true, messageId: res.sid };
    } catch (err) {
        console.error(`❌ WhatsApp dispatch error to ${formattedPhone}:`, err.message);
        throw err;
    }
}

module.exports = { sendWhatsAppMessage };