const mongoose = require('../config/mongoose_connection');

const reviewSchema = mongoose.Schema({
    targetType: {
        type: String,
        enum: ['doctor', 'clinic', 'lab'],
        required: true
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'targetModel'
    },
    targetModel: {
        type: String,
        enum: ['User', 'Clinic', 'IndependentLab'],
        required: true
    },
    patientName: {
        type: String,
        required: true,
        trim: true
    },
    patientPhone: {
        type: String,
        default: '',
        trim: true
    },
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        default: null
    },
    score: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    review: {
        type: String,
        default: '',
        trim: true
    },
    isVerifiedPatient: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Compound index for fast queries by entity
reviewSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
reviewSchema.index({ patientId: 1, patientPhone: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
