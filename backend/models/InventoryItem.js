const mongoose = require('../config/mongoose_connection');

const inventoryItemSchema = mongoose.Schema({
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  name: { type: String, required: true },
  stock: { type: Number, default: 0 },
  minStock: { type: Number, default: 0 },
  unitPrice: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
