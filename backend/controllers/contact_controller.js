const sendContactEmail = require('../utils/send_contact_email');

exports.submitContactForm = async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address'
            });
        }

        await sendContactEmail({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            subject: subject.trim(),
            message: message.trim()
        });

        return res.status(200).json({
            success: true,
            message: 'Message sent successfully'
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Unable to send message right now. Please try again later.'
        });
    }
};
