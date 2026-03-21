const twilio = require('twilio');

const sendWhatsApp = async (phone, message) => {
    try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE || process.env.TWILIO_PHONE_NUMBER;

        if (!accountSid || !authToken || !twilioPhone) {
            console.error("❌ Missing Twilio credentials in environment variables");
            return { success: false, error: "Twilio not configured" };
        }

        const client = twilio(accountSid, authToken);

        // Clean phone number - Remove all non-digits
        let cleanPhone = phone.replace(/\D/g, '');
        
        // If it's a 10-digit Indian number, add country code
        if (cleanPhone.length === 10) {
            cleanPhone = `91${cleanPhone}`;
        }
        // If it already has country code, keep it
        else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
            // It's already formatted
        }

        const formattedPhone = cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;

        console.log(`📲 Sending WhatsApp to ${formattedPhone}...`);

        const response = await client.messages.create({
            from: `whatsapp:${twilioPhone}`,
            body: message,
            to: `whatsapp:${formattedPhone}`
        });

        console.log(`✅ WhatsApp Sent! SID: ${response.sid} | To: ${formattedPhone}`);
        return { success: true, sid: response.sid };

    } catch (error) {
        console.error("❌ Twilio WhatsApp Error:", error.message);
        return { success: false, error: error.message };
    }
};

module.exports = sendWhatsApp;