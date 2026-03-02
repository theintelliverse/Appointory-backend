const mongoose = require('../config/mongoose_connection');

const medicalRecordSchema =  mongoose.Schema({
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  tokenNumber: String,
  notes: { type: String }, // The text from the doctor's textarea
  visitDate: { type: Date, default: Date.now },
  duration: Number // Minutes spent in cabin
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);