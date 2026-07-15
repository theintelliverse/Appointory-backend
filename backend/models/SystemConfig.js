const mongoose = require('../config/mongoose_connection');

const systemConfigSchema = mongoose.Schema({
    isMaintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: 'System is undergoing scheduled maintenance.' },
    isSubscriptionEnforced: { type: Boolean, default: false },
    trialPeriodDays: { type: Number, default: 30 },
    legacyDiscountPercentage: { type: Number, default: 20 },
    legacyDiscountThresholdDays: { type: Number, default: 30 },
    legacyCutoffDate: { type: Date, default: null },
    legacyDiscountStartDate: { type: Date, default: null },
    legacyDiscountEndDate: { type: Date, default: null },
    legacyDiscountLabel: { type: String, default: 'Legacy User Discount' },
    taxRatePercentage: { type: Number, default: 18 },
    isGstEnabled: { type: Boolean, default: false },
    gstNumber: { type: String, default: '' },
    cgstRatePercentage: { type: Number, default: 9 },
    sgstRatePercentage: { type: Number, default: 9 },
    igstRatePercentage: { type: Number, default: 18 },
    gstState: { type: String, default: 'India' },
    gstStateCode: { type: String, default: 'GST' },
    smtpHost: { type: String, default: '' },
    smtpPort: { type: Number, default: 587 },
    smtpUser: { type: String, default: '' },
    smtpPass: { type: String, default: '' },
    smtpSecure: { type: Boolean, default: false },
    superadminEmail: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
