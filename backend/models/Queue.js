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
  assignedLabStaff: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startTime: Date, 
  endTime: Date,   
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Queue', queueSchema);