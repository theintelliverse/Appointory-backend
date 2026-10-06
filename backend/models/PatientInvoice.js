const mongoose = require('../config/mongoose_connection');

const patientInvoiceSchema = mongoose.Schema({
  invoiceNumber: { 
    type: String, 
    required: true, 
    unique: true 
  },
  clinicId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Clinic', 
    required: true 
  },
  patientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Patient',
    default: null
  },
  patientName: { 
    type: String, 
    required: true 
  },
  patientPhone: { 
    type: String, 
    required: true 
  },
  doctorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  doctorName: { 
    type: String 
  },
  doctorLicenseNumber: { 
    type: String, 
    default: '' 
  },
  clinicGstin: { 
    type: String, 
    default: '' 
  },
  billingType: { 
    type: String, 
    enum: ['clinic', 'lab'], 
    default: 'clinic' 
  },
  
  // Array of items billed
  items: [{
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, default: 'Consultation' }
  }],
  
  // Financial metrics
  subtotal: { type: Number, required: true, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  verificationToken: { type: String, default: '' },
  onlinePendingDues: { type: Number, default: 0 }, // Online booking dues ("paisa bakki")
  totalAmount: { type: Number, required: true, default: 0 },
  paidAmount: { type: Number, required: true, default: 0 },
  remainingDue: { type: Number, default: 0 }, // Remaining balance ("Bakki")
  
  paymentMode: { 
    type: String, 
    enum: ['Cash', 'UPI', 'Card', 'Net Banking', 'Pending'], 
    default: 'Cash' 
  },
  paymentStatus: { 
    type: String, 
    enum: ['Paid', 'Partially Paid', 'Pending'], 
    default: 'Paid' 
  },
  
  queueId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Queue' 
  },
  notes: { 
    type: String 
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  createdByName: { 
    type: String 
  },
  billingDate: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

patientInvoiceSchema.index({ patientId: 1 });
patientInvoiceSchema.index({ clinicId: 1, createdAt: -1 });

module.exports = mongoose.model('PatientInvoice', patientInvoiceSchema);
