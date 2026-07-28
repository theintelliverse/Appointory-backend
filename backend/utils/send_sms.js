const twilio = require('twilio');

const sendSMS = async (phone, message) => {
    try {
        const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;

        if (!accountSid || !authToken || !twilioPhone) {
            console.error("❌ Missing Twilio credentials in environment variables");
            return { success: false, error: "Twilio not configured" };
        }

        const client = twilio(accountSid, authToken);

        // Clean phone number - Keep last 10 digits
        let cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const formattedPhone = `+91${cleanPhone}`;

        console.log(`📲 Sending SMS to ${formattedPhone}...`);

        const response = await client.messages.create({
            body: message,
            from: twilioPhone,
            to: formattedPhone
        });

        console.log(`✅ SMS Sent! SID: ${response.sid} | To: ${formattedPhone}`);
        return { success: true, sid: response.sid };
    } catch (error) {
        console.error("❌ Twilio SMS Error:", error.message);
        return { success: false, error: error.message };
    }
};

module.exports = sendSMS;
