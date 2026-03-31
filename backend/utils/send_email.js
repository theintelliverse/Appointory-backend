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
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
};

let transporter = null;

// Initialize transporter safely
try {
    if (validateEmailConfig()) {
        transporter = createTransporter();
    }
} catch (error) {
    console.error('⚠️  EMAIL SERVICE INITIALIZATION WARNING:', error.message);
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

        const mailOptions = {
            from: `"Appointory Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `🎉 Welcome to ${clinicName} - Your Staff Account is Ready`,
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
                    <!-- Header Banner -->
                    <div style="background: linear-gradient(135deg, #422D0B 0%, #563D1A 100%); padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0;">
                        <h1 style="color: #FFA800; margin: 0; font-size: 28px;">🎉 Welcome, Dr. ${name}!</h1>
                    </div>

                    <!-- Main Content -->
                    <div style="background-color: #FFFBF5; padding: 30px 20px; border: 1px solid #E8DDCB; border-top: none;">
                        
                        <!-- Welcome Message -->
                        <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
                            You have been successfully registered as a <strong style="color: #FFA800;">${role}</strong> at <strong>${clinicName}</strong>.
                        </p>

                        <!-- Credentials Box -->
                        <div style="background: linear-gradient(135deg, #FFA80010 0%, #E8DDCB10 100%); border: 2px solid #E8DDCB; border-left: 4px solid #FFA800; border-radius: 8px; padding: 20px; margin: 25px 0;">
                            <p style="color: #422D0B; font-weight: bold; margin: 0 0 15px 0; font-size: 14px;">📋 Your Login Credentials</p>
                            
                            <div style="background-color: white; padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                                <p style="color: #666; font-size: 12px; margin: 0 0 4px 0;">Email Address:</p>
                                <p style="color: #422D0B; font-weight: bold; font-size: 14px; margin: 0; word-break: break-all;">
                                    ${email}
                                </p>
                            </div>

                            <div style="background-color: white; padding: 12px; border-radius: 6px;">
                                <p style="color: #666; font-size: 12px; margin: 0 0 4px 0;">Temporary Password:</p>
                                <p style="color: #422D0B; font-weight: bold; font-size: 14px; margin: 0; font-family: 'Courier New', monospace; letter-spacing: 1px;">
                                    ${password}
                                </p>
                            </div>
                        </div>

                        <!-- Login Button -->
                        <div style="text-align: center; margin: 25px 0;">
                            <a href="${frontendUrl}/login" 
                               style="background-color: #FFA800; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(255, 168, 0, 0.3); transition: all 0.3s ease;">
                               Login to Your Dashboard
                            </a>
                        </div>

                        <!-- Security Instructions -->
                        <div style="background-color: #FFE8B3; border: 1px solid #FFD580; border-radius: 6px; padding: 12px 15px; margin: 20px 0;">
                            <p style="color: #9C6D00; font-size: 13px; margin: 0; line-height: 1.5;">
                                <strong>🔒 First Steps:</strong> After logging in, please change your password immediately from the user settings for security.
                            </p>
                        </div>

                        <!-- Important Notes -->
                        <div style="background-color: #F0F0F0; border-radius: 6px; padding: 15px; margin: 20px 0;">
                            <p style="color: #666; font-size: 13px; margin: 0 0 10px 0;"><strong>📌 Important Information:</strong></p>
                            <ul style="color: #555; font-size: 12px; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li>Keep your credentials confidential</li>
                                <li>Change your password after first login</li>
                                <li>Contact your clinic admin if you have issues</li>
                                <li>Check your email for clinic-specific guidelines</li>
                            </ul>
                        </div>

                        <!-- What's Next -->
                        <div style="background-color: #F5F5F5; border-radius: 6px; padding: 15px; margin: 20px 0;">
                            <p style="color: #422D0B; font-size: 13px; font-weight: bold; margin: 0 0 10px 0;">🚀 What's Next?</p>
                            <ol style="color: #555; font-size: 12px; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li>Log in with your credentials above</li>
                                <li>Complete your profile setup</li>
                                <li>Update security settings</li>
                                <li>Start managing your clinic activities</li>
                            </ol>
                        </div>

                    </div>

                    <!-- Footer -->
                    <div style="background-color: #422D0B; color: #FFA800; padding: 20px; text-align: center; border-radius: 0 0 12px 12px; font-size: 12px;">
                        <p style="margin: 0 0 5px 0;">
                            <strong>SwasthyaMitra</strong> - Healthcare Management System
                        </p>
                        <p style="margin: 0; color: #C9A877;">
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
            throw new Error('Email service is not initialized. Check EMAIL_USER and EMAIL_PASS configuration.');
        }

        const mailOptions = {
            from: `"Appointory Support" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: subject,
            html: html
        };

        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to ${email} - Subject: ${subject}`);
    } catch (error) {
        console.error(`❌ Error sending email to ${email}:`, error.message);
        throw new Error(`Failed to send email: ${error.message}`);
    }
};

module.exports = {
    sendEmail,
    sendStaffCredentials
};