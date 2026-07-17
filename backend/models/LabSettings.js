const mongoose = require('../config/mongoose_connection');

const labSettingsSchema = mongoose.Schema({
    labId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IndependentLab',
        required: true,
        unique: true
    },
    testFee: { type: Number, default: 450 },
    primaryColor: { type: String, default: '#1B6CA8' },
    headerFontSize: { type: Number, default: 22 },
    bodyFontSize: { type: Number, default: 11 },
    defaultNotes: { type: String, default: 'Results are clinically validated. Correlate with symptoms.' },
    defaultDoctorName: { type: String, default: 'Pathologist' }
}, { timestamps: true });

module.exports = mongoose.model('LabSettings', labSettingsSchema);
