const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const generateToken = (user) => {
    // 🔑 Flexible Payload: Use _id (staff) OR id (patient)
    // Also include phone and tokenVersion (for immediate session revocation on password reset)
    return jwt.sign(
        { 
            id: user._id || user.id, 
            role: user.role, 
            clinicId: user.clinicId || null,
            phone: user.phone || null,
            tokenVersion: user.tokenVersion || 0
        }, 
        process.env.JWT_SECRET, 
        { expiresIn: '24h', algorithm: 'HS256' }
    );
};

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(12);
    return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};

module.exports = { generateToken, hashPassword, comparePassword };