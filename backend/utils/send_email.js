const nodemailer = require('nodemailer');

// ✅ VALIDATION: Check if Gmail credentials are configured
const validateEmailConfig = () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('❌ EMAIL CONFIGURATION ERROR: Missing EMAIL_USER or EMAIL_PASS in environment variables');
        return false;
    }
    return true;
};

// Create transporter (Using Gmail)
const createTransporter = () => {
    if (!validateEmailConfig()) {
        throw new Error('Email service is not properly configured. Please set EMAIL_USER and EMAIL_PASS environment variables.');
    }

    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,       // Use 465 for secure, or 587 for TLS
        secure: true,    // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
        tls: {
            // Do not fail on invalid certs
            rejectUnauthorized: false
        },
        // Add connection timeout to prevent hanging
        connectionTimeout: 10000,
        socketTimeout: 10000,
    });
};

let transporter = null;
let emailServiceReady = false;

// Initialize transporter safely with proper async handling
const initializeEmailService = async () => {
    try {
        if (!validateEmailConfig()) {
            console.log('⚠️  Email service disabled: Credentials not configured');
            return;
        }

        transporter = createTransporter();
        console.log('📧 Initializing email service...');

        // Test connection with promise wrapper
        return new Promise((resolve, reject) => {
            transporter.verify((error, success) => {
                if (error) {
                    console.error('❌ EMAIL TRANSPORTER VERIFICATION FAILED:', error.message);
                    console.error('📝 Troubleshooting Steps:');
                    console.error('   1. Check your EMAIL_USER and EMAIL_PASS in environment variables');
                    console.error('   2. If using Gmail with 2FA enabled:');
                    console.error('      - Generate an App Password at: https://myaccount.google.com/apppasswords');
                    console.error('      - Use the 16-character app password in EMAIL_PASS');
                    console.error('   3. Check these specific Gmail security settings:');
                    console.error('      - Go to: https://myaccount.google.com/security');
                    console.error('      - Enable "Less secure app access" if 2FA is not enabled');
                    console.error('      - Or use an App Password if 2FA is enabled');
                    transporter = null;
                    emailServiceReady = false;
                    reject(error);
                } else {
                    console.log('✅ EMAIL SERVICE INITIALIZED SUCCESSFULLY');
                    console.log(`   Verified with: ${process.env.EMAIL_USER}`);
                    emailServiceReady = true;
                    resolve();
                }
            });
        });
    } catch (error) {
        console.error('⚠️  EMAIL SERVICE INITIALIZATION ERROR:', error.message);
        transporter = null;
        emailServiceReady = false;
        throw error;
    }
};

// Initialize email service immediately (non-blocking with error handling)
if (validateEmailConfig()) {
    initializeEmailService().catch(error => {
        console.error('⚠️  Email service will not be available:', error.message);
        // Don't crash the app, just log a warning
    });
} else {
    console.log('⚠️  Email service disabled: EMAIL_USER and EMAIL_PASS');
}
const { decrypt } = require('./crypto_helper');

// Helper to resolve transporter dynamically
const getTransporterAndSender = async () => {
    try {
        const SystemConfig = require('../models/SystemConfig');
        const config = await SystemConfig.findOne();
        if (config && config.smtpUser && config.smtpPass) {
            const decryptedPass = decrypt(config.smtpPass);
            const activeTransporter = nodemailer.createTransport({
                host: config.smtpHost || 'smtp.gmail.com',
                port: config.smtpPort || 587,
                secure: config.smtpSecure || false,
                auth: {
                    user: config.smtpUser,
                    pass: decryptedPass,
                },
                tls: {
                    rejectUnauthorized: false
                },
                connectionTimeout: 10000,
                socketTimeout: 10000,
            });
            return { activeTransporter, senderUser: config.smtpUser };
        }
    } catch (err) {
        console.error('Error fetching dynamic SMTP config, falling back:', err.message);
    }
    
    return { activeTransporter: transporter, senderUser: process.env.EMAIL_USER || 'support@appointory.com' };
};

