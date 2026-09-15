import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import sessionsRoutes from './routes/sessions.js';
import dtrRoutes from './routes/dtr.js';
import ojtRoutes from './routes/ojt.js';
import holidayRoutes from './routes/holidays.js';
import { User } from './models/User.js';
import { seedInMemoryStore } from './models/inMemoryStore.js';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dtr-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/dtr', dtrRoutes);
app.use('/api/ojt', ojtRoutes);
app.use('/api/holidays', holidayRoutes);

// Database offline error middleware fallback
app.use((err, req, res, _next) => {
  if (err.name === 'MongooseError' || err.name === 'MongoNetworkError' || err.message?.includes('buffering timed out')) {
    console.log('[AI Studio] Database offline — handling request via fallback');
    if (req.method === 'GET') {
      return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
    }
    return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Serve frontend static assets from root directory
app.use(express.static(rootDir));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

const port = Number(process.env.PORT || 3000);

async function ensureAdminSeed() {
  const adminUser = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const adminPass = (process.env.ADMIN_PASSWORD || '').trim();
  const adminName = (process.env.ADMIN_NAME || 'Administrator').trim();
  if (!adminUser || !adminPass) return;
  try {
    const existing = await User.findOne({ username: adminUser }).lean();
    const hash = await bcrypt.hash(adminPass, 10);
    if (!existing) {
      await User.create({
        username: adminUser,
        name: adminName,
        email: `${adminUser}@dtr.local`,
        passwordHash: hash,
        role: 'admin',
        goal: 300,
        dailyHours: 8,
        scheduleStart: '08:00',
        scheduleEnd: '17:00',
      });
      console.log(`Admin seeded: ${adminUser}`);
      return;
    }
    await User.updateOne(
      { _id: existing._id },
      {
        role: 'admin',
        passwordHash: hash,
        name: adminName,
        email: existing.email || `${adminUser}@dtr.local`,
      }
    );
    console.log(`Admin account synced with .env: ${adminUser}`);
  } catch (e) {
    console.warn('Failed to seed admin in MongoDB:', e.message);
  }
}

async function ensureDemoUserSeed() {
  try {
    const existing = await User.findOne({ username: 'john' });
    if (!existing) {
      const hash = await bcrypt.hash('pass123', 10);
      const user = await User.create({
        username: 'john',
        name: 'John Reyes',
        email: 'john@dtr.local',
        passwordHash: hash,
        role: 'user',
        studentId: '2026-00142',
        school: 'Polytechnic University',
        course: 'BS Information Technology',
        company: 'CloudTech Solutions',
        department: 'Software Engineering',
        supervisor: 'Engr. Santos',
        isEmailVerified: true,
      });
      const { OJTRequirement } = await import('./models/OJTRequirement.js');
      await OJTRequirement.create({
        userId: user._id,
        name: 'OJT 1 - Practicum Internship',
        targetHours: 300,
        startDate: new Date().toISOString().slice(0, 10),
        status: 'ACTIVE',
      });
      console.log('Demo user seeded: john');
    }
  } catch (e) {
    console.warn('Failed to seed demo user:', e.message);
  }
}

// Seed in-memory store so it is ready immediately if DB is offline
seedInMemoryStore();

// Attempt DB connection gracefully without exiting process
connectDB(process.env.MONGODB_URI)
  .then(async (connected) => {
    if (connected) {
      await ensureAdminSeed();
      await ensureDemoUserSeed();
    }
  })
  .catch((err) => {
    console.warn('MongoDB connection error, falling back to in-memory store:', err.message);
  })
  .finally(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`DTR server running at http://0.0.0.0:${port}`);
    });
  });


