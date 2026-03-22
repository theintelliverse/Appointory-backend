const mongoose = require('mongoose');

const callRequestSchema = mongoose.Schema({
    clinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true
    },
    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    patientPhone: {
        type: String,
        required: true
    },
    patientName: {
        type: String
    },

    // ✅ Call Status
    status: {
        type: String,
        enum: ['pending', 'notified', 'reminded', 'confirmed', 'missed', 'completed'],
        default: 'pending'
    },

    // ✅ WhatsApp Notification
    whatsappSent: {
        type: Boolean,
        default: false
    },
    whatsappMessageSid: {
        type: String,
        default: null
    },
    whatsappSentAt: {
        type: Date,
        default: null
    },

    // ✅ Patient Confirmation
    patientConfirmed: {
        type: Boolean,
        default: false
    },
    patientConfirmedAt: {
        type: Date,
        default: null
    },

    // ✅ Reminder Configuration
    reminderTimings: {
        type: [Number], // [5, 10, 15] - minutes
        default: [5, 10, 15]
    },
    remindersSent: [{
        minutesAfter: Number,
        sentAt: { type: Date, default: Date.now },
        messageSid: String,
        status: { type: String, enum: ['sent', 'failed'], default: 'sent' }
    }],

    // ✅ Call Details
    initialCallTime: {
        type: Date,
        default: Date.now
    },
    actualJoinTime: {
        type: Date,
        default: null
    },
    callEndTime: {
        type: Date,
        default: null
    },

    // ✅ Notes
    notes: {
        type: String,
        default: null
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for efficient queries
callRequestSchema.index({ clinicId: 1, doctorId: 1, createdAt: -1 });
callRequestSchema.index({ patientPhone: 1, clinicId: 1 });
callRequestSchema.index({ status: 1, clinicId: 1 });

module.exports = mongoose.model('CallRequest', callRequestSchema);