// Helper to detect dummy or invalid emails (e.g. admin@facility.com, example.com, etc.)
const isDummyEmail = (email) => {
    if (!email || typeof email !== 'string') return true;
    const clean = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(clean)) return true;
    const dummyDomains = ['facility.com', 'example.com', 'test.com', 'invalid.com', 'localhost', 'sample.com'];
    const domain = clean.split('@')[1];
    return dummyDomains.includes(domain);
};

const sendSupportConfirmationEmail = async (ticket, superadminEmail) => {
    try {
        const { activeTransporter, senderUser } = await getTransporterAndSender();
        if (!activeTransporter) {
            throw new Error('Email service is not initialized. Check SMTP configuration.');
        }

        const userHtml = `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 25px; background-color: #ffffff;">
                <h2 style="color: #0F766E; margin-top: 0;">We've received your support request!</h2>
                <p>Hello ${ticket.senderName},</p>
                <p>Thank you for reaching out to Appointory Support. We have received your ticket and our superadmin team is investigating it.</p>
                <div style="background-color: #f8fafc; border-radius: 8px; padding: 15px; margin: 20px 0; border: 1px solid #f1f5f9;">
                    <p style="margin: 0 0 8px 0;"><strong>Ticket Details:</strong></p>
                    <p style="margin: 0 0 5px 0;"><strong>Facility:</strong> ${ticket.facilityName} (${ticket.facilityType})</p>
                    <p style="margin: 0 0 5px 0;"><strong>Subject:</strong> ${ticket.subject}</p>
                    <p style="margin: 0;"><strong>Message:</strong> ${ticket.message}</p>
                </div>
                <p>Our team will get back to you shortly. You will receive an email once this ticket is resolved.</p>
                <p style="color: #64748b; font-size: 12px; border-top: 1px solid #f1f5f9; padding-top: 15px; margin-top: 25px;">This is an automated confirmation email. Please do not reply directly to this message.</p>
            </div>
        `;

        const adminHtml = `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 25px; background-color: #ffffff;">
                <h2 style="color: #c2410c; margin-top: 0;">🚨 New Support Ticket Filed</h2>
                <p>A new support request has been submitted by a facility administrator.</p>
                <div style="background-color: #fff7ed; border-radius: 8px; padding: 15px; margin: 20px 0; border: 1px solid #ffedd5;">
                    <p style="margin: 0 0 5px 0;"><strong>Facility Name:</strong> ${ticket.facilityName}</p>
                    <p style="margin: 0 0 5px 0;"><strong>Facility Type:</strong> ${ticket.facilityType}</p>
                    <p style="margin: 0 0 5px 0;"><strong>Sender:</strong> ${ticket.senderName} (${ticket.senderEmail})</p>
                    <p style="margin: 0 0 5px 0;"><strong>Subject:</strong> ${ticket.subject}</p>
                    <p style="margin: 0;"><strong>Message:</strong> ${ticket.message}</p>
                </div>
                <p>Log in to the Superadmin Dashboard to view and mark this ticket as resolved.</p>
            </div>
        `;

        // Send to user only if senderEmail is a valid non-dummy email
        if (!isDummyEmail(ticket.senderEmail)) {
            try {
                await activeTransporter.sendMail({
                    from: `"Appointory Support" <${senderUser}>`,
                    to: ticket.senderEmail,
                    subject: `Support Ticket Received: ${ticket.subject}`,
                    html: userHtml
                });
                console.log(`✅ Support confirmation email sent to user: ${ticket.senderEmail}`);
            } catch (userMailErr) {
                console.error(`⚠️ Failed to send ticket confirmation to user (${ticket.senderEmail}):`, userMailErr.message);
            }
        } else {
            console.log(`ℹ️ Skipped sending ticket confirmation email to dummy/invalid address: ${ticket.senderEmail}`);
        }

        // Send to superadmin if configured
        const finalAdminEmail = superadminEmail || senderUser;
        if (finalAdminEmail) {
            await activeTransporter.sendMail({
                from: `"Appointory System Alerts" <${senderUser}>`,
                to: finalAdminEmail,
                subject: `🚨 Support Ticket: ${ticket.facilityName} - ${ticket.subject}`,
                html: adminHtml
            });
            console.log(`✅ Support ticket notification sent to Super Admin (${finalAdminEmail})`);
        }
    } catch (err) {
        console.error('Error sending support confirmation emails:', err.message);
    }
};

