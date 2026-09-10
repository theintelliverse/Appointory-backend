const mongoose = require('../config/mongoose_connection');

const SERVICE_TYPES = ['full', 'billing', 'messaging', 'appointments', 'lab-connect', 'analytics', 'health-locker', 'bundle'];

const subscriptionPlanSchema = mongoose.Schema({
  name: { type: String, required: true, trim: true },
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  price: { type: Number, required: true },
  durationDays: { type: Number, required: true },
  facilityType: { type: String, enum: ['clinic', 'lab', 'both'], required: true },
  features: { type: [String], default: [] },

  // Modular Service Plan Type
  serviceType: {
    type: String,
    enum: SERVICE_TYPES,
    default: 'full'
  },
  // For 'bundle' serviceType — which services are included
  includedServices: {
    type: [String],
    default: [],
    validate: {
      validator: function(arr) {
        const validServices = ['billing', 'messaging', 'appointments', 'lab-connect', 'analytics', 'health-locker'];
        return arr.every(s => validServices.includes(s));
      },
      message: 'Invalid service in includedServices'
    }
  },

  trafficLimits: {
    maxStaff: { type: Number, default: 0 }, // 0 = unlimited
    maxPatients: { type: Number, default: 0 }, // 0 = unlimited
    maxQueues: { type: Number, default: 0 } // 0 = unlimited
  },
  isCustomPlan: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
