const mongoose = require('../config/mongoose_connection');

const userSchema = mongoose.Schema({
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: function() {
      return this.role !== 'superadmin';
    }
  },
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['admin', 'doctor', 'receptionist', 'lab', 'superadmin'],
    default: 'receptionist'
  },
  // Doctor-specific fields
  specialization: { type: String },
  isAvailable: { type: Boolean, default: true },
  profileImage: { type: String, default: "" },
  bio: { type: String },
  experience: { type: Number }, // years
  education: { type: String },
  clinicLocation: { type: String, default: "" },
  clinicContact: { type: String, default: "" },
  phoneNumber: { type: String, default: "" },
  isActive: { type: Boolean, default: true }, // 🔑 Add this
  deletedAt: { type: Date, default: null },
  templates: [
    {
      name: { type: String, required: true },
      drugs: { type: String, required: true },
      instruction: { type: String },
      category: { type: String, default: 'General' }
    }
  ],

  // Password Reset
  resetToken: { type: String, default: null },
  resetTokenExpiry: { type: Date, default: null },

  // 🌐 Doctor SEO & Public Profile Management
  slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  consultationFee: { type: Number, default: 500 },
  availableDays: {
    type: [String],
    default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  },
  languages: {
    type: [String],
    default: ['English', 'Hindi']
  },
  medicalLicenseNumber: { type: String, default: '' },
  seoTitle: { type: String, default: '' },
  seoDescription: { type: String, default: '' },
  socialLinks: {
    linkedin: { type: String, default: '' },
    twitter: { type: String, default: '' },
    instagram: { type: String, default: '' },
    youtube: { type: String, default: '' }
  },
  rating: {
    score: { type: Number, default: 4.9 },
    count: { type: Number, default: 22 }
  },
  videoUrl: { type: String, default: '' }
}, { timestamps: true });

// Ensures email is unique within a single clinic only
userSchema.index({ email: 1, clinicId: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);