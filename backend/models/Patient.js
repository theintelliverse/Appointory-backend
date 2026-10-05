// --- UPDATED Patient.js ---
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const patientSchema = mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { 
    type: String, 
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Optional/null for secondary family members
        return /^[6-9]\d{9}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9`
    }
  },
  isPrimaryAccount: { type: Boolean, default: false }, // Explicit flag for primary account holders
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null }, // Null for primary account; points to primary account for family members
  relationship: { type: String, default: 'Self' }, // 'Self', 'Spouse', 'Child', 'Parent', 'Other'
  isMinor: { type: Boolean, default: false },
  guardianName: { type: String, default: null },
  guardianConsent: { type: Boolean, default: false },
  guardianConsentAt: { type: Date, default: null },
  passwordHash: { type: String, default: null }, // Password hash for primary account login
  tokenVersion: { type: Number, default: 0 }, // Incremented on password reset to revoke all active JWT sessions
  whatsappOptIn: { type: Boolean, default: false },
  whatsappOptInAt: { type: Date, default: null },
  consentHistory: [{
    version: { type: String, default: 'v1.0' },
    consentedAt: { type: Date, default: Date.now }
    // ipAddress intentionally omitted for DPDP Act data minimization
  }],
  mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null }, // Soft-merge target pointer
  age: { type: Number },
  yearOfBirth: { type: Number }, // Stable alternative to age for longitudinal record-keeping
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
}, { 
  timestamps: true,
  autoIndex: process.env.NODE_ENV !== 'production' // Prevents deployment crash if duplicate phones exist before migration
});

// Robust Partial Unique Index: Enforces uniqueness ONLY on verified primary accounts (isPrimaryAccount: true).
// Secondary family members and legacy unlinked records will never collide with this index.
patientSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { isPrimaryAccount: true, phone: { $type: 'string' } } }
);
patientSchema.index({ accountId: 1 });
patientSchema.index({ isPrimaryAccount: 1 });
patientSchema.index({ mergedInto: 1 });

module.exports = mongoose.model('Patient', patientSchema);