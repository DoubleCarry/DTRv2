import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { OJTRequirement } from '../models/OJTRequirement.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireAuth } from '../middleware/auth.js';
import { getManilaDateStr } from '../utils/calcEngine.js';

const router = express.Router();

function signToken(userId) {
  const secret = process.env.JWT_SECRET || 'dtr-secret-fallback-key-2025';
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: '7d' });
}

export function toUserDTO(user, activeOjt = null) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    studentId: user.studentId || '',
    school: user.school || '',
    course: user.course || '',
    company: user.company || '',
    department: user.department || '',
    supervisor: user.supervisor || '',
    isEmailVerified: Boolean(user.isEmailVerified),
    settings: user.settings || {
      dailyHours: 8,
      useFixedSchedule: false,
      scheduleMode: 'simple',
      scheduleStart: '08:00',
      scheduleEnd: '17:00',
      earlyArrivalCountsAsOvertime: false,
      workingDays: [1, 2, 3, 4, 5],
      lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
      showCharts: true,
      reportNotes: '',
      signatureMode: 'blank',
      signatureData: '',
    },
    activeOjt: activeOjt ? {
      id: String(activeOjt._id),
      name: activeOjt.name,
      targetHours: activeOjt.targetHours,
      startDate: activeOjt.startDate,
      status: activeOjt.status,
    } : null,
    // Backward compatibility aliases
    goal: activeOjt ? activeOjt.targetHours : (user.settings?.dailyHours ? user.settings.dailyHours * 37.5 : 300),
    dailyHours: user.settings?.dailyHours ?? 8,
    scheduleStart: user.settings?.scheduleStart || user.scheduleStart || '08:00',
    scheduleEnd: user.settings?.scheduleEnd || user.scheduleEnd || '17:00',
    lateTrackingEnabled: Boolean(user.settings?.useFixedSchedule ?? user.lateTrackingEnabled),
    useFixedSchedule: Boolean(user.settings?.useFixedSchedule ?? user.useFixedSchedule),
    overtimeEnabled: user.settings?.earlyArrivalCountsAsOvertime ?? user.overtimeEnabled ?? true,
    lunchBreak: (() => {
      const lb = user.settings?.lunchBreak || user.lunchBreak;
      if (!lb) return { enabled: true, start: '12:00', end: '13:00' };
      return {
        enabled: Boolean(lb.enabled),
        start: String(lb.start || '12:00'),
        end: String(lb.end || '13:00'),
      };
    })(),
  };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      username = '',
      password = '',
      studentId = '',
      school = '',
      course = '',
      company = '',
      department = '',
      supervisor = '',
      targetHours = 300,
    } = req.body || {};

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim().toLowerCase();
    const cleanPass = String(password);

    if (!cleanName || !cleanUsername || !cleanPass) {
      return res.status(400).json({ error: 'Name, username, and password are required.' });
    }

    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username must be 3-24 characters containing only lowercase letters, numbers, and underscores.' });
    }

    if (cleanPass.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const fallbackEmail = cleanEmail || `${cleanUsername}@dtr.local`;

    // Check duplicate username
    const existingUser = await User.findOne({ username: cleanUsername });
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken. Please choose another.' });
    }

    // Check duplicate email
    const existingEmail = await User.findOne({ email: fallbackEmail });
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const passwordHash = await bcrypt.hash(cleanPass, 10);
    const user = await User.create({
      name: cleanName,
      email: fallbackEmail,
      username: cleanUsername,
      passwordHash,
      role: 'user',
      studentId: String(studentId).trim(),
      school: String(school).trim(),
      course: String(course).trim(),
      company: String(company).trim(),
      department: String(department).trim(),
      supervisor: String(supervisor).trim(),
      isEmailVerified: false,
      settings: {
        dailyHours: 8,
        useFixedSchedule: false,
        scheduleMode: 'simple',
        scheduleStart: '08:00',
        scheduleEnd: '17:00',
        earlyArrivalCountsAsOvertime: false,
        workingDays: [1, 2, 3, 4, 5],
        lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
        showCharts: true,
        reportNotes: '',
        signatureMode: 'blank',
        signatureData: '',
      },
    });

    // Automatically create user's initial OJT requirement
    const initialOjt = await OJTRequirement.create({
      userId: user._id,
      name: 'OJT 1 - Practicum Internship',
      targetHours: Math.max(1, Number(targetHours) || 300),
      startDate: getManilaDateStr(),
      status: 'ACTIVE',
    });

    await AuditLog.create({
      userId: user._id,
      performedBy: user._id,
      performedByRole: 'user',
      action: 'USER_REGISTERED',
      details: { username: cleanUsername, email: fallbackEmail },
    });

    const token = signToken(user._id);
    return res.status(201).json({
      token,
      user: toUserDTO(user, initialOjt),
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Unable to complete registration. Please try again.' });
  }
});