const sendResolutionEmail = async (ticket, resolutionText) => {
    try {
        if (isDummyEmail(ticket.senderEmail)) {
            console.log(`ℹ️ Skipped sending resolution email to dummy/invalid address: ${ticket.senderEmail}`);
            return;
        }

        const { activeTransporter, senderUser } = await getTransporterAndSender();
        if (!activeTransporter) {
            throw new Error('Email service is not initialized. Check SMTP configuration.');
        }

        const html = `
            <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 25px; background-color: #ffffff;">
                <h2 style="color: #0F766E; margin-top: 0;">Your Support Ticket Has Been Resolved!</h2>
                <p>Hello ${ticket.senderName},</p>
                <p>We are writing to inform you that your support ticket regarding "<strong>${ticket.subject}</strong>" has been resolved by our superadmin team.</p>
                
                <div style="background-color: #f0fdf4; border-radius: 8px; padding: 15px; margin: 20px 0; border: 1px solid #dcfce7;">
                    <p style="margin: 0 0 8px 0; color: #166534; font-weight: bold;">📝 Resolution Message:</p>
                    <p style="margin: 0; color: #1f2937; white-space: pre-wrap;">${resolutionText}</p>
                </div>

                <div style="background-color: #f8fafc; border-radius: 8px; padding: 15px; margin: 20px 0; border: 1px solid #f1f5f9; font-size: 13px; color: #4b5563;">
                    <p style="margin: 0 0 5px 0;"><strong>Original Ticket Summary:</strong></p>
                    <p style="margin: 0 0 3px 0;"><strong>Subject:</strong> ${ticket.subject}</p>
                    <p style="margin: 0;"><strong>Your Message:</strong> ${ticket.message}</p>
                </div>
                
                <p>If you have any further questions or if the issue persists, please feel free to submit a new support request.</p>
                <p style="color: #64748b; font-size: 12px; border-top: 1px solid #f1f5f9; padding-top: 15px; margin-top: 25px;">This is an automated email. Please do not reply directly to this message.</p>
            </div>
        `;

        await activeTransporter.sendMail({
            from: `"Appointory Support" <${senderUser}>`,
            to: ticket.senderEmail,
            subject: `Resolved: ${ticket.subject}`,
            html: html
        });
        console.log(`✅ Support resolution email sent to ${ticket.senderEmail} for ticket: ${ticket.subject}`);
    } catch (err) {
        console.error('Error sending support resolution email:', err.message);
        throw err;
    }
};

