const mongoose = require('../config/mongoose_connection');

/**
 * Temporary Slot Hold Model (10-minute hold)
 * Automatically expires and cleans up after 600 seconds using MongoDB TTL Index.
 */
const slotHoldSchema = new mongoose.Schema({
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  slotDate: { type: Date, required: true },
  slotTime: { type: String, required: true },
  holdToken: { type: String, required: true, unique: true },
  ipAddress: { type: String, default: '' },
  phone: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, expires: 600 } // TTL: Automatically deletes 10 minutes after creation
});

// Enforces that only ONE active hold can exist for a given doctor slot at any time
slotHoldSchema.index({ clinicId: 1, doctorId: 1, slotDate: 1, slotTime: 1 }, { unique: true });
slotHoldSchema.index({ ipAddress: 1, createdAt: 1 });

module.exports = mongoose.model('SlotHold', slotHoldSchema);
