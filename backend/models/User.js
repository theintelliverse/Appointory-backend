const mongoose = require('../config/mongoose_connection');

const userSchema = mongoose.Schema({
  clinicId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Clinic', 
    required: true 
  },
  name: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['admin', 'doctor', 'receptionist', 'lab'], 
    default: 'receptionist' 
  },
  // Doctor-specific fields
  specialization: { type: String },
  isAvailable: { type: Boolean, default: true },
  profileImage: { type: String, default: "" },
  bio: { type: String },
  experience: { type: Number }, // years
  education: { type: String } , 
  isActive: { type: Boolean, default: true }, // 🔑 Add this
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

// Ensures email is unique within a single clinic only
userSchema.index({ email: 1, clinicId: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);