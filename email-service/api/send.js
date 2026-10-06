const nodemailer = require('nodemailer');

const cleanString = (val) => (val || '').trim();
const cleanPassword = (val) => (val || '').replace(/[\s"]/g, '').trim();

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

    // Determine credentials and configuration
    // Prioritize cleaned custom config, fallback to environment variables
    const customUser = smtpConfig?.auth?.user ? cleanString(smtpConfig.auth.user) : null;
    const customPass = smtpConfig?.auth?.pass ? cleanPassword(smtpConfig.auth.pass) : null;
    const envUser = cleanString(process.env.EMAIL_USER);
    const envPass = cleanPassword(process.env.EMAIL_PASS);

    const authUser = customUser || envUser;
    const authPass = customPass || envPass;

    if (!authUser || !authPass) {
        return res.status(500).json({ success: false, message: 'SMTP credentials not configured on service or request.' });
    }

    const isExplicit587 = smtpConfig?.port === 587;
    const transporterConfig = {
        host: smtpConfig?.host || 'smtp.gmail.com',
        port: smtpConfig?.port || (isExplicit587 ? 587 : 465),
        secure: smtpConfig?.secure !== undefined ? smtpConfig.secure : !isExplicit587,
        auth: {
            user: authUser,
            pass: authPass
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 10000,
        socketTimeout: 10000
    };

    try {
        const transporter = nodemailer.createTransport(transporterConfig);

        const mailOptions = {
            from: `"Appointory Support" <${authUser}>`,
            to: recipient,
            subject: subject,
            html: html,
            attachments: attachments || []
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to ${recipient} (MessageID: ${info.messageId})`);
        return res.status(200).json({ success: true, message: 'Email sent successfully via Vercel', messageId: info.messageId });
    } catch (error) {
        console.error('Error sending email:', error.message);
        return res.status(500).json({
            success: false,
            message: error.message,
            code: error.code || error.responseCode
        });
    }
};
