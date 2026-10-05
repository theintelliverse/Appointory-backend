const mongoose = require('mongoose');

const privateNoteSchema = mongoose.Schema({
  patientPhone: { type: String, required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  patientName: { type: String },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('PrivateNote', privateNoteSchema);
