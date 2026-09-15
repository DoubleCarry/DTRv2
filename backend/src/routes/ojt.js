import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { OJTRequirement } from '../models/OJTRequirement.js';
import { DTRRecord } from '../models/DTRRecord.js';
import { AuditLog } from '../models/AuditLog.js';
import { calcOjtTotals } from '../utils/calcEngine.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/ojt
router.get('/', async (req, res) => {
  try {
    const list = await OJTRequirement.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    const records = await DTRRecord.find({ userId: req.user._id, deletedAt: null }).lean();

    // Attach calculated totals to each OJT
    const userSettings = req.user.settings || {};
    const enhancedList = list.map(ojt => {
      const ojtRecords = records.filter(r => String(r.ojtRequirementId) === String(ojt._id));
      const totals = calcOjtTotals(ojtRecords, ojt.targetHours, userSettings);
      return {
        ...ojt,
        totals,
      };
    });

    return res.json({ ojts: enhancedList });
  } catch (err) {
    console.error('List OJTs error:', err);
    return res.status(500).json({ error: 'Failed to load OJT requirements.' });
  }
});

// POST /api/ojt
router.post('/', async (req, res) => {
  try {
    const { name = '', targetHours = 300, startDate = '', status = 'ACTIVE' } = req.body || {};
    const cleanName = String(name).trim();
    const cleanTarget = Number(targetHours);

    if (!cleanName) {
      return res.status(400).json({ error: 'OJT Requirement name is required.' });
    }
    if (isNaN(cleanTarget) || cleanTarget < 1) {
      return res.status(400).json({ error: 'Target hours must be at least 1 hour.' });
    }

    // If making active, ensure only one active at a time
    if (status === 'ACTIVE') {
      const existingActive = await OJTRequirement.find({ userId: req.user._id, status: 'ACTIVE' }).lean();
      for (const item of existingActive) {
        await OJTRequirement.findOneAndUpdate({ _id: item._id, userId: req.user._id }, { status: 'COMPLETED' });
      }
    }

    const created = await OJTRequirement.create({
      userId: req.user._id,
      name: cleanName,
      targetHours: cleanTarget,
      startDate: String(startDate || new Date().toISOString().slice(0, 10)),
      status: ['ACTIVE', 'COMPLETED', 'ARCHIVED'].includes(status) ? status : 'ACTIVE',
    });

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'CREATE_OJT_REQUIREMENT',
      details: { ojtId: created._id, name: cleanName, targetHours: cleanTarget },
    });

    return res.status(201).json({ ojt: created });
  } catch (err) {
    console.error('Create OJT error:', err);
    return res.status(500).json({ error: 'Failed to create OJT requirement.' });
  }
});

// PUT /api/ojt/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, targetHours, startDate, status } = req.body || {};
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (targetHours !== undefined) {
      const t = Number(targetHours);
      if (isNaN(t) || t < 1) return res.status(400).json({ error: 'Target hours must be at least 1.' });
      update.targetHours = t;
    }
    if (startDate !== undefined) update.startDate = String(startDate);
    if (status !== undefined && ['ACTIVE', 'COMPLETED', 'ARCHIVED'].includes(status)) {
      update.status = status;
      if (status === 'ACTIVE') {
        const others = await OJTRequirement.find({ userId: req.user._id, status: 'ACTIVE' }).lean();
        for (const item of others) {
          if (String(item._id) !== String(req.params.id)) {
            await OJTRequirement.findOneAndUpdate({ _id: item._id, userId: req.user._id }, { status: 'COMPLETED' });
          }
        }
      }
    }

    const updated = await OJTRequirement.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ error: 'OJT Requirement not found.' });
    }

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'UPDATE_OJT_REQUIREMENT',
      details: { ojtId: updated._id, updates: update },
    });

    return res.json({ ojt: updated });
  } catch (err) {
    console.error('Update OJT error:', err);
    return res.status(500).json({ error: 'Failed to update OJT requirement.' });
  }
});

// POST /api/ojt/:id/activate
router.post('/:id/activate', async (req, res) => {
  try {
    const target = await OJTRequirement.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!target) return res.status(404).json({ error: 'OJT Requirement not found.' });

    // Mark other active ones as COMPLETED
    const others = await OJTRequirement.find({ userId: req.user._id, status: 'ACTIVE' }).lean();
    for (const item of others) {
      if (String(item._id) !== String(req.params.id)) {
        await OJTRequirement.findOneAndUpdate({ _id: item._id, userId: req.user._id }, { status: 'COMPLETED' });
      }
    }

    const activated = await OJTRequirement.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { status: 'ACTIVE' },
      { new: true }
    ).lean();

    return res.json({ ok: true, ojt: activated });
  } catch (err) {
    console.error('Activate OJT error:', err);
    return res.status(500).json({ error: 'Failed to activate OJT requirement.' });
  }
});

// DELETE /api/ojt/:id
router.delete('/:id', async (req, res) => {
  try {
    const target = await OJTRequirement.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!target) return res.status(404).json({ error: 'OJT Requirement not found.' });

    // Check if there are active DTR records linked to it
    const linkedRecords = await DTRRecord.find({
      userId: req.user._id,
      ojtRequirementId: target._id,
      deletedAt: null,
    }).lean();

    if (linkedRecords.length > 0) {
      // Instead of hard deleting, archive it safely so historical data is preserved
      await OJTRequirement.findOneAndUpdate({ _id: target._id }, { status: 'ARCHIVED' });
      return res.json({ ok: true, archived: true, message: 'OJT has linked attendance records and was archived.' });
    }

    await OJTRequirement.findOneAndDelete({ _id: target._id, userId: req.user._id });
    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'DELETE_OJT_REQUIREMENT',
      details: { ojtId: target._id, name: target.name },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete OJT error:', err);
    return res.status(500).json({ error: 'Failed to delete OJT requirement.' });
  }
});

export default router;