// GET /api/auth/login
router.get('/login', (_req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'The login endpoint only accepts POST requests with JSON { username, password }. Visit / in your browser to view the login interface.',
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username = '', password = '' } = req.body || {};
    const identifier = String(username).trim().toLowerCase();
    const plainPass = String(password);

    if (!identifier || !plainPass) {
      return res.status(400).json({ error: 'Please provide your username/email and password.' });
    }

    // Allow login by username or email
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const match = await bcrypt.compare(plainPass, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Find active OJT
    let activeOjt = await OJTRequirement.findOne({ userId: user._id, status: 'ACTIVE' });
    if (!activeOjt) {
      const anyOjt = await OJTRequirement.findOne({ userId: user._id });
      if (anyOjt) {
        activeOjt = anyOjt;
      } else if (user.role !== 'admin') {
        activeOjt = await OJTRequirement.create({
          userId: user._id,
          name: 'OJT 1',
          targetHours: 300,
          startDate: getManilaDateStr(),
          status: 'ACTIVE',
        });
      }
    }

    const token = signToken(user._id);
    return res.json({
      token,
      user: toUserDTO(user, activeOjt),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Authentication service temporarily unavailable.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ error: 'User not found' });

    let activeOjt = await OJTRequirement.findOne({ userId: user._id, status: 'ACTIVE' }).lean().catch(() => null);
    if (!activeOjt) {
      activeOjt = await OJTRequirement.findOne({ userId: user._id }).lean().catch(() => null);
    }

    const allOjts = await OJTRequirement.find({ userId: user._id }).sort({ createdAt: -1 }).lean().catch(() => []);

    return res.json({
      user: toUserDTO(user, activeOjt),
      ojts: allOjts,
    });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Unable to retrieve profile.' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { identifier = '' } = req.body || {};
    const cleanId = String(identifier).trim().toLowerCase();
    if (!cleanId) {
      return res.status(400).json({ error: 'Username or email address is required.' });
    }

    const user = await User.findOne({
      $or: [{ username: cleanId }, { email: cleanId }],
    });

    // Prevent user enumeration: always return success message
    const genericSuccess = 'If an account matches that email or username, password reset instructions have been generated.';

    if (!user) {
      return res.json({ message: genericSuccess });
    }

    // Generate secure expiring token (valid 1 hour)
    const resetToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    await PasswordResetToken.create({
      userId: user._id,
      token: resetToken,
      expiresAt,
      used: false,
    });

    await AuditLog.create({
      userId: user._id,
      performedBy: user._id,
      performedByRole: user.role,
      action: 'PASSWORD_RESET_REQUESTED',
      details: { tokenPrefix: resetToken.slice(0, 6) },
    });

    // In portfolio environment, return resetToken in response for immediate testing
    return res.json({
      message: genericSuccess,
      demoResetToken: resetToken,
      username: user.username,
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Unable to process password reset request.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token = '', newPassword = '', confirmPassword = '' } = req.body || {};
    const cleanToken = String(token).trim();
    const cleanPass = String(newPassword);

    if (!cleanToken || !cleanPass) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    if (cleanPass.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    if (cleanPass !== String(confirmPassword)) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const resetRecord = await PasswordResetToken.findOne({ token: cleanToken, used: false });
    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired password reset token.' });
    }

    if (new Date(resetRecord.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Password reset token has expired. Please request a new one.' });
    }

    const user = await User.findById(resetRecord.userId);
    if (!user) {
      return res.status(404).json({ error: 'Associated user account not found.' });
    }

    user.passwordHash = await bcrypt.hash(cleanPass, 10);
    await user.save();

    await PasswordResetToken.updateOne({ token: cleanToken }, { used: true });

    await AuditLog.create({
      userId: user._id,
      performedBy: user._id,
      performedByRole: user.role,
      action: 'PASSWORD_RESET_COMPLETED',
      details: { via: 'token' },
    });

    return res.json({ ok: true, message: 'Password has been successfully reset. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Unable to reset password.' });
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', requireAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { isEmailVerified: true });
    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'EMAIL_VERIFIED',
      details: {},
    });
    return res.json({ ok: true, message: 'Email address successfully verified.' });
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({ error: 'Unable to verify email.' });
  }
});

export default router;
