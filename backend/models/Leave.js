const mongoose = require('../config/mongoose_connection');

const leaveSchema = mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: null,
    index: true
  },
  labId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IndependentLab',
    default: null,
    index: true
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // null indicates a clinic/lab-wide closure or holiday
    index: true
  },
  type: {
    type: String,
    enum: ['clinic_holiday', 'doctor_leave', 'lab_holiday', 'lab_leave'],
    default: 'clinic_holiday'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  reason: {
    type: String,
    trim: true,
    default: ''
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  }
}, { timestamps: true });

// Compound indexes for querying leaves by clinic/lab and date overlap
leaveSchema.index({ clinicId: 1, startDate: 1, endDate: 1 });
leaveSchema.index({ clinicId: 1, doctorId: 1, startDate: 1, endDate: 1 });
leaveSchema.index({ labId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('Leave', leaveSchema);
