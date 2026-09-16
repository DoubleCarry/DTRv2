import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*')) return callback(null, true);

    const cleanOrigin = origin.replace(/\/$/, '');
    if (
      allowedOrigins.includes(cleanOrigin) ||
      cleanOrigin.endsWith('.vercel.app') ||
      cleanOrigin.endsWith('.workers.dev') ||
      cleanOrigin.includes('onrender.com') ||
      cleanOrigin.includes('localhost') ||
      cleanOrigin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dtr-backend', timestamp: new Date().toISOString() });
});

export async function ensureAdminSeed() {
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

export async function ensureDemoUserSeed() {
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

// Seed in-memory store immediately as baseline fallback
seedInMemoryStore();

let isInitialized = false;
let initPromise = null;

export async function initializeDatabase() {
  if (isInitialized) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const connected = await connectDB(process.env.MONGODB_URI);
      if (connected) {
        await ensureAdminSeed();
        await ensureDemoUserSeed();
      }
      isInitialized = true;
      return connected;
    } catch (err) {
      console.warn('Database initialization warning:', err.message);
      isInitialized = true;
      return false;
    }
  })();

  return initPromise;
}

// Auto-initialize connection for serverless requests
app.use(async (_req, _res, next) => {
  try {
    await initializeDatabase();
  } catch (e) {
    console.warn('Serverless DB middleware error:', e.message);
  }
  next();
});

// API Routes
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

// Serve frontend static assets and SPA fallback
const rootDir = process.cwd();
app.use(express.static(rootDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(rootDir, 'index.html'));
});

export { app };
export default app;
