// --- UPDATED Patient.js ---
const mongoose = require('mongoose');

const patientSchema = mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  age: { type: Number },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  bloodGroup: { type: String },

  vitals: [{
    bloodPressure: String,
    pulseRate: String,
    temperature: String,
    sugarLevel: String,
    weight: Number,
    height: Number,
    bmi: Number,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedAt: { type: Date, default: Date.now }
  }],

  medicalHistory: [{
    // 🔑 ADD THIS: Link to the specific visit session
    visitId: { type: String },
    date: { type: Date, default: Date.now },
    doctorName: String,
    clinicName: String,
    diagnosis: String,
    symptoms: String,
    prescription: String,
    medicines: [
      {
        name: String, // Medicine name (Kyare kai Vastu)
        time: String, // When to take (Savar/Bapor/Sanj)
        amount: String, // Per dose dosage
        total: String // Total quantity to purchase
      }
    ]
  }],

  documents: [{
    // 🔑 ADD THIS: Connects the file to the specific history entry above
    visitId: { type: String },
    title: String,
    fileUrl: String,
    fileType: { type: String, default: 'Report' },
    uploadedAt: { type: Date, default: Date.now }
  }],

  appointments: [{
    queueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Queue' },
    clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
    clinicName: String,
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doctorName: String,
    appointmentDate: Date,
    status: { type: String, enum: ['Scheduled', 'Completed', 'Cancelled'], default: 'Scheduled' },
    createdAt: { type: Date, default: Date.now }
  }],

  visitedClinics: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' }],
  lastVisit: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Patient', patientSchema);