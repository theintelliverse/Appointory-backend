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

        // ✅ Validate required fields
        if (!email || !clinicCode) {
            return res.status(400).json({
                success: false,
                message: "Email and clinic code are required"
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        // Find clinic
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) {
            return res.status(404).json({
                success: false,
                message: "Clinic not found"
            });
        }

        // Find user
        const user = await User.findOne({ email, clinicId: clinic._id });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found with this email in the clinic"
            });
        }

        // Generate reset token
        const resetToken = require('crypto').randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour expiry

        // Save reset token before sending email
        user.resetToken = resetToken;
        user.resetTokenExpiry = resetTokenExpiry;
        await user.save();

        // ✅ Construct reset link with proper frontend URL
        // Parse FRONTEND_URL which may contain multiple URLs separated by commas
        const frontendUrlList = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:5173';
        const frontendUrl = frontendUrlList.replace(/\/$/, '');
        const resetLink = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}&clinicCode=${clinicCode}`;

        console.log(`📧 Generating password reset link for ${email}`);
        console.log(`🔗 Reset Link: ${resetLink}`);

        // Send email with reset link
        try {
            await sendEmail(
                email,
                '🔐 Password Reset for Appointory',
                `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto;">
                    <!-- Header Banner -->
                    <div style="background: linear-gradient(135deg, #422D0B 0%, #563D1A 100%); padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0;">
                        <h1 style="color: #FFA800; margin: 0; font-size: 28px;">🔐 Password Reset</h1>
                    </div>

                    <!-- Main Content -->
                    <div style="background-color: #FFFBF5; padding: 30px 20px; border: 1px solid #E8DDCB; border-top: none;">
                        
                        <!-- Greeting -->
                        <p style="color: #422D0B; font-size: 16px; margin: 0 0 20px 0;">
                            Hello,
                        </p>

                        <!-- Message -->
                        <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 15px 0;">
                            You requested a password reset for your <strong>Appointory</strong> account at <br/>
                            <span style="background-color: #FFA80015; padding: 4px 8px; border-radius: 4px; color: #422D0B;"><b>${clinic.name}</b></span>
                        </p>

                        <!-- Action Required -->
                        <div style="background-color: white; border-left: 4px solid #FFA800; padding: 15px; border-radius: 6px; margin: 20px 0;">
                            <p style="color: #422D0B; font-weight: bold; margin: 0 0 10px 0; font-size: 15px;">⏱️ Action Required (Valid for 1 Hour Only)</p>
                            <p style="color: #666; font-size: 14px; margin: 0;">Click the button below to create a new password:</p>
                        </div>

                        <!-- Reset Button -->
                        <div style="text-align: center; margin: 25px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #FFA800; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(255, 168, 0, 0.3); transition: all 0.3s ease;">
                               Reset My Password
                            </a>
                        </div>

                        <!-- One-Time Use Warning -->
                        <div style="background-color: #FFE8B3; border: 1px solid #FFD580; border-radius: 6px; padding: 12px 15px; margin: 20px 0;">
                            <p style="color: #9C6D00; font-size: 13px; margin: 0; line-height: 1.5;">
                                <strong>⚠️ One-Time Use Link:</strong> This link can only be used once. After you reset your password, this link will automatically expire and become invalid for security reasons.
                            </p>
                        </div>

                        <!-- Manual Link Fallback -->
                        <div style="background-color: #F0F0F0; border-radius: 6px; padding: 15px; margin: 20px 0;">
                            <p style="color: #666; font-size: 13px; margin: 0 0 8px 0;"><strong>💡 Link Not Working?</strong></p>
                            <p style="color: #555; font-size: 12px; margin: 0 0 8px 0;">Copy and paste this link in your browser:</p>
                            <p style="color: #0066CC; font-size: 12px; word-break: break-all; margin: 0; padding: 8px; background-color: white; border-radius: 4px; border-left: 2px solid #0066CC;">
                                ${resetLink}
                            </p>
                        </div>

                        <!-- Security Notice -->
                        <div style="background-color: #F5F5F5; border-radius: 6px; padding: 15px; margin: 20px 0;">
                            <p style="color: #666; font-size: 13px; margin: 0; line-height: 1.6;">
                                <strong>🔒 Security Tips:</strong><br/>
                                • Never share this link with anyone<br/>
                                • Appointory staff will never ask for your password<br/>
                                • If you didn't request this, ignore this email
                            </p>
                        </div>

                        <!-- Timeline -->
                        <div style="display: flex; justify-content: space-around; margin: 25px 0; text-align: center;">
                            <div>
                                <div style="background-color: #E8DDCB; width: 50px; height: 50px; border-radius: 50%; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center;" >
                                    <span style="font-size: 24px;">✉️</span>
                                </div>
                                <p style="color: #422D0B; font-size: 12px; font-weight: bold; margin: 0;">Email Sent</p>
                            </div>
                            <div style="color: #967A53; font-size: 24px; display: flex; align-items: flex-end;">→</div>
                            <div>
                                <div style="background-color: #E8DDCB; width: 50px; height: 50px; border-radius: 50%; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center;">
                                    <span style="font-size: 24px;">⏰</span>
                                </div>
                                <p style="color: #422D0B; font-size: 12px; font-weight: bold; margin: 0;">Valid 1 Hour</p>
                            </div>
                            <div style="color: #967A53; font-size: 24px; display: flex; align-items: flex-end;">→</div>
                            <div>
                                <div style="background-color: #E8DDCB; width: 50px; height: 50px; border-radius: 50%; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center;">
                                    <span style="font-size: 24px;">🔐</span>
                                </div>
                                <p style="color: #422D0B; font-size: 12px; font-weight: bold; margin: 0;">Password Reset</p>
                            </div>
                        </div>

                    </div>

                    <!-- Footer -->
                    <div style="background-color: #422D0B; color: #FFA800; padding: 20px; text-align: center; border-radius: 0 0 12px 12px; font-size: 12px;">
                        <p style="margin: 0 0 5px 0;">
                            <strong>Appointory</strong> - Healthcare Management System
                        </p>
                        <p style="margin: 0; color: #C9A877;">
                            For support, contact your clinic administrator
                        </p>
                    </div>

                </div>
                `
            );

            console.log(`✅ Password reset email sent successfully to ${email}`);

        } catch (emailErr) {
            console.error(`❌ Failed to send password reset email to ${email}:`, emailErr.message);

            // Rollback the reset token if email fails
            user.resetToken = null;
            user.resetTokenExpiry = null;
            await user.save();

            return res.status(500).json({
                success: false,
                message: "Failed to send password reset email. Please try again later or contact support.",
                error: process.env.NODE_ENV === 'development' ? emailErr.message : undefined
            });
        }

        res.status(200).json({
            success: true,
            message: "Password reset link sent to your email. Please check your inbox and spam folder."
        });
    } catch (error) {
        console.error('❌ Forgot Password Error:', error.message);
        res.status(500).json({
            success: false,
            message: "An error occurred while processing your request",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * @desc    Reset password for staff (Token-based)
 * @route   POST /api/auth/reset-password
 */
exports.resetPassword = async (req, res) => {
    try {
        const { email, token, newPassword, clinicCode } = req.body;

        // ✅ Validate required fields
        if (!email || !token || !newPassword || !clinicCode) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        // ✅ Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        // ✅ Validate password strength
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters long"
            });
        }

        // Find clinic
        const clinic = await Clinic.findOne({ clinicCode: clinicCode.toUpperCase() });
        if (!clinic) {
            return res.status(404).json({
                success: false,
                message: "Clinic not found"
            });
        }

        // Find user
        const user = await User.findOne({ email, clinicId: clinic._id });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found with this email in the clinic"
            });
        }

        // ✅ Verify reset token and expiry
        if (!user.resetToken) {
            return res.status(400).json({
                success: false,
                message: "No password reset request found. Please request a password reset first."
            });
        }

        if (user.resetToken !== token) {
            console.warn(`⚠️  Invalid reset token attempt for user: ${email}`);
            return res.status(400).json({
                success: false,
                message: "Invalid reset token"
            });
        }

        if (!user.resetTokenExpiry || user.resetTokenExpiry < Date.now()) {
            console.warn(`⚠️  Expired reset token for user: ${email}`);
            return res.status(400).json({
                success: false,
                message: "Reset token has expired. Please request a new password reset."
            });
        }

        // ✅ Update password
        const { hashPassword } = require('../utils/auth_helper');
        const hashedPassword = await hashPassword(newPassword);
        user.password = hashedPassword;
        user.resetToken = null;
        user.resetTokenExpiry = null;
        await user.save();

        console.log(`✅ Password reset successfully for user: ${email}`);

        res.status(200).json({
            success: true,
            message: "Password reset successfully. You can now login with your new password."
        });
    } catch (error) {
        console.error('❌ Reset Password Error:', error.message);
        res.status(500).json({
            success: false,
            message: "An error occurred while resetting your password",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};