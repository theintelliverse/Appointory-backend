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
  isActive: { type: Boolean, default: true },
  
  // Billing & Queue Rules Config
  feeConsult: { type: Number, default: 500 },
  feeLab: { type: Number, default: 450 },
  feeEmergency: { type: Number, default: 300 },
  feeMedicine: { type: Number, default: 120 },
  avgWaitFactor: { type: Number, default: 8 },

  // Super Admin Billing & Configuration
  isPremium: { type: Boolean, default: false },
  subscriptionPlan: { type: String, default: 'free' },
  subscriptionExpiresAt: { type: Date, default: null },
  showOnNetwork: { type: Boolean, default: true },
  customSubscriptionPrice: { type: Number },
  customTrafficLimits: {
    maxStaff: { type: Number, default: null },
    maxPatients: { type: Number, default: null },
    maxQueues: { type: Number, default: null }
  }
}, { timestamps: true });

module.exports = mongoose.model('Clinic', clinicSchema);