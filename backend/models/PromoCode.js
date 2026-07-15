const mongoose = require('../config/mongoose_connection');

const promoCodeSchema = mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true },
    discountPercentage: { type: Number, required: true, min: 0, max: 100 },
    expiryDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('PromoCode', promoCodeSchema);
