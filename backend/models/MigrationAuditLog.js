const mongoose = require('mongoose');

const migrationAuditLogSchema = new mongoose.Schema({
  migrationRunId: { type: String, required: true, index: true },
  actionType: { 
    type: String, 
    enum: ['primary_account_set', 'soft_merge', 'candidate_gated_link', 'index_rebuild'], 
    required: true 
  },
  primaryPatientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
  secondaryPatientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', default: null, index: true },
  phone: { type: String, index: true },
  name: { type: String },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
  details: { type: mongoose.Schema.Types.Mixed },
  status: { type: String, enum: ['applied', 'rolled_back'], default: 'applied' },
  appliedAt: { type: Date, default: Date.now },
  rolledBackAt: { type: Date, default: null }
}, { timestamps: true });

migrationAuditLogSchema.index({ migrationRunId: 1, actionType: 1 });
migrationAuditLogSchema.index({ phone: 1 });

module.exports = mongoose.model('MigrationAuditLog', migrationAuditLogSchema);
