const mongoose = require('../config/mongoose_connection');

const clinicSchema = mongoose.Schema({
  name: { type: String, required: true },
  clinicCode: { type: String, required: true, unique: true, uppercase: true },
  address: { type: String, required: true },
  contactPhone: { type: String, required: true },
  openingTime: { type: String, default: '09:00' },
  closingTime: { type: String, default: '17:00' },
  breakStartTime: { type: String, default: '12:00' },
  breakEndTime: { type: String, default: '14:00' },
  slotDurationMinutes: { type: Number, default: 30, min: 10, max: 120 },
  workingDays: {
    type: [String],
    default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Clinic', clinicSchema);