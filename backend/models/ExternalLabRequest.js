const mongoose = require('../config/mongoose_connection');

/**
 * ExternalLabRequest — A test request sent by a connected clinic to an IndependentLab.
 * The lab can accept, process, complete, and upload reports for each request.
 */
const externalLabRequestSchema = mongoose.Schema({
    labId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IndependentLab',
        required: true
    },
    clinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true
    },
    // Patient info (duplicated here so lab can read it without clinic data access)
    patientName: { type: String, required: true, trim: true },
    patientPhone: { type: String, required: true, trim: true },
    testName: { type: String, required: true, trim: true },
    notes: { type: String, default: '', trim: true },

    // Optional reference back to clinic's queue entry
    queueId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Queue',
        default: null
    },

    // Status lifecycle
    status: {
        type: String,
        enum: ['Pending', 'Accepted', 'Processing', 'Completed', 'Rejected'],
        default: 'Pending'
    },

    // Reports uploaded by the lab
    reports: [
        {
            fileUrl: { type: String, required: true },
            publicId: { type: String, default: null },
            fileType: { type: String, enum: ['PDF', 'Image'], default: 'PDF' },
            title: { type: String, default: 'Lab Report' },
            uploadedAt: { type: Date, default: Date.now }
        }
    ],

    requestedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('ExternalLabRequest', externalLabRequestSchema);
