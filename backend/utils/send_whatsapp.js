const twilio = require('twilio');

const sendWhatsApp = async (phone, message) => {
    try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
        const client = twilio(accountSid, process.env.TWILIO_AUTH_TOKEN);

        // Twilio requires numbers in E.164 format (e.g., +91...)
        // We ensure it starts with '+'
        const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

        const response = await client.messages.create({
            from: `whatsapp:${process.env.TWILIO_PHONE}`, // Your Twilio Sandbox number
            body: message,
            to: `whatsapp:${formattedPhone}`
        });

        console.log(`✅ WhatsApp Sent! SID: ${response.sid}`);
    } catch (error) {
        console.error("❌ Twilio Error:", error.message);
    }
};

module.exports = sendWhatsApp;