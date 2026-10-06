const nodemailer = require('nodemailer');
const dns = require('dns');

// 🌐 Force IPv4 first
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const ipv4Lookup = (hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    dns.lookup(hostname, { family: 4 }, (err, address, family) => {
        if (typeof cb === 'function') {
            cb(err, address, family || 4);
        }
    });
};

const cleanString = (val) => (val || '').replace(/^["']|["']$/g, '').trim();
const cleanPassword = (val) => (val || '').replace(/[\s"']/g, '').trim();
const cleanSecret = (val) => (val || '').replace(/^["']|["']$/g, '').trim();

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

    const { email, to, subject, html, attachments, smtpConfig } = req.body || {};
    const recipient = email || to;
    const rawRequestSecret = req.headers['x-email-service-secret'] || req.body?.secret;

    const serviceSecret = cleanSecret(process.env.EMAIL_SERVICE_SECRET);
    const requestSecret = cleanSecret(rawRequestSecret);

    if (serviceSecret && requestSecret !== serviceSecret) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Invalid service secret.' });
    }

    if (!recipient || !subject || !html) {
        return res.status(400).json({ success: false, message: 'Missing required fields: email/to, subject, html' });
    }

    // Determine credentials and configuration
    const customUser = smtpConfig?.auth?.user ? cleanString(smtpConfig.auth.user) : null;
    const customPass = smtpConfig?.auth?.pass ? cleanPassword(smtpConfig.auth.pass) : null;
    const envUser = cleanString(process.env.EMAIL_USER);
    const envPass = cleanPassword(process.env.EMAIL_PASS);

    const authUser = customUser || envUser;
    const authPass = customPass || envPass;

    if (!authUser || !authPass) {
        return res.status(500).json({ success: false, message: 'SMTP credentials not configured on service or request.' });
    }

    const host = smtpConfig?.host || 'smtp.gmail.com';
    const isExplicit587 = Number(smtpConfig?.port) === 587;
    const primaryPort = smtpConfig?.port ? Number(smtpConfig.port) : (isExplicit587 ? 587 : 465);
    const primarySecure = smtpConfig?.secure !== undefined ? Boolean(smtpConfig.secure) : (primaryPort === 465);

    const buildTransporter = (port, secure) => {
        return nodemailer.createTransport({
            host,
            port,
            secure,
            family: 4,
            auth: {
                user: authUser,
                pass: authPass
            },
            tls: {
                rejectUnauthorized: false,
                servername: host
            },
            connectionTimeout: 15000,
            socketTimeout: 15000,
            lookup: ipv4Lookup
        });
    };

    const mailOptions = {
        from: `"Appointory Support" <${authUser}>`,
        to: recipient,
        subject: subject,
        html: html,
        attachments: attachments || []
    };

    try {
        let transporter = buildTransporter(primaryPort, primarySecure);
        let info;
        try {
            info = await transporter.sendMail(mailOptions);
        } catch (firstErr) {
            console.warn(`⚠️ Primary send on port ${primaryPort} failed (${firstErr.code || firstErr.message}). Retrying on alternate port...`);
            const fallbackPort = primaryPort === 465 ? 587 : 465;
            const fallbackSecure = fallbackPort === 465;
            transporter = buildTransporter(fallbackPort, fallbackSecure);
            info = await transporter.sendMail(mailOptions);
        }

        console.log(`✅ Email sent successfully to ${recipient} (MessageID: ${info.messageId})`);
        return res.status(200).json({ 
            success: true, 
            message: 'Email sent successfully via email-service', 
            messageId: info.messageId 
        });
    } catch (error) {
        console.error('❌ Error sending email in email-service:', error.message);
        return res.status(500).json({
            success: false,
            message: error.message,
            code: error.code || error.responseCode
        });
    }
};
