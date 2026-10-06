const crypto = require('crypto');
const Otp = require('../models/Otp');

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 * Uses crypto.randomInt (CSPRNG) instead of Math.random().
 */
const generateSecureOtp = () => {
    return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Computes a SHA-256 hash of an OTP string.
 */
const hashOtp = (otp) => {
    return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
};

/**
 * Stores a hashed OTP in MongoDB with expiry and attempt tracking.
 */
const storeSecureOtp = async ({ identifier, type, otp, expiryMinutes = 5 }) => {
    const cleanId = String(identifier).trim().toLowerCase();
    const hashed = hashOtp(otp);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    return await Otp.findOneAndUpdate(
        { identifier: cleanId, type },
        {
            otp: hashed,
            attempts: 0,
            maxAttempts: 5,
            expiresAt
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

/**
 * Timing-safe OTP verification with attempt tracking and single-use consumption.
 * Supports legacy unhashed OTPs during migration, but persists new ones hashed.
 *
 * @returns {Promise<{ valid: boolean, message?: string }>}
 */
const verifyAndConsumeOtp = async ({ identifier, type, otp, consume = true }) => {
    if (!otp) {
        return { valid: false, message: 'OTP is required' };
    }

    const cleanId = String(identifier).trim().toLowerCase();
    const query = typeof type === 'string'
        ? { identifier: cleanId, type }
        : { identifier: cleanId, type: { $in: type } };

    const record = await Otp.findOne(query);

    if (!record) {
        return { valid: false, message: 'Invalid or expired OTP. Please request a new code.' };
    }

    // Check expiry
    if (record.expiresAt < new Date()) {
        await Otp.deleteOne({ _id: record._id }).catch(() => {});
        return { valid: false, message: 'OTP has expired. Please request a new code.' };
    }

    // Check attempts limit (Max 5 attempts)
    if (record.attempts >= (record.maxAttempts || 5)) {
        await Otp.deleteOne({ _id: record._id }).catch(() => {});
        return { valid: false, message: 'Too many failed verification attempts. This OTP has been invalidated.' };
    }

    const providedHash = hashOtp(otp);
    const stored = record.otp;

    let isMatch = false;
    // Check hashed match
    if (stored.length === 64) {
        // SHA-256 hex string
        try {
            const bufA = Buffer.from(providedHash, 'hex');
            const bufB = Buffer.from(stored, 'hex');
            if (bufA.length === bufB.length) {
                isMatch = crypto.timingSafeEqual(bufA, bufB);
            }
        } catch (_) {
            isMatch = false;
        }
    } else {
        // Legacy plaintext fallback
        try {
            const bufA = Buffer.from(String(otp));
            const bufB = Buffer.from(String(stored));
            if (bufA.length === bufB.length) {
                isMatch = crypto.timingSafeEqual(bufA, bufB);
            }
        } catch (_) {
            isMatch = false;
        }
    }

    if (!isMatch) {
        record.attempts = (record.attempts || 0) + 1;
        const remaining = Math.max(0, (record.maxAttempts || 5) - record.attempts);
        if (remaining <= 0) {
            await Otp.deleteOne({ _id: record._id }).catch(() => {});
            return { valid: false, message: 'Too many failed verification attempts. This OTP has been invalidated.' };
        }
        await record.save();
        return { valid: false, message: `Invalid OTP. ${remaining} attempt(s) remaining.` };
    }

    // Success: consume if required
    if (consume) {
        await Otp.deleteOne({ _id: record._id }).catch(() => {});
    }

    return { valid: true };
};

module.exports = {
    generateSecureOtp,
    hashOtp,
    storeSecureOtp,
    verifyAndConsumeOtp
};
