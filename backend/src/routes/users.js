import express from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { OJTRequirement } from '../models/OJTRequirement.js';
import { DTRRecord } from '../models/DTRRecord.js';
import { AuditLog } from '../models/AuditLog.js';
import { toUserDTO } from './auth.js';
import {
  calcOjtTotals,
  calcEntryCreditedDuration,
  calcRawDurationMins,
  isFutureDate,
} from '../utils/calcEngine.js';

const router = express.Router();
router.use(requireAuth);

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative access required.' });
  }
  return next();
}

// PUT /api/users/me/profile
router.put('/me/profile', async (req, res) => {
  try {
    const {
      name,
      email,
      studentId,
      school,
      course,
      company,
      department,
      supervisor,
    } = req.body || {};

    const update = {};
    if (name !== undefined) {
      const cleanName = String(name).trim();
      if (!cleanName) return res.status(400).json({ error: 'Name cannot be blank.' });
      update.name = cleanName;
    }
    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Invalid email address.' });
      }
      const existing = await User.findOne({ email: cleanEmail, _id: { $ne: req.user._id } });
      if (existing) {
        return res.status(409).json({ error: 'Email is already in use by another account.' });
      }
      update.email = cleanEmail;
    }
    if (studentId !== undefined) update.studentId = String(studentId).trim();
    if (school !== undefined) update.school = String(school).trim();
    if (course !== undefined) update.course = String(course).trim();
    if (company !== undefined) update.company = String(company).trim();
    if (department !== undefined) update.department = String(department).trim();
    if (supervisor !== undefined) update.supervisor = String(supervisor).trim();

    const updated = await User.findByIdAndUpdate(req.user._id, update, { new: true }).lean();

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'UPDATE_PROFILE',
      details: { updatedFields: Object.keys(update) },
    });

    const activeOjt = await OJTRequirement.findOne({ userId: req.user._id, status: 'ACTIVE' }).lean();
    return res.json({ user: toUserDTO(updated, activeOjt) });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// PUT /api/users/me/settings
router.put('/me/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const currentSettings = req.user.settings || {};

    const fixedSched = body.useFixedSchedule !== undefined 
      ? Boolean(body.useFixedSchedule) 
      : (body.lateTrackingEnabled !== undefined ? Boolean(body.lateTrackingEnabled) : currentSettings.useFixedSchedule);

    const newSettings = {
      ...currentSettings,
      dailyHours: body.dailyHours !== undefined ? Number(body.dailyHours) : currentSettings.dailyHours,
      useFixedSchedule: Boolean(fixedSched),
      scheduleMode: body.scheduleMode || currentSettings.scheduleMode || 'simple',
      scheduleStart: body.scheduleStart !== undefined ? String(body.scheduleStart) : (currentSettings.scheduleStart || '08:00'),
      scheduleEnd: body.scheduleEnd !== undefined ? String(body.scheduleEnd) : (currentSettings.scheduleEnd || '17:00'),
      earlyArrivalCountsAsOvertime: body.earlyArrivalCountsAsOvertime !== undefined ? Boolean(body.earlyArrivalCountsAsOvertime) : currentSettings.earlyArrivalCountsAsOvertime,
      workingDays: Array.isArray(body.workingDays) ? body.workingDays : currentSettings.workingDays,
      lunchBreak: body.lunchBreak ? {
        enabled: Boolean(body.lunchBreak.enabled),
        start: String(body.lunchBreak.start || '12:00'),
        end: String(body.lunchBreak.end || '13:00'),
      } : currentSettings.lunchBreak,
      showCharts: body.showCharts !== undefined ? Boolean(body.showCharts) : currentSettings.showCharts,
      reportNotes: body.reportNotes !== undefined ? String(body.reportNotes) : currentSettings.reportNotes,
      signatureMode: ['blank', 'image'].includes(body.signatureMode) ? body.signatureMode : currentSettings.signatureMode,
      signatureData: body.signatureData !== undefined ? String(body.signatureData) : currentSettings.signatureData,
    };

    const userUpdate = {
      settings: newSettings,
      scheduleStart: newSettings.scheduleStart,
      scheduleEnd: newSettings.scheduleEnd,
      dailyHours: newSettings.dailyHours,
      useFixedSchedule: newSettings.useFixedSchedule,
      lateTrackingEnabled: newSettings.useFixedSchedule,
      lunchBreak: newSettings.lunchBreak,
    };
    if (body.name && String(body.name).trim()) {
      userUpdate.name = String(body.name).trim();
    }
    if (body.username && String(body.username).trim().toLowerCase() !== req.user.username) {
      const cleanU = String(body.username).trim().toLowerCase();
      const existingU = await User.findOne({ username: cleanU, _id: { $ne: req.user._id } });
      if (existingU) {
        return res.status(409).json({ error: 'That username is already taken.' });
      }
      userUpdate.username = cleanU;
    }

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      userUpdate,
      { new: true }
    ).lean();

    if (body.goal && Number(body.goal) > 0) {
      const g = Number(body.goal);
      const active = await OJTRequirement.findOne({ userId: req.user._id, status: 'ACTIVE' });
      if (active) {
        await OJTRequirement.updateOne({ _id: active._id }, { targetHours: g });
      } else {
        await OJTRequirement.create({
          userId: req.user._id,
          name: 'OJT 1',
          targetHours: g,
          startDate: new Date().toISOString().slice(0, 10),
          status: 'ACTIVE',
        });
      }
    }

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'UPDATE_SETTINGS',
      details: { updatedKeys: Object.keys(body) },
    });

    const activeOjt = await OJTRequirement.findOne({ userId: req.user._id, status: 'ACTIVE' }).lean();
    return res.json({ user: toUserDTO(updated, activeOjt) });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// PUT /api/users/me/password
