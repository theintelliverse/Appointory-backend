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
    openingTime: { type: String, default: '08:00' },
    closingTime: { type: String, default: '20:00' },

    // Subscription & Billing Details
    isPremium: { type: Boolean, default: false },
    subscriptionPlan: { type: String, default: 'free' },
    subscriptionExpiresAt: { type: Date, default: null },
    showOnNetwork: { type: Boolean, default: true },
    customSubscriptionPrice: { type: Number },
    customTrafficLimits: {
        maxStaff: { type: Number, default: null },
        maxPatients: { type: Number, default: null },
        maxQueues: { type: Number, default: null }
    },

    // Password Reset
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },

    // 🌐 SEO & Public Profile Management
    slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    bio: { type: String, default: '' },
    availableTests: [{
        testName: { type: String, required: true },
        code: { type: String, default: '' },
        category: { type: String, default: 'General Pathology' },
        price: { type: Number, required: true },
        sampleType: { type: String, default: 'Blood' },
        fastingRequired: { type: Boolean, default: false },
        turnAroundHours: { type: Number, default: 24 }
    }],
    locationGeo: {
        lat: { type: Number, default: 28.6139 },
        lng: { type: Number, default: 77.2090 }
    },
    seoTitle: { type: String, default: '' },
    seoDescription: { type: String, default: '' },
    seoKeywords: [{ type: String }],
    socialLinks: {
        facebook: { type: String, default: '' },
        instagram: { type: String, default: '' },
        twitter: { type: String, default: '' },
        linkedin: { type: String, default: '' },
        youtube: { type: String, default: '' }
    },
    rating: {
        score: { type: Number, default: 4.9 },
        count: { type: Number, default: 28 }
    },
    accreditation: [{ type: String }],
    videoUrl: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('IndependentLab', independentLabSchema);
