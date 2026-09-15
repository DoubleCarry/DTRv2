import mongoose from 'mongoose';
import { InMemoryAuditLog } from './inMemoryStore.js';

const AuditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.Mixed, default: null, index: true },
    performedBy: { type: mongoose.Schema.Types.Mixed, required: true },
    performedByRole: { type: String, enum: ['user', 'admin'], default: 'user' },
    action: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ performedBy: 1, createdAt: -1 });

export const MongoAuditLog = mongoose.model('AuditLog', AuditLogSchema);

export const AuditLog = new Proxy({}, {
  get(_target, prop) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const val = MongoAuditLog[prop];
      return typeof val === 'function' ? val.bind(MongoAuditLog) : val;
    }
    const val = InMemoryAuditLog[prop];
    return typeof val === 'function' ? val.bind(InMemoryAuditLog) : val;
  },
});
