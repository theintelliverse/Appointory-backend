const mongoose = require('../config/mongoose_connection');

const medicalRecordSchema = mongoose.Schema({
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  tokenNumber: String,
  notes: { type: String }, // The text from the doctor's textarea
  diagnosis: { type: String }, // Diagnosis from doctor
  medicines: [
    {
      name: { type: String },
      strength: { type: String },
      amount: { type: String },
      whenToTake: { type: String },
      time: { type: String },
      beforeAfter: { type: String },
      duration: { type: String },
      total: { type: String },
      instructions: { type: String }
    }
  ],
  visitDate: { type: Date, default: Date.now },
  duration: Number, // Minutes spent in cabin
  followUpDate: { type: Date }
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);