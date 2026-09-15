import mongoose from 'mongoose';
import { InMemoryHoliday } from './inMemoryStore.js';

const HolidaySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.Mixed, default: null, index: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['system', 'custom'], default: 'custom' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const MongoHoliday = mongoose.model('Holiday', HolidaySchema);

export const Holiday = new Proxy({}, {
  get(_target, prop) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const val = MongoHoliday[prop];
      return typeof val === 'function' ? val.bind(MongoHoliday) : val;
    }
    const val = InMemoryHoliday[prop];
    return typeof val === 'function' ? val.bind(InMemoryHoliday) : val;
  },
});
