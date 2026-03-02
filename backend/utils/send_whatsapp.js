const twilio = require('twilio');

const sendWhatsApp = async (phone, message) => {
    try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const configuredFrom = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;

        if (!accountSid || !authToken || !configuredFrom) {
            throw new Error('WhatsApp service is not configured. Set Twilio SID, auth token, and sender number.');
        }

        const client = twilio(accountSid, authToken);

        // Twilio requires numbers in E.164 format (e.g., +91...)
        // We ensure it starts with '+'
        const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
        const fromNumber = configuredFrom.startsWith('whatsapp:') ? configuredFrom : `whatsapp:${configuredFrom}`;
        const toNumber = formattedPhone.startsWith('whatsapp:') ? formattedPhone : `whatsapp:${formattedPhone}`;

        const response = await client.messages.create({
            from: fromNumber,
            body: message,
            to: toNumber
        });

        console.log(`✅ WhatsApp Sent! SID: ${response.sid}`);
        return response;
    } catch (error) {
        console.error("❌ Twilio Error:", error.message);
        return null;
    }
};

module.exports = sendWhatsApp;