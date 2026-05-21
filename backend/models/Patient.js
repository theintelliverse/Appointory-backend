// --- UPDATED Patient.js ---
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const patientSchema = mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String }, // Password hash for login
  age: { type: Number },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  bloodGroup: { type: String },
  dob: { type: Date },
  allergies: { type: String },
  occupation: { type: String },
  email: { type: String },
  address: { type: String },
  lastVisit: { type: Date },
  registeredOn: { type: Date, default: Date.now },

  vitals: [{
    bloodPressure: String,
    pulseRate: String,
    temperature: String,
    sugarLevel: String,
    spO2: String,
    weight: Number,
    height: Number,
    bmi: Number,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    recordedAt: { type: Date, default: Date.now }
  }],

  medicalHistory: [{
    // dY"` ADD THIS: Link to the specific visit session
    visitId: { type: String },
    date: { type: Date, default: Date.now },
    doctorName: String,
    clinicName: String,
    diagnosis: String,
    symptoms: String,
    prescription: String,
    medicines: [
      {
        name: String,
        strength: String,
        whenToTake: String,
        beforeAfter: String,
        duration: String,
        instructions: String
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