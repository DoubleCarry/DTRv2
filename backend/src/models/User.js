import mongoose from 'mongoose';
import { InMemoryUser } from './inMemoryStore.js';

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    studentId: { type: String, default: '', trim: true },
    school: { type: String, default: '', trim: true },
    course: { type: String, default: '', trim: true },
    company: { type: String, default: '', trim: true },
    department: { type: String, default: '', trim: true },
    supervisor: { type: String, default: '', trim: true },
    isEmailVerified: { type: Boolean, default: false },
    dailyHours: { type: Number, default: 8 },
    useFixedSchedule: { type: Boolean, default: false },
    lateTrackingEnabled: { type: Boolean, default: false },
    scheduleStart: { type: String, default: '08:00' },
    scheduleEnd: { type: String, default: '17:00' },
    lunchBreak: {
      enabled: { type: Boolean, default: true },
      start: { type: String, default: '12:00' },
      end: { type: String, default: '13:00' },
    },
    settings: {
      dailyHours: { type: Number, default: 8, min: 1, max: 24 },
      useFixedSchedule: { type: Boolean, default: false },
      scheduleMode: { type: String, enum: ['simple', 'advanced'], default: 'simple' },
      scheduleStart: { type: String, default: '08:00' },
      scheduleEnd: { type: String, default: '17:00' },
      earlyArrivalCountsAsOvertime: { type: Boolean, default: false },
      workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
      lunchBreak: {
        enabled: { type: Boolean, default: true },
        start: { type: String, default: '12:00' },
        end: { type: String, default: '13:00' },
      },
      showCharts: { type: Boolean, default: true },
      reportNotes: { type: String, default: '' },
      signatureMode: { type: String, enum: ['blank', 'image'], default: 'blank' },
      signatureData: { type: String, default: '' },
    },
  },
  { timestamps: true }
);



export const MongoUser = mongoose.model('User', UserSchema);

export const User = new Proxy({}, {
  get(_target, prop) {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const val = MongoUser[prop];
      return typeof val === 'function' ? val.bind(MongoUser) : val;
    }
    const val = InMemoryUser[prop];
    return typeof val === 'function' ? val.bind(InMemoryUser) : val;
  },
});
