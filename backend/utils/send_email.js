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
    console.log('⚠️  Email service disabled: EMAIL_USER and EMAIL_PASS not configured');
}

const sendStaffCredentials = async (email, password, name, role, clinicName) => {
    try {
        // Validate inputs
        if (!email || !password || !name || !role || !clinicName) {
            throw new Error('Missing required fields: email, password, name, role, clinicName');
        }

        // Check if transporter is initialized
        if (!transporter) {
            throw new Error('Email service is not initialized. Check EMAIL_USER and EMAIL_PASS configuration.');
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
            from: `"Appointory Support" <${process.env.EMAIL_USER}>`,
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

        await transporter.sendMail(mailOptions);
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
const sendEmail = async (email, subject, html) => {
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

        // Check if transporter is initialized
        if (!transporter) {
            console.error('❌ Email service is not initialized');
            console.error(`   EMAIL_USER configured: ${!!process.env.EMAIL_USER}`);
            console.error(`   EMAIL_PASS configured: ${!!process.env.EMAIL_PASS}`);
            console.error(`   Email service ready: ${emailServiceReady}`);

            // If credentials are set but service isn't ready, it's likely still initializing
            if (process.env.EMAIL_USER && process.env.EMAIL_PASS && !emailServiceReady) {
                console.error('   ⏳ Email service is still initializing... Please try again in a moment');
                throw new Error('Email service is initializing. Please try again in a few seconds.');
            }

            throw new Error('Email service is not initialized. Check EMAIL_USER and EMAIL_PASS configuration.');
        }

        const mailOptions = {
            from: `"Appointory Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: subject,
            html: html
        };

        console.log(`📧 Attempting to send email to: ${email}`);
        console.log(`   Subject: ${subject}`);

        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to ${email} - Subject: ${subject}`);
    } catch (error) {
        console.error(`❌ Error sending email to ${email}:`, error.message);
        console.error(`   Error Code: ${error.code}`);
        console.error(`   Error Response: ${error.response}`);

        // Log specific Gmail error codes
        if (error.code === 'EAUTH') {
            console.error('⚠️  AUTHENTICATION ERROR: Gmail credentials are invalid or expired');
            console.error('   Solution: Generate a new Gmail App Password at https://myaccount.google.com/apppasswords');
        } else if (error.code === 'ETIMEDOUT' || error.code === 'EHOSTUNREACH') {
            console.error('⚠️  CONNECTION ERROR: Unable to connect to Gmail SMTP server');
            console.error('   Solution: Check your internet connection and firewall settings');
        }

        throw new Error(`Failed to send email: ${error.message}`);
    }
};

module.exports = {
    sendEmail,
    sendStaffCredentials,
    initializeEmailService,
    isEmailServiceReady: () => emailServiceReady
};