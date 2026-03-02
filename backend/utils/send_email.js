const nodemailer = require('nodemailer');

const sendStaffCredentials = async (email, password, name, role, clinicName) => {
    // Create transporter (Using Gmail)
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER, // Your Gmail
            pass: process.env.EMAIL_PASS, // Your App Password
        },
    });

    const mailOptions = {
        from: `"Swasthya-Mitra Support" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Welcome to ${clinicName} - Your Staff Credentials`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #E8DDCB; border-radius: 20px;">
                <h2 style="color: #422D0B;">Namaste, Dr. ${name}!</h2>
                <p>You have been registered as a <b>${role}</b> at <b>${clinicName}</b>.</p>
                <div style="background-color: #FFFBF5; padding: 15px; border-radius: 10px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><b>Login Email:</b> ${email}</p>
                    <p style="margin: 5px 0;"><b>Temporary Password:</b> ${password}</p>
                </div>
                <p>Please login to your dashboard to manage your patients.</p>
                <a href="${process.env.FRONTEND_URL}/login" 
                   style="background-color: #FFA800; color: white; padding: 12px 25px; text-decoration: none; border-radius: 10px; display: inline-block;">
                   Login to Dashboard
                </a>
                <p style="font-size: 10px; color: #967A53; margin-top: 20px;">
                    *For security, please change your password after your first login.
                </p>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};

module.exports = sendStaffCredentials;