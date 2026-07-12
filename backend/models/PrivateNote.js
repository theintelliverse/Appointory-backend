const mongoose = require('mongoose');

const privateNoteSchema = mongoose.Schema({
  patientPhone: { type: String, required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('PrivateNote', privateNoteSchema);