router.put('/me/password', async (req, res) => {
  try {
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body || {};
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'All password fields are required.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    if (String(newPassword) !== String(confirmPassword)) {
      return res.status(400).json({ error: 'New passwords do not match.' });
    }

    const user = await User.findById(req.user._id);
    const isCorrect = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!isCorrect) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await user.save();

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'CHANGE_PASSWORD',
      details: {},
    });

    return res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password.' });
  }
});

// ─── ADMIN ROUTES ───

// GET /api/users/admin/stats
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const allUsers = await User.find({ role: 'user' }).lean();
    const allRecords = await DTRRecord.find({ deletedAt: null }).lean();
    const allOjts = await OJTRequirement.find().lean();

    let totalLoggedMins = 0;
    for (const r of allRecords) {
      totalLoggedMins += Math.round((r.hours || 0) * 60);
    }
    const totalHours = Math.round((totalLoggedMins / 60) * 10) / 10;

    let totalPctSum = 0;
    for (const u of allUsers) {
      const userRecords = allRecords.filter(r => String(r.userId) === String(u._id));
      const userOjt = allOjts.find(o => String(o.userId) === String(u._id) && o.status === 'ACTIVE')
        || allOjts.find(o => String(o.userId) === String(u._id));
      const target = userOjt?.targetHours || 300;
      const userMins = userRecords.reduce((sum, r) => sum + Math.round((r.hours || 0) * 60), 0);
      const pct = Math.min(100, Math.round((userMins / (target * 60)) * 100));
      totalPctSum += pct;
    }

    const avgProgress = allUsers.length ? Math.round(totalPctSum / allUsers.length) : 0;

    return res.json({
      totalUsers: allUsers.length,
      totalHours,
      avgProgress,
      totalRecords: allRecords.length,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: 'Failed to fetch admin statistics.' });
  }
});

// GET /api/users/admin/users
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    const allRecords = await DTRRecord.find({ deletedAt: null }).lean();
    const allOjts = await OJTRequirement.find().lean();

    const result = users.map(u => {
      const userRecords = allRecords.filter(r => String(r.userId) === String(u._id));
      const userOjts = allOjts.filter(o => String(o.userId) === String(u._id));
      const activeOjt = userOjts.find(o => o.status === 'ACTIVE') || userOjts[0] || null;

      const targetHours = activeOjt?.targetHours || 300;
      const userSettings = u.settings || {};
      const totals = calcOjtTotals(userRecords, targetHours, userSettings);

      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        studentId: u.studentId || '',
        school: u.school || '',
        course: u.course || '',
        company: u.company || '',
        department: u.department || '',
        supervisor: u.supervisor || '',
        isEmailVerified: Boolean(u.isEmailVerified),
        activeOjt: activeOjt ? {
          id: String(activeOjt._id),
          name: activeOjt.name,
          targetHours: activeOjt.targetHours,
          status: activeOjt.status,
        } : null,
        stats: {
          totalHours: totals.totalCreditedHours,
          regularHours: totals.regularHours,
          overtimeHours: totals.overtimeHours,
          remainingHours: totals.remainingHours,
          progressPct: totals.progressPct,
          isCompleted: totals.isCompleted,
          entriesCount: userRecords.length,
        },
        settings: u.settings,
        createdAt: u.createdAt,
      };
    });

    return res.json({ users: result });
  } catch (err) {
    console.error('Admin list users error:', err);
    return res.status(500).json({ error: 'Failed to fetch user directory.' });
  }
});

