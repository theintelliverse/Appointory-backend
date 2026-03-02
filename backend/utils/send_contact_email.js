const nodemailer = require('nodemailer');

const escapeHtml = (value = '') => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

const createTransporter = () => {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

const sendContactEmail = async ({ name, email, subject, message }) => {
    const transporter = createTransporter();
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);

    const mailOptions = {
        from: `"Swasthya-Mitra Contact" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        replyTo: email,
        subject: `[Contact] ${safeSubject}`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #E8DDCB; border-radius: 20px;">
                <h2 style="color: #422D0B; margin-top: 0;">New Contact Message</h2>
                <p><b>Name:</b> ${safeName}</p>
                <p><b>Email:</b> ${safeEmail}</p>
                <p><b>Subject:</b> ${safeSubject}</p>
                <div style="background-color: #FFFBF5; padding: 15px; border-radius: 10px; margin: 20px 0;">
                    <p style="white-space: pre-line; margin: 0;">${safeMessage}</p>
                </div>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};

module.exports = sendContactEmail;
