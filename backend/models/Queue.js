const mongoose = require('mongoose');

const queueSchema = mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true
  },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // 🆕 Changed to not required initially for Self-Check-in requests
  tokenNumber: { type: String },

  status: {
    type: String,
    enum: ['Pending-Approval', 'Waiting', 'In-Consultation', 'Completed', 'Skipped'],
    default: 'Waiting'
  },

  // 🆕 Gatekeeper flag
  isApproved: {
    type: Boolean,
    default: false
  },

  visitType: {
    type: String,
    enum: ['Walk-in', 'Appointment'],
    default: 'Walk-in'
  },
  currentStage: {
    type: String,
    enum: ['Waiting', 'In-Consultation', 'Lab-Pending', 'Lab-Completed'],
    default: 'Waiting'
  },
  requiredTest: { type: String },
  isEmergency: { type: Boolean, default: false }, // Useful for priority sorting
  appointmentDate: { type: Date }, // For scheduled appointments - when patient booked
  reason: { type: String }, // Reason for visit - why patient is scheduling appointment
  assignedLabStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  labId: { type: mongoose.Schema.Types.ObjectId, ref: 'IndependentLab' },
  startTime: Date,
  endTime: Date,
  diagnosis: { type: String }, // Diagnosis from doctor
  medicines: [
    {
      name: { type: String }, // Medicine name (Kyare kai Vastu)
      amount: { type: String } // Dosage/Quantity (Ketla Amount)
    }
  ],
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  // Reminder and follow-up tracking
  reminder24hSent: { type: Boolean, default: false },
  reminder24hSkipped: { type: String, default: null }, // e.g., 'no_opt_in'
  reminder24hAttempts: { type: Number, default: 0 },
  reminder24hMessageId: { type: String, default: null }, // Idempotency key from WhatsApp provider
  reminder2hSent: { type: Boolean, default: false },
  reminder2hSkipped: { type: String, default: null }, // e.g., 'no_opt_in'
  reminder2hAttempts: { type: Number, default: 0 },
  reminder2hMessageId: { type: String, default: null }, // Idempotency key from WhatsApp provider
  claimedAt: { type: Date, default: null },
  followUpSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for fast reminder claiming and status queries
queueSchema.index({ status: 1, visitType: 1, reminder24hSent: 1, appointmentDate: 1 });
queueSchema.index({ status: 1, visitType: 1, reminder2hSent: 1, appointmentDate: 1 });
queueSchema.index({ clinicId: 1, doctorId: 1, status: 1 });


module.exports = mongoose.model('Queue', queueSchema);