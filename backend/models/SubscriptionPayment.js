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
    billingDate: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
