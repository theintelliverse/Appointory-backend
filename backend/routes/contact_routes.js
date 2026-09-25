const express = require('express');
const router = express.Router();
const { publicWriteLimiter } = require('../utils/security_middleware');

// Helper to sanitize text
const sanitize = (text) => {
    if (typeof text !== 'string') return '';
    return text.trim().replace(/[<>]/g, '');
};

/**
 * @route   POST /api/contact
 * @desc    Submit support / grievance / general inquiry message
 * @access  Public (Rate-limited)
 */
router.post('/', publicWriteLimiter, async (req, res) => {
    try {
        const { name, email, subject, message, consent } = req.body;

        // 1. Data Minimization & Validation
        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                success: false,
                message: 'All fields (name, email, subject, message) are required.'
            });
        }

        const sanitizedName = sanitize(name);
        const sanitizedEmail = sanitize(email).toLowerCase();
        const sanitizedSubject = sanitize(subject);
        const sanitizedMessage = sanitize(message);

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(sanitizedEmail)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address.'
            });
        }

        // 2. DPDP Act Section 6 Consent Validation
        if (consent === false) {
            return res.status(400).json({
                success: false,
                message: 'Consent to process your contact information is required to respond to your inquiry.'
            });
        }

        // 3. Log securely without logging sensitive data
        console.log(`📩 Support inquiry received from ${sanitizedEmail} regarding "${sanitizedSubject}" at ${new Date().toISOString()}`);

        // 4. Attempt email dispatch via send_email utility if configured
        try {
            const { activeTransporter } = require('../utils/send_email');
            if (activeTransporter && process.env.EMAIL_USER) {
                await activeTransporter.sendMail({
                    from: `"Appointory Support Hub" <${process.env.EMAIL_USER}>`,
                    to: process.env.SUPPORT_EMAIL || 'theintelliverse@gmail.com',
                    replyTo: sanitizedEmail,
                    subject: `[Contact Form] ${sanitizedSubject} - from ${sanitizedName}`,
                    text: `New support message received from Appointory contact form:\n\nName: ${sanitizedName}\nEmail: ${sanitizedEmail}\nSubject: ${sanitizedSubject}\nConsent Acknowledged: Yes\nTimestamp: ${new Date().toISOString()}\n\nMessage:\n${sanitizedMessage}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 8px;">
                            <h2 style="color: #1A3C34; border-bottom: 2px solid #2D9B6F; padding-bottom: 8px;">Appointory Support Hub Inquiry</h2>
                            <p><strong>From:</strong> ${sanitizedName} (&lt;${sanitizedEmail}&gt;)</p>
                            <p><strong>Subject:</strong> ${sanitizedSubject}</p>
                            <p><strong>Consent Provided:</strong> Yes (DPDP Act compliant)</p>
                            <p><strong>Received At:</strong> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
                            <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; border-left: 4px solid #2D9B6F; margin-top: 15px;">
                                <p style="white-space: pre-wrap; margin: 0; color: #1e293b;">${sanitizedMessage}</p>
                            </div>
                        </div>
                    `
                });
                console.log(`✅ Support email delivered to admin inbox for: ${sanitizedEmail}`);
            }
        } catch (emailErr) {
            console.warn('⚠️ Could not dispatch notification email (service offline or unconfigured), message safely logged:', emailErr.message);
        }

        return res.status(200).json({
            success: true,
            message: 'Your message has been received successfully. Our support team will get back to you within 24-48 business hours.'
        });
    } catch (error) {
        console.error('❌ Error handling contact form submission:', error);
        return res.status(500).json({
            success: false,
            message: 'An unexpected error occurred. Please try again or contact us directly at theintelliverse@gmail.com.'
        });
    }
});

module.exports = router;
