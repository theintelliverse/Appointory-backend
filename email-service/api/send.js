const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-email-service-secret'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
    }

    const { email, to, subject, html, attachments, smtpConfig } = req.body;
    const recipient = email || to;
    const requestSecret = req.headers['x-email-service-secret'] || req.body.secret;

    const serviceSecret = process.env.EMAIL_SERVICE_SECRET;
    if (serviceSecret && requestSecret !== serviceSecret) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Invalid service secret.' });
    }

    if (!recipient || !subject || !html) {
        return res.status(400).json({ success: false, message: 'Missing required fields: email/to, subject, html' });
    }

    // Determine credentials: Use custom SMTP config if provided, otherwise default to Vercel environment variables
    let transporterConfig = null;

    if (smtpConfig && smtpConfig.auth && smtpConfig.auth.user && smtpConfig.auth.pass) {
        transporterConfig = {
            host: smtpConfig.host || 'smtp.gmail.com',
            port: smtpConfig.port || 587,
            secure: smtpConfig.secure !== undefined ? smtpConfig.secure : false,
            auth: {
                user: smtpConfig.auth.user,
                pass: smtpConfig.auth.pass
            },
            tls: {
                rejectUnauthorized: false
            }
        };
    } else {
        const emailUser = process.env.EMAIL_USER;
        const emailPass = process.env.EMAIL_PASS;

        if (!emailUser || !emailPass) {
            return res.status(500).json({ success: false, message: 'Server SMTP credentials not configured' });
        }

        transporterConfig = {
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: emailUser,
                pass: emailPass
            },
            tls: {
                rejectUnauthorized: false
            }
        };
    }

    try {
        const transporter = nodemailer.createTransport(transporterConfig);

        const mailOptions = {
            from: `"Appointory Support" <${transporterConfig.auth.user}>`,
            to: recipient,
            subject: subject,
            html: html,
            attachments: attachments || []
        };

        await transporter.sendMail(mailOptions);
        return res.status(200).json({ success: true, message: 'Email sent successfully via Vercel' });
    } catch (error) {
        console.error('Error sending email:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
