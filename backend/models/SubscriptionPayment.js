const mongoose = require('../config/mongoose_connection');

const subscriptionPaymentSchema = mongoose.Schema({
    facilityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'facilityModel'
    },
    facilityModel: {
        type: String,
        required: true,
        enum: ['Clinic', 'IndependentLab']
    },
    facilityType: {
        type: String,
        required: true,
        enum: ['clinic', 'lab']
    },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['created', 'captured', 'failed'], default: 'created' },
    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    plan: { type: String, required: true },
    // Modular service tracking
    serviceType: {
        type: String,
        enum: ['full', 'billing', 'messaging', 'appointments', 'lab-connect', 'analytics', 'health-locker', 'bundle'],
        default: 'full'
    },
    activatedServices: { type: [String], default: [] }, // List of services activated by this payment
    durationDays: { type: Number, default: 30 },
    billingDate: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