const sendStaffCredentials = async (email, password, name, role, clinicName) => {
    try {
        // Validate inputs
        if (!email || !password || !name || !role || !clinicName) {
            throw new Error('Missing required fields: email, password, name, role, clinicName');
        }

        const { activeTransporter, senderUser } = await getTransporterAndSender();

        // Check if transporter is initialized
        if (!activeTransporter) {
            throw new Error('Email service is not initialized. Check SMTP configuration.');
        }

        // ✅ Parse FRONTEND_URL which may contain multiple URLs separated by commas
        const frontendUrlList = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:5173';
        const frontendUrl = frontendUrlList.replace(/\/$/, '');

        // Theme Colors (from Tailwind theme)
        const THEME = {
            parchment: '#EEF6FA',    // Light background
            teak: '#0F766E',         // Dark primary
            khaki: '#3FA28C',        // Secondary accent
            marigold: '#1F6FB2',     // Primary CTA (was orange)
            saffron: '#1A4F8A',      // Dark accent
            sandstone: '#AFC4D8',    // Borders & secondary text
        };

        const mailOptions = {
            from: `"Appointory Support" <${senderUser}>`,
            to: email,
            subject: `🎉 Welcome to ${clinicName} - Your Staff Account is Ready`,
            html: `
                <div style="font-family: 'Montserrat', 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
                    <!-- Header Banner -->
                    <div style="background: linear-gradient(135deg, ${THEME.teak} 0%, ${THEME.saffron} 100%); padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0;">
                        <h1 style="font-family: 'Asimovian', 'Montserrat', sans-serif; color: ${THEME.marigold}; margin: 0; font-size: 28px;">🎉 Welcome, Dr. ${name}!</h1>
                    </div>

                    <!-- Main Content -->
                    <div style="background-color: ${THEME.parchment}; padding: 30px 20px; border: 1px solid ${THEME.sandstone}; border-top: none;">
                        
                        <!-- Welcome Message -->
                        <p style="color: #333; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
                            You have been successfully registered as a <strong style="color: ${THEME.marigold};">${role}</strong> at <strong>${clinicName}</strong>.
                        </p>

                        <!-- Credentials Box -->
                        <div style="background: linear-gradient(135deg, ${THEME.marigold}12 0%, ${THEME.sandstone}18 100%); border: 2px solid ${THEME.sandstone}; border-left: 4px solid ${THEME.marigold}; border-radius: 8px; padding: 20px; margin: 25px 0;">
                            <p style="color: ${THEME.teak}; font-weight: bold; margin: 0 0 15px 0; font-size: 14px;">📋 Your Login Credentials</p>
                            
                            <div style="background-color: white; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                                <p style="color: ${THEME.sandstone}; font-size: 12px; margin: 0 0 4px 0;">Email Address:</p>
                                <p style="color: ${THEME.teak}; font-weight: bold; font-size: 14px; margin: 0; word-break: break-all;">
                                    ${email}
                                </p>
                            </div>

                            <div style="background-color: white; padding: 12px; border-radius: 6px;">
                                <p style="color: ${THEME.sandstone}; font-size: 12px; margin: 0 0 4px 0;">Temporary Password:</p>
                                <p style="color: ${THEME.teak}; font-weight: bold; font-size: 14px; margin: 0; font-family: 'Courier New', monospace; letter-spacing: 1px;">
                                    ${password}
                                </p>
                            </div>
                        </div>

                        <!-- Login Button -->
                        <div style="text-align: center; margin: 25px 0;">
                            <a href="${frontendUrl}/login" 
                               style="background-color: ${THEME.marigold}; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(31, 111, 178, 0.3); transition: all 0.3s ease;">
                                Login to Your Dashboard
                            </a>
                        </div>

                        <!-- Security Instructions -->
                        <div style="background-color: ${THEME.parchment}; border: 2px solid ${THEME.khaki}; border-radius: 6px; padding: 12px 15px; margin: 20px 0;">
                            <p style="color: ${THEME.khaki}; font-size: 13px; margin: 0; line-height: 1.5;">
                                <strong>🔒 First Steps:</strong> After logging in, please change your password immediately from the user settings for security.
                            </p>
                        </div>

                        <!-- Important Notes -->
                        <div style="background-color: rgba(31, 111, 178, 0.05); border-radius: 6px; padding: 15px; margin: 20px 0; border-left: 4px solid ${THEME.marigold};">
                            <p style="color: ${THEME.teak}; font-size: 13px; margin: 0 0 10px 0; font-weight: bold;">📌 Important Information:</p>
                            <ul style="color: #333; font-size: 12px; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li>Keep your credentials confidential</li>
                                <li>Change your password after first login</li>
                                <li>Contact your clinic admin if you have issues</li>
                                <li>Check your email for clinic-specific guidelines</li>
                            </ul>
                        </div>

                        <!-- What's Next -->
                        <div style="background-color: rgba(31, 111, 178, 0.05); border-radius: 6px; padding: 15px; margin: 20px 0; border-left: 4px solid ${THEME.khaki};">
                            <p style="color: ${THEME.teak}; font-size: 13px; font-weight: bold; margin: 0 0 10px 0;">🚀 What's Next?</p>
                            <ol style="color: #333; font-size: 12px; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li>Log in with your credentials above</li>
                                <li>Complete your profile setup</li>
                                <li>Update security settings</li>
                                <li>Start managing your clinic activities</li>
                            </ol>
                        </div>

                    </div>

                    <!-- Footer -->
                    <div style="background: linear-gradient(135deg, ${THEME.teak} 0%, ${THEME.saffron} 100%); color: ${THEME.parchment}; padding: 20px; text-align: center; border-radius: 0 0 12px 12px; font-size: 12px;">
                        <p style="margin: 0 0 5px 0;">
                            <strong>Appointory</strong> - Healthcare Management System
                        </p>
                        <p style="margin: 0; color: ${THEME.sandstone};">
                            Clinic: ${clinicName}
                        </p>
                    </div>

                </div>
            `,
        };

        await activeTransporter.sendMail(mailOptions);
        console.log(`✅ Staff credentials email sent successfully to ${email}`);
    } catch (error) {
        console.error(`❌ Error sending staff credentials email to ${email}:`, error.message);
        throw new Error(`Failed to send staff credentials email: ${error.message}`);
    }
};

