const mongoose = require('../config/mongoose_connection');

/**
 * LabConnection — Represents a connection between a Clinic and an IndependentLab.
 * A clinic sends a "connection request" to a lab; the lab accepts or rejects.
 * Once accepted, the clinic can send external lab test requests.
 */
const labConnectionSchema = mongoose.Schema({
    clinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true
    },
    labId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IndependentLab',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null }
}, { timestamps: true });

// Ensure a clinic can only send one connection request to a lab at a time
labConnectionSchema.index({ clinicId: 1, labId: 1 }, { unique: true });

module.exports = mongoose.model('LabConnection', labConnectionSchema);
