const mongoose = require('../config/mongoose_connection');

const medicalRecordSchema = mongoose.Schema({
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  tokenNumber: String,
  notes: { type: String }, // The text from the doctor's textarea
  diagnosis: { type: String }, // Diagnosis from doctor
  medicines: [
    {
      name: { type: String },
      strength: { type: String },
      whenToTake: { type: String },
      beforeAfter: { type: String },
      duration: { type: String },
      instructions: { type: String }
    }
  ],
  visitDate: { type: Date, default: Date.now },
  duration: Number // Minutes spent in cabin
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);