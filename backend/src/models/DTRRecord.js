import mongoose from 'mongoose';
import { InMemoryDTRRecord } from './inMemoryStore.js';

const DTRRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ojtRequirementId: { type: mongoose.Schema.Types.ObjectId, ref: 'OJTRequirement', required: true, index: true },
    workDate: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    timeIn: { type: String, required: true }, // "HH:MM"
    timeOut: { type: String, required: true }, // "HH:MM"
    hours: { type: Number, default: 0 },
    absent: { type: Boolean, default: false },
    regularHours: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    undertimeMinutes: { type: Number, default: 0 },
    note: { type: String, default: '', trim: true },
    source: { type: String, enum: ['manual', 'import', 'admin'], default: 'manual' },
    createdBy: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: mongoose.Schema.Types.Mixed },
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

DTRRecordSchema.index({ userId: 1, workDate: -1, deletedAt: 1 });
DTRRecordSchema.index({ ojtRequirementId: 1, deletedAt: 1 });

export const MongoDTRRecord = mongoose.model('DTRRecord', DTRRecordSchema);

export const DTRRecord = new Proxy({}, {
  get(_target, prop) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const val = MongoDTRRecord[prop];
      return typeof val === 'function' ? val.bind(MongoDTRRecord) : val;
    }
    const val = InMemoryDTRRecord[prop];
    return typeof val === 'function' ? val.bind(InMemoryDTRRecord) : val;
  },
});
