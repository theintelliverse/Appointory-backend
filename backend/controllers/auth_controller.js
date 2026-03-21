const User = require('../models/User');
const Clinic = require('../models/Clinic');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth_helper');
const { sendEmail } = require('../utils/send_email');

/**
 * @desc    Register a new Clinic and its primary Admin
 * @route   POST /api/auth/register-clinic
 */
exports.registerClinic = async (req, res) => {
    try {
        const { clinicName, clinicCode, address, contactPhone, adminName, email, password } = req.body;

        const newClinic = await Clinic.create({
            name: clinicName,
            clinicCode: clinicCode.toUpperCase(),
            address,
            contactPhone
        });

        const hashedPassword = await hashPassword(password);
        const adminUser = await User.create({
            clinicId: newClinic._id,
            name: adminName,
            email,
            password: hashedPassword,
            role: 'admin'
        });

        // 📢 No specific socket room yet as they aren't logged in, 
        // but we could notify a global "Super Admin" if one existed.

        res.status(201).json({
            success: true,
            message: "Clinic and Admin registered successfully",
            clinicCode: newClinic.clinicCode
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Staff Login
 */
exports.loginStaff = async (req, res) => {
    try {
        const { clinicCode, email, password } = req.body;

        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) return res.status(404).json({ message: "Clinic not found" });

        const user = await User.findOne({ email, clinicId: clinic._id });
        if (!user) return res.status(401).json({ message: "Invalid credentials" });

        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

        const token = generateToken(user);

        res.status(200).json({
            success: true,
            token,
            user: {
                name: user.name,
                role: user.role,
                clinicName: clinic.name,
                clinicId: clinic._id
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get current logged-in user profile
 */
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) return res.status(404).json({ message: "User not found" });

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update staff/admin profile details
 * @route   PATCH /api/auth/update-profile
 */
exports.updateProfile = async (req, res) => {
    try {
        const { name, bio, education, experience, phoneNumber, profileImage } = req.body;

        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            { name, bio, education, experience, phoneNumber, profileImage },
            { new: true, runValidators: true }
        ).select('-password');

        if (!updatedUser) return res.status(404).json({ message: "User not found" });

        // 📢 SOCKET UPDATE: Notify the clinic room that a staff member's profile has changed
        // This keeps the Admin's "Staff Management" list and the "TV Selection" screen in sync.
        if (req.io) {
            req.io.to(updatedUser.clinicId.toString()).emit('staffProfileUpdated', {
                staffId: updatedUser._id,
                updatedName: updatedUser.name
            });
        }

        res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            data: updatedUser
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Request password reset for staff (Email-based)
 * @route   POST /api/auth/forgot-password
 **/
exports.forgotPassword = async (req, res) => {
    try {
        const { email, clinicCode } = req.body;

        if (!email || !clinicCode) {
            return res.status(400).json({ success: false, message: "Email and clinic code are required" });
        }

        // Find clinic
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });

        // Find user
        const user = await User.findOne({ email, clinicId: clinic._id });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Generate reset token
        const resetToken = require('crypto').randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour expiry

        user.resetToken = resetToken;
        user.resetTokenExpiry = resetTokenExpiry;
        await user.save();

        // Send email with reset link
        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&email=${email}&clinicCode=${clinicCode}`;

        try {
            await sendEmail(
                email,
                'Password Reset Request - SwasthyaMitra',
                `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2 style="color: #422D0B;">Password Reset Request</h2>
                    <p>You requested a password reset for your SwasthyaMitra account.</p>
                    <p>Click the link below to reset your password (valid for 1 hour):</p>
                    <a href="${resetLink}" 
                       style="background-color: #FFA800; color: white; padding: 12px 25px; text-decoration: none; border-radius: 10px; display: inline-block;">
                       Reset Password
                    </a>
                    <p style="margin-top: 20px; font-size: 12px; color: #967A53;">
                        If you didn't request this, ignore this email.
                    </p>
                </div>
                `
            );
        } catch (emailErr) {
            console.error('Email Error:', emailErr);
            return res.status(500).json({ success: false, message: "Failed to send reset email" });
        }

        res.status(200).json({
            success: true,
            message: "Password reset link sent to your email"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Reset password for staff (Token-based)
 * @route   POST /api/auth/reset-password
 */
exports.resetPassword = async (req, res) => {
    try {
        const { email, token, newPassword, clinicCode } = req.body;

        if (!email || !token || !newPassword || !clinicCode) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        // Find clinic
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) return res.status(404).json({ success: false, message: "Clinic not found" });

        // Find user
        const user = await User.findOne({ email, clinicId: clinic._id });
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Verify token
        if (user.resetToken !== token || !user.resetTokenExpiry || user.resetTokenExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
        }

        // Update password
        const { hashPassword } = require('../utils/auth_helper');
        user.password = await hashPassword(newPassword);
        user.resetToken = null;
        user.resetTokenExpiry = null;
        await user.save();

        res.status(200).json({
            success: true,
            message: "Password reset successfully. Please login with your new password."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};