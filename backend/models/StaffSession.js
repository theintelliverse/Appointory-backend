const mongoose = require('mongoose');

const StaffSessionSchema = new mongoose.Schema({
    staffId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    clinicId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true
    },
    loginTime: {
        type: Date,
        default: Date.now,
        required: true
    },
    logoutTime: {
        type: Date
    },
    sessionDurationMinutes: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// ✅ Mongoose 9: use async pre-save hooks — next() callback is deprecated
StaffSessionSchema.pre('save', async function() {
    if (this.logoutTime && this.loginTime) {
        const diffMs = this.logoutTime - this.loginTime;
        this.sessionDurationMinutes = Math.round(diffMs / 60000);
    }
});

module.exports = mongoose.model('StaffSession', StaffSessionSchema);
