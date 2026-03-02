const User = require('../models/User');
const Clinic = require('../models/Clinic');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth_helper');

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