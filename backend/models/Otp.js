const mongoose = require('../config/mongoose_connection');

const otpSchema = mongoose.Schema({
  identifier: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true
  },
  otp: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['patient_phone', 'clinic_registration', 'lab_registration', 'password_reset'],
    default: 'patient_phone',
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // MongoDB TTL index to auto-delete documents upon expiry
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Composite index for fast identifier + type lookup
otpSchema.index({ identifier: 1, type: 1 });

module.exports = mongoose.model('Otp', otpSchema);
