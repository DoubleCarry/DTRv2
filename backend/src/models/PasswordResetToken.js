import mongoose from 'mongoose';
import { InMemoryPasswordResetToken } from './inMemoryStore.js';

const PasswordResetTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const MongoPasswordResetToken = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);

export const PasswordResetToken = new Proxy({}, {
  get(_target, prop) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const val = MongoPasswordResetToken[prop];
      return typeof val === 'function' ? val.bind(MongoPasswordResetToken) : val;
    }
    const val = InMemoryPasswordResetToken[prop];
    return typeof val === 'function' ? val.bind(InMemoryPasswordResetToken) : val;
  },
});