/**
 * Generic email sender for password reset and other notifications
 * @param {string} email - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @throws {Error} If email sending fails
 */
const sendEmail = async (email, subject, html, attachments = []) => {
    try {
        // Validate inputs
        if (!email || !subject || !html) {
            throw new Error('Missing required fields: email, subject, html');
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Error(`Invalid email format: ${email}`);
        }

        const { activeTransporter, senderUser } = await getTransporterAndSender();

        // Check if transporter is initialized
        if (!activeTransporter) {
            console.error('❌ Email service is not initialized');
            throw new Error('Email service is not initialized. Check SMTP configuration.');
        }

        const mailOptions = {
            from: `"Appointory Support" <${senderUser}>`,
            to: email,
            subject: subject,
            html: html,
            attachments: attachments
        };

        console.log(`📧 Attempting to send email to: ${email}`);
        console.log(`   Subject: ${subject}`);

        await activeTransporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to ${email} - Subject: ${subject}`);
    } catch (error) {
        console.error(`❌ Error sending email to ${email}:`, error.message);
        console.error(`   Error Code: ${error.code}`);
        console.error(`   Error Response: ${error.response}`);

        // Log specific Gmail error codes
        if (error.code === 'EAUTH') {
            console.error('⚠️  AUTHENTICATION ERROR: SMTP credentials are invalid or expired');
        } else if (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH') {
            console.error('⚠️  CONNECTION ERROR: Unable to connect to SMTP server');
        }

        throw new Error(`Failed to send email: ${error.message}`);
    }
};

/**
 * Send registration pending acknowledgment email to facility admin and alert email to superadmin
 */
const sendRegistrationPendingEmails = async ({ facilityName, facilityType, facilityCode, contactEmail, contactPhone, address, adminName }) => {
    try {
        const { activeTransporter, senderUser } = await getTransporterAndSender();
        if (!activeTransporter) return;

        const SystemConfig = require('../models/SystemConfig');
        const config = await SystemConfig.findOne();
        const superadminEmail = config?.superadminEmail || 'appointory@gmail.com';

        const frontendUrlList = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:5173';
        const frontendUrl = frontendUrlList.replace(/\/$/, '');

        const facilityHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #0F766E 0%, #1F6FB2 100%); padding: 25px 20px; text-align: center; color: white;">
                    <h2 style="margin: 0; font-size: 24px;">⌛ Registration Under Review</h2>
                    <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Appointory ${facilityType.toUpperCase()} Onboarding</p>
                </div>
                <div style="padding: 25px; color: #334155; line-height: 1.6;">
                    <p>Dear <strong>${adminName || facilityName}</strong>,</p>
                    <p>Thank you for registering <strong>${facilityName}</strong> on the Appointory Healthcare Platform.</p>

                    <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 16px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin: 0 0 6px 0; color: #c2410c; font-size: 14px; font-weight: bold;">
                            🔒 Account Status: Pending Approval Required
                        </h4>
                        <p style="margin: 0; color: #7c2d12; font-size: 13px; line-height: 1.5;">
                            Your registration request has been submitted successfully. <strong>Please note: You will only be able to log in and access your dashboard AFTER your account is reviewed and approved by the Super Admin team.</strong>
                        </p>
                    </div>

                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin: 0 0 8px 0; color: #0F766E; font-size: 14px;">📋 Request Summary</h4>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Facility Name:</strong> ${facilityName}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Facility Type:</strong> ${facilityType.toUpperCase()}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Facility Code:</strong> ${facilityCode}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Contact Email:</strong> ${contactEmail}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Contact Phone:</strong> ${contactPhone || 'N/A'}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Address:</strong> ${address || 'N/A'}</p>
                    </div>

                    <p style="font-size: 13px; color: #475569;">
                        Once the Super Admin verifies and approves your registration, you will receive an official approval confirmation email and your account login credentials will be activated immediately.
                    </p>
                    <div style="text-align: center; margin-top: 25px;">
                        <a href="${frontendUrl}/login" style="background-color: #0F766E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                            Check Status on Appointory
                        </a>
                    </div>
                </div>
                <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0;">Appointory Healthcare Management System • Support & Compliance</p>
                </div>
            </div>
        `;

        const adminAlertHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #c2410c 0%, #ea580c 100%); padding: 25px 20px; text-align: center; color: white;">
                    <h2 style="margin: 0; font-size: 24px;">🚨 New ${facilityType.toUpperCase()} Approval Request</h2>
                    <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Action Required by Super Admin</p>
                </div>
                <div style="padding: 25px; color: #334155; line-height: 1.6;">
                    <p>Hello Super Admin,</p>
                    <p>A new <strong>${facilityType}</strong> has submitted a registration request and is awaiting your approval decision.</p>
                    <div style="background-color: #f8fafc; border-left: 4px solid #ea580c; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <h4 style="margin: 0 0 8px 0; color: #c2410c; font-size: 14px;">🏢 Registration Details</h4>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Facility Name:</strong> ${facilityName}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Type:</strong> ${facilityType.toUpperCase()}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Code:</strong> ${facilityCode}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Contact Person:</strong> ${adminName || 'Admin'}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Email:</strong> ${contactEmail}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Phone:</strong> ${contactPhone || 'N/A'}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Address:</strong> ${address || 'N/A'}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    <p style="font-size: 13px;">Log into your Super Admin Panel to inspect full details and approve or reject this request.</p>
                    <div style="text-align: center; margin-top: 25px;">
                        <a href="${frontendUrl}/login" style="background-color: #ea580c; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                            Go to Super Admin Panel
                        </a>
                    </div>
                </div>
            </div>
        `;

        // Send confirmation to facility admin if valid email
        if (contactEmail && !isDummyEmail(contactEmail)) {
            await activeTransporter.sendMail({
                from: `"Appointory Onboarding" <${senderUser}>`,
                to: contactEmail,
                subject: `⌛ Registration Received: ${facilityName} (${facilityCode}) — Pending Super Admin Approval`,
                html: facilityHtml
            });
            console.log(`✅ Registration pending email sent to registrant: ${contactEmail}`);
        }

        // Send notification alert email to super admin (appointory@gmail.com)
        const finalAdminEmail = superadminEmail || 'appointory@gmail.com';
        if (finalAdminEmail && !isDummyEmail(finalAdminEmail)) {
            await activeTransporter.sendMail({
                from: `"Appointory System Alerts" <${senderUser}>`,
                to: finalAdminEmail,
                subject: `🚨 Super Admin Action Required: New ${facilityType.toUpperCase()} Approval Request - ${facilityName}`,
                html: adminAlertHtml
            });
            console.log(`✅ Registration alert email sent to Super Admin: ${finalAdminEmail}`);
        }
    } catch (err) {
        console.error('Error sending registration pending emails:', err.message);
    }
};

/**
 * Send approval or rejection decision email to facility admin
 */
const sendApprovalDecisionEmail = async ({ facilityName, facilityType, facilityCode, contactEmail, status, reason }) => {
    try {
        const { activeTransporter, senderUser } = await getTransporterAndSender();
        if (!activeTransporter || !contactEmail) return;

        const frontendUrlList = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:5173';
        const frontendUrl = frontendUrlList.replace(/\/$/, '');

        const isApproved = status === 'approved';

        const html = isApproved ? `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #10b981 0%, #047857 100%); padding: 25px 20px; text-align: center; color: white;">
                    <h2 style="margin: 0; font-size: 24px;">🎉 Account Approved!</h2>
                    <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Appointory ${facilityType.toUpperCase()} Network</p>
                </div>
                <div style="padding: 25px; color: #334155; line-height: 1.6;">
                    <p>Hello <strong>${facilityName}</strong> Administrator,</p>
                    <p>We are excited to inform you that your registration request for <strong>${facilityName}</strong> (${facilityCode}) has been <strong>APPROVED</strong> by the Super Admin team!</p>
                    <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <h4 style="margin: 0 0 8px 0; color: #047857; font-size: 14px;">✅ Account Activated</h4>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Facility Code:</strong> ${facilityCode}</p>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Status:</strong> Active & Live</p>
                        <p style="margin: 3px 0; font-size: 13px;">You can now log into your dashboard using your registered credentials.</p>
                    </div>
                    <div style="text-align: center; margin-top: 25px;">
                        <a href="${frontendUrl}/login" style="background-color: #10b981; color: white; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
                            Log In To Dashboard
                        </a>
                    </div>
                </div>
            </div>
        ` : `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); padding: 25px 20px; text-align: center; color: white;">
                    <h2 style="margin: 0; font-size: 24px;">Registration Request Update</h2>
                    <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.9;">Appointory Support Notice</p>
                </div>
                <div style="padding: 25px; color: #334155; line-height: 1.6;">
                    <p>Hello <strong>${facilityName}</strong> Administrator,</p>
                    <p>We are writing to update you regarding your registration request for <strong>${facilityName}</strong>.</p>
                    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; border-radius: 6px; margin: 20px 0;">
                        <h4 style="margin: 0 0 8px 0; color: #b91c1c; font-size: 14px;">❌ Request Not Approved</h4>
                        <p style="margin: 3px 0; font-size: 13px;"><strong>Reason:</strong> ${reason || 'Application did not meet operational criteria.'}</p>
                    </div>
                    <p style="font-size: 13px;">If you believe this decision was made in error or if you wish to provide updated documentation, please contact our support team.</p>
                </div>
            </div>
        `;

        await activeTransporter.sendMail({
            from: `"Appointory Support" <${senderUser}>`,
            to: contactEmail,
            subject: isApproved ? `🎉 Approved: ${facilityName} is now active!` : `Update regarding your ${facilityType} registration`,
            html
        });
        console.log(`✅ Approval decision email (${status}) sent to ${contactEmail}`);
    } catch (err) {
        console.error('Error sending approval decision email:', err.message);
    }
};

module.exports = {
    sendEmail,
    sendStaffCredentials,
    initializeEmailService,
    sendSupportConfirmationEmail,
    sendResolutionEmail,
    sendRegistrationPendingEmails,
    sendApprovalDecisionEmail,
    isEmailServiceReady: () => emailServiceReady
};
