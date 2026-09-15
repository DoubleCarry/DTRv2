import mongoose from 'mongoose';
import { InMemoryOJTRequirement } from './inMemoryStore.js';

const OJTRequirementSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    targetHours: { type: Number, required: true, min: 1 },
    startDate: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'ARCHIVED'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

OJTRequirementSchema.index({ userId: 1, status: 1 });

export const MongoOJTRequirement = mongoose.model('OJTRequirement', OJTRequirementSchema);

export const OJTRequirement = new Proxy({}, {
  get(_target, prop) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const val = MongoOJTRequirement[prop];
      return typeof val === 'function' ? val.bind(MongoOJTRequirement) : val;
    }
    const val = InMemoryOJTRequirement[prop];
    return typeof val === 'function' ? val.bind(InMemoryOJTRequirement) : val;
  },
});