// POST /api/users/admin/users
router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      username = '',
      password = '',
      role = 'user',
      studentId = '',
      school = '',
      course = '',
      company = '',
      department = '',
      supervisor = '',
      targetHours = 300,
      dailyHours = 8,
    } = req.body || {};

    const cleanName = String(name).trim();
    const cleanUsername = String(username).trim().toLowerCase();
    const cleanPass = String(password);
    const cleanEmail = String(email).trim().toLowerCase() || `${cleanUsername}@dtr.local`;

    if (!cleanName || !cleanUsername || !cleanPass) {
      return res.status(400).json({ error: 'Name, username, and password are required.' });
    }

    const existing = await User.findOne({ username: cleanUsername });
    if (existing) return res.status(409).json({ error: 'Username already exists.' });

    const passwordHash = await bcrypt.hash(cleanPass, 10);
    const created = await User.create({
      name: cleanName,
      email: cleanEmail,
      username: cleanUsername,
      passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
      studentId: String(studentId).trim(),
      school: String(school).trim(),
      course: String(course).trim(),
      company: String(company).trim(),
      department: String(department).trim(),
      supervisor: String(supervisor).trim(),
      isEmailVerified: true,
      settings: {
        dailyHours: Number(dailyHours) || 8,
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

    const ojt = await OJTRequirement.create({
      userId: created._id,
      name: 'OJT 1 - Practicum',
      targetHours: Number(targetHours) || 300,
      startDate: new Date().toISOString().slice(0, 10),
      status: 'ACTIVE',
    });

    await AuditLog.create({
      userId: created._id,
      performedBy: req.user._id,
      performedByRole: 'admin',
      action: 'ADMIN_CREATE_USER',
      details: { createdUsername: cleanUsername, targetHours },
    });

    return res.status(201).json({ user: toUserDTO(created, ojt) });
  } catch (err) {
    console.error('Admin create user error:', err);
    return res.status(500).json({ error: 'Failed to create user account.' });
  }
});

// PUT /api/users/admin/users/:id
router.put('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const {
      name,
      email,
      studentId,
      school,
      course,
      company,
      department,
      supervisor,
      role,
      targetHours,
      dailyHours,
    } = req.body || {};

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (email !== undefined) update.email = String(email).trim().toLowerCase();
    if (studentId !== undefined) update.studentId = String(studentId).trim();
    if (school !== undefined) update.school = String(school).trim();
    if (course !== undefined) update.course = String(course).trim();
    if (company !== undefined) update.company = String(company).trim();
    if (department !== undefined) update.department = String(department).trim();
    if (supervisor !== undefined) update.supervisor = String(supervisor).trim();
    if (role !== undefined && ['user', 'admin'].includes(role)) update.role = role;

    if (dailyHours !== undefined) {
      update['settings.dailyHours'] = Number(dailyHours);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true }).lean();

    if (targetHours !== undefined) {
      const activeOjt = await OJTRequirement.findOne({ userId: target._id, status: 'ACTIVE' });
      if (activeOjt) {
        await OJTRequirement.findOneAndUpdate({ _id: activeOjt._id }, { targetHours: Number(targetHours) });
      }
    }

    await AuditLog.create({
      userId: target._id,
      performedBy: req.user._id,
      performedByRole: 'admin',
      action: 'ADMIN_UPDATE_USER',
      details: { targetUsername: target.username, updates: Object.keys(update) },
    });

    return res.json({ ok: true, user: updated });
  } catch (err) {
    console.error('Admin update user error:', err);
    return res.status(500).json({ error: 'Failed to update user.' });
  }
});

// PUT /api/users/admin/users/:id/reset-password
router.put('/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { newPassword = '', confirmPassword = '' } = req.body || {};
    const cleanPass = String(newPassword);

    if (!cleanPass || cleanPass.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (cleanPass !== String(confirmPassword)) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    target.passwordHash = await bcrypt.hash(cleanPass, 10);
    await target.save();

    await AuditLog.create({
      userId: target._id,
      performedBy: req.user._id,
      performedByRole: 'admin',
      action: 'ADMIN_RESET_PASSWORD',
      details: { targetUsername: target.username },
    });

    return res.json({ ok: true, message: `Password reset successfully for @${target.username}.` });
  } catch (err) {
    console.error('Admin reset password error:', err);
    return res.status(500).json({ error: 'Failed to reset user password.' });
  }
});

