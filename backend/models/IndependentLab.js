const mongoose = require('../config/mongoose_connection');

/**
 * IndependentLab — A standalone diagnostic lab that is NOT tied to any clinic.
 * These labs register independently and can receive test requests from multiple connected clinics.
 */
const independentLabSchema = mongoose.Schema({
    labName: { type: String, required: true, trim: true },
    labCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    logo: { type: String, default: '' },
    isActive: { type: Boolean, default: true },

    // Password Reset
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('IndependentLab', independentLabSchema);
