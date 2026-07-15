const mongoose = require('../config/mongoose_connection');

const supportTicketSchema = mongoose.Schema({
    senderName: { type: String, required: true },
    senderEmail: { type: String, required: true },
    facilityType: { type: String, enum: ['clinic', 'lab'], required: true },
    facilityName: { type: String, required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolutionText: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
