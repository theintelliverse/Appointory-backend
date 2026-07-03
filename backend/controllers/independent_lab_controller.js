const IndependentLab = require('../models/IndependentLab');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth_helper');
const { sendEmail } = require('../utils/send_email');
const crypto = require('crypto');

/**
 * @desc    Register a new Independent Lab
 * @route   POST /api/auth/lab/register
 */
exports.registerLab = async (req, res) => {
    try {
        const { labName, labCode, email, password, phone, address } = req.body;

        if (!labName || !labCode || !email || !password || !phone || !address) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        const existingCode = await IndependentLab.findOne({ labCode: labCode.toUpperCase() });
        if (existingCode) {
            return res.status(400).json({ success: false, message: 'Lab Code already taken. Choose a different one.' });
        }

        const existingEmail = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (existingEmail) {
            return res.status(400).json({ success: false, message: 'Email is already registered.' });
        }

        const hashedPassword = await hashPassword(password);

        const lab = await IndependentLab.create({
            labName,
            labCode: labCode.toUpperCase(),
            email: email.toLowerCase(),
            password: hashedPassword,
            phone,
            address
        });

        res.status(201).json({
            success: true,
            message: 'Lab registered successfully. You can now log in.',
            labCode: lab.labCode
        });
    } catch (error) {
        console.error('❌ Lab Register Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Independent Lab Login
 * @route   POST /api/auth/lab/login
 */
exports.loginLab = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const lab = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (!lab) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        if (!lab.isActive) {
            return res.status(403).json({ success: false, message: 'This lab account has been deactivated.' });
        }

        const isMatch = await comparePassword(password, lab.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        // Generate token with role = 'independent_lab'
        const token = generateToken({
            _id: lab._id,
            role: 'independent_lab',
            clinicId: null
        });

        res.status(200).json({
            success: true,
            token,
            lab: {
                id: lab._id,
                labName: lab.labName,
                labCode: lab.labCode,
                email: lab.email,
                phone: lab.phone,
                address: lab.address,
                logo: lab.logo
            }
        });
    } catch (error) {
        console.error('❌ Lab Login Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get current lab profile
 * @route   GET /api/auth/lab/me
 */
exports.getLabMe = async (req, res) => {
    try {
        const lab = await IndependentLab.findById(req.lab.id).select('-password -resetToken -resetTokenExpiry');
        if (!lab) return res.status(404).json({ success: false, message: 'Lab not found.' });

        res.status(200).json({ success: true, data: lab });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update lab profile
 * @route   PATCH /api/auth/lab/update-profile
 */
exports.updateLabProfile = async (req, res) => {
    try {
        const { labName, phone, address, logo } = req.body;

        const updated = await IndependentLab.findByIdAndUpdate(
            req.lab.id,
            { labName, phone, address, logo },
            { new: true, runValidators: true }
        ).select('-password -resetToken -resetTokenExpiry');

        if (!updated) return res.status(404).json({ success: false, message: 'Lab not found.' });

        res.status(200).json({ success: true, message: 'Profile updated.', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Forgot password — send reset email to lab
 * @route   POST /api/auth/lab/forgot-password
 */
exports.labForgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

        const lab = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (!lab) {
            // Don't reveal whether email exists
            return res.status(200).json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        lab.resetToken = resetToken;
        lab.resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
        await lab.save();

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
        const resetLink = `${frontendUrl}/lab/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

        await sendEmail(
            email,
            '🔐 Lab Portal — Password Reset',
            `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,#0F4C75,#1B6CA8);padding:30px 20px;text-align:center;border-radius:12px 12px 0 0;">
                    <h1 style="color:#fff;margin:0;font-size:26px;">🔬 Lab Portal Password Reset</h1>
                </div>
                <div style="background:#f8fafc;padding:30px;border:1px solid #e2e8f0;border-top:none;">
                    <p style="color:#1a365d;">Hello <strong>${lab.labName}</strong>,</p>
                    <p style="color:#4a5568;">Click below to reset your password. This link expires in 1 hour.</p>
                    <div style="text-align:center;margin:25px 0;">
                        <a href="${resetLink}" style="background:#1B6CA8;color:white;padding:14px 35px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;">Reset My Password</a>
                    </div>
                    <p style="color:#718096;font-size:13px;">If you didn't request this, ignore this email.</p>
                </div>
            </div>`
        );

        res.status(200).json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    } catch (error) {
        console.error('❌ Lab Forgot Password Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to send reset email.' });
    }
};

/**
 * @desc    Reset lab password
 * @route   POST /api/auth/lab/reset-password
 */
exports.labResetPassword = async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        }

        const lab = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (!lab || lab.resetToken !== token || !lab.resetTokenExpiry || lab.resetTokenExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
        }

        lab.password = await hashPassword(newPassword);
        lab.resetToken = null;
        lab.resetTokenExpiry = null;
        await lab.save();

        res.status(200).json({ success: true, message: 'Password reset successfully. You can now log in.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
