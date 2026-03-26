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
      name: { type: String }, // Medicine name (Kyare kai Vastu)
      time: { type: String }, // When to take (Savar/Bapor/Sanj) - (Kone bethe)
      amount: { type: String }, // Per dose dosage (Per Dose)
      total: { type: String } // Total quantity to purchase (Total Ketli)
    }
  ],
  visitDate: { type: Date, default: Date.now },
  duration: Number // Minutes spent in cabin
});

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);