// DELETE /api/users/admin/users/:id
router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ error: 'You cannot delete your own administrative account.' });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await User.findByIdAndDelete(req.params.id);
    await DTRRecord.deleteMany({ userId: req.params.id });

    await AuditLog.create({
      userId: target._id,
      performedBy: req.user._id,
      performedByRole: 'admin',
      action: 'ADMIN_DELETE_USER',
      details: { deletedUsername: target.username },
    });

    return res.json({ ok: true, message: `User @${target.username} has been removed.` });
  } catch (err) {
    console.error('Admin delete user error:', err);
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// GET /api/users/admin/users/:id/dtr
router.get('/admin/users/:id/dtr', requireAdmin, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id).lean();
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });

    const records = await DTRRecord.find({ userId: targetUser._id, deletedAt: null }).sort({ workDate: -1, timeIn: -1 }).lean();
    const ojts = await OJTRequirement.find({ userId: targetUser._id }).lean();
    const activeOjt = ojts.find(o => o.status === 'ACTIVE') || ojts[0] || null;

    const totals = calcOjtTotals(records, activeOjt?.targetHours || 300, targetUser.settings || {});

    return res.json({
      user: toUserDTO(targetUser, activeOjt),
      ojts,
      records,
      totals,
    });
  } catch (err) {
    console.error('Admin get user DTR error:', err);
    return res.status(500).json({ error: 'Failed to retrieve attendance records for user.' });
  }
});

// PUT /api/users/admin/users/:id/dtr/:entryId
router.put('/admin/users/:id/dtr/:entryId', requireAdmin, async (req, res) => {
  try {
    const { workDate, timeIn, timeOut, note } = req.body || {};
    const record = await DTRRecord.findOne({ _id: req.params.entryId, userId: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ error: 'DTR record not found.' });

    const targetUser = await User.findById(req.params.id).lean();
    const update = { updatedBy: req.user._id };

    if (workDate) {
      if (isFutureDate(workDate)) return res.status(400).json({ error: 'Future dates cannot be used for DTR entries.' });
      update.workDate = workDate;
    }
    const newIn = timeIn !== undefined ? String(timeIn).trim() : record.timeIn;
    const newOut = timeOut !== undefined ? String(timeOut).trim() : record.timeOut;

    if (timeIn !== undefined || timeOut !== undefined) {
      const calc = calcEntryCreditedDuration({ timeIn: newIn, timeOut: newOut }, targetUser?.settings || {});
      update.timeIn = newIn;
      update.timeOut = newOut;
      update.hours = calc.creditedHours;
    }
    if (note !== undefined) update.note = String(note).trim();

    const updated = await DTRRecord.findOneAndUpdate(
      { _id: req.params.entryId },
      update,
      { new: true }
    ).lean();

    await AuditLog.create({
      userId: req.params.id,
      performedBy: req.user._id,
      performedByRole: 'admin',
      action: 'ADMIN_UPDATE_DTR',
      details: {
        recordId: req.params.entryId,
        targetUsername: targetUser?.username,
        updates: update,
      },
    });

    return res.json({ record: updated });
  } catch (err) {
    console.error('Admin update user DTR error:', err);
    return res.status(500).json({ error: 'Failed to update record.' });
  }
});

// DELETE /api/users/admin/users/:id/dtr/:entryId (ADMIN SOFT-DELETE)
router.delete('/admin/users/:id/dtr/:entryId', requireAdmin, async (req, res) => {
  try {
    const record = await DTRRecord.findOne({ _id: req.params.entryId, userId: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ error: 'DTR record not found.' });

    await DTRRecord.findOneAndUpdate(
      { _id: req.params.entryId },
      { deletedAt: new Date(), deletedBy: req.user._id }
    );

    const targetUser = await User.findById(req.params.id).lean();
    await AuditLog.create({
      userId: req.params.id,
      performedBy: req.user._id,
      performedByRole: 'admin',
      action: 'ADMIN_DELETE_DTR',
      details: {
        recordId: req.params.entryId,
        targetUsername: targetUser?.username,
        workDate: record.workDate,
      },
    });

    return res.json({ ok: true, message: 'DTR entry soft-deleted by administrator.' });
  } catch (err) {
    console.error('Admin delete user DTR error:', err);
    return res.status(500).json({ error: 'Failed to delete record.' });
  }
});

// GET /api/users/admin/audit-logs
router.get('/admin/audit-logs', requireAdmin, async (req, res) => {
  try {
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ logs });
  } catch (err) {
    console.error('Admin audit logs error:', err);
    return res.status(500).json({ error: 'Failed to retrieve audit trail.' });
  }
});

export default router;
