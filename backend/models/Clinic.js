const mongoose = require('../config/mongoose_connection');

const clinicSchema = mongoose.Schema({
  name: { type: String, required: true },
  clinicCode: { type: String, required: true, unique: true, uppercase: true },
  address: { type: String, required: true },
  contactPhone: { type: String, required: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Clinic', clinicSchema);