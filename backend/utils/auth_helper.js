const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const generateToken = (user) => {
    // 🔑 Flexible Payload: Use _id (staff) OR id (patient)
    // Also include phone if it exists (for patients)
    return jwt.sign(
        { 
            id: user._id || user.id, 
            role: user.role, 
            clinicId: user.clinicId || null,
            phone: user.phone || null
        }, 
        process.env.JWT_SECRET, 
        { expiresIn: '24h' }
    );
};

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};

module.exports = { generateToken, hashPassword, comparePassword };