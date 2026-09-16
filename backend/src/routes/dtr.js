import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { DTRRecord } from '../models/DTRRecord.js';
import { OJTRequirement } from '../models/OJTRequirement.js';
import { AuditLog } from '../models/AuditLog.js';
import {
  isFutureDate,
  calcRawDurationMins,
  calcEntryCreditedDuration,
  aggregateDayEntries,
  calcOjtTotals,
  predictCompletion,
} from '../utils/calcEngine.js';

const router = express.Router();
router.use(requireAuth);

// Helper to get active or fallback OJT for user
async function resolveOjtId(userId, requestedOjtId = null) {
  if (requestedOjtId) {
    const ojt = await OJTRequirement.findOne({ _id: requestedOjtId, userId }).lean();
    if (ojt) return ojt._id;
  }
  const active = await OJTRequirement.findOne({ userId, status: 'ACTIVE' }).lean();
  if (active) return active._id;

  const anyOjt = await OJTRequirement.findOne({ userId }).lean();
  if (anyOjt) return anyOjt._id;

  // Provision fallback OJT if none exists
  const created = await OJTRequirement.create({
    userId,
    name: 'OJT 1',
    targetHours: 300,
    startDate: new Date().toISOString().slice(0, 10),
    status: 'ACTIVE',
  });
  return created._id;
}

// GET /api/dtr
router.get('/', async (req, res) => {
  try {
    const { ojtId, startDate, endDate } = req.query;
    const query = { userId: req.user._id, deletedAt: null };

    if (ojtId) {
      query.ojtRequirementId = ojtId;
    }
    if (startDate) {
      query.startDate = String(startDate);
    }
    if (endDate) {
      query.endDate = String(endDate);
    }

    const records = await DTRRecord.find(query).sort({ workDate: -1, timeIn: -1 }).lean();
    const userSettings = req.user.settings || {};

    // Get current OJT requirement for target hours & status
    let currentOjt = null;
    if (ojtId) {
      currentOjt = await OJTRequirement.findOne({ _id: ojtId, userId: req.user._id }).lean();
    }
    if (!currentOjt) {
      currentOjt = await OJTRequirement.findOne({ userId: req.user._id, status: 'ACTIVE' }).lean();
    }
    if (!currentOjt) {
      currentOjt = await OJTRequirement.findOne({ userId: req.user._id }).lean();
    }

    const targetHours = currentOjt?.targetHours || 300;
    const totals = calcOjtTotals(records, targetHours, userSettings);
    const forecast = predictCompletion(records, targetHours, userSettings, []);

    return res.json({
      records,
      sessions: records,
      totals,
      forecast,
      ojt: currentOjt,
    });
  } catch (err) {
    console.error('Fetch DTR error:', err);
    return res.status(500).json({ error: 'Unable to retrieve attendance records.' });
  }
});

// POST /api/dtr
router.post('/', async (req, res) => {
  try {
    const {
      workDate = '',
      date = '',
      timeIn = '',
      timeOut = '',
      ojtRequirementId,
      note = '',
      source = 'manual',
    } = req.body || {};

    const cleanDate = String(workDate || date).trim();
    const cleanIn = String(timeIn).trim();
    const cleanOut = String(timeOut).trim();

    if (!cleanDate) {
      return res.status(400).json({ error: 'Date is required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      return res.status(400).json({ error: 'Date must be formatted as YYYY-MM-DD.' });
    }

    // Critical validation: Future dates are strictly prohibited in Asia/Manila
    if (isFutureDate(cleanDate)) {
      return res.status(400).json({ error: 'Future dates cannot be used for DTR entries.' });
    }

    const isAbsent = Boolean(req.body.absent || req.body.isAbsent || cleanIn === '--' || cleanOut === '--');
    const ojtId = await resolveOjtId(req.user._id, ojtRequirementId);

    if (isAbsent) {
      const created = await DTRRecord.create({
        userId: req.user._id,
        ojtRequirementId: ojtId,
        workDate: cleanDate,
        timeIn: '--',
        timeOut: '--',
        hours: 0,
        regularHours: 0,
        overtimeHours: 0,
        lateMinutes: 0,
        undertimeMinutes: 0,
        absent: true,
        note: String(note || 'Absent').trim(),
        source: ['manual', 'import', 'admin'].includes(source) ? source : 'manual',
        createdBy: req.user._id,
        updatedBy: req.user._id,
        deletedAt: null,
        deletedBy: null,
      });

      await AuditLog.create({
        userId: req.user._id,
        performedBy: req.user._id,
        performedByRole: req.user.role,
        action: 'CREATE_DTR',
        details: {
          recordId: created._id,
          workDate: cleanDate,
          absent: true,
        },
      });

      return res.status(201).json({ record: created, session: created });
    }

    if (!cleanIn || !cleanOut || cleanIn === '--' || cleanOut === '--') {
      return res.status(400).json({ error: 'Both Time In and Time Out are required.' });
    }

    if (!/^\d{1,2}:\d{2}$/.test(cleanIn) || !/^\d{1,2}:\d{2}$/.test(cleanOut)) {
      return res.status(400).json({ error: 'Time must be in valid HH:MM format.' });
    }

    // Calculate durations using user's settings
    const userSettings = req.user.settings || {};
    const rawDurationMins = calcRawDurationMins(cleanIn, cleanOut);
    if (rawDurationMins === 0) {
      return res.status(400).json({ error: 'Time In and Time Out cannot be identical.' });
    }

    const calc = calcEntryCreditedDuration({ timeIn: cleanIn, timeOut: cleanOut }, userSettings);

    const created = await DTRRecord.create({
      userId: req.user._id,
      ojtRequirementId: ojtId,
      workDate: cleanDate,
      timeIn: cleanIn,
      timeOut: cleanOut,
      hours: calc.creditedHours,
      absent: false,
      note: String(note || '').trim(),
      source: ['manual', 'import', 'admin'].includes(source) ? source : 'manual',
      createdBy: req.user._id,
      updatedBy: req.user._id,
      deletedAt: null,
      deletedBy: null,
    });

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'CREATE_DTR',
      details: {
        recordId: created._id,
        workDate: cleanDate,
        timeIn: cleanIn,
        timeOut: cleanOut,
        creditedHours: calc.creditedHours,
      },
    });

    return res.status(201).json({ record: created, session: created });
  } catch (err) {
    console.error('Create DTR error:', err);
    return res.status(500).json({ error: 'Unable to save DTR entry. Please check your connection and try again.' });
  }
});

// POST /api/dtr/check-duplicates
router.post('/check-duplicates', async (req, res) => {
  try {
    const { rows = [] } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) {
      return res.json({ duplicates: [] });
    }

    const dates = [...new Set(rows.map(r => r.workDate).filter(Boolean))];
    const existing = await DTRRecord.find({
      userId: req.user._id,
      deletedAt: null,
    }).lean();

    const existingMap = new Map();
    for (const r of existing) {
      const key = `${r.workDate}_${r.timeIn}_${r.timeOut}`;
      existingMap.set(key, r);
    }

    const duplicates = [];
    rows.forEach((row, index) => {
      const key = `${row.workDate}_${row.timeIn}_${row.timeOut}`;
      if (existingMap.has(key)) {
        duplicates.push({
          index,
          row,
          existingRecord: existingMap.get(key),
        });
      }
    });

    return res.json({ duplicates });
  } catch (err) {
    console.error('Check duplicates error:', err);
    return res.status(500).json({ error: 'Failed to verify duplicate records.' });
  }
});

// POST /api/dtr/bulk
router.post('/bulk', async (req, res) => {
  try {
    const {
      records = [],
      ojtRequirementId,
      duplicateMode = 'skip', // 'skip' | 'replace' | 'keep_both'
    } = req.body || {};

    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'No records provided for import.' });
    }

    const ojtId = await resolveOjtId(req.user._id, ojtRequirementId);
    const userSettings = req.user.settings || {};

    // Fetch existing active records for duplicate checking
    const existing = await DTRRecord.find({
      userId: req.user._id,
      deletedAt: null,
    }).lean();

    const existingMap = new Map();
    for (const r of existing) {
      const key = `${r.workDate}_${r.timeIn}_${r.timeOut}`;
      existingMap.set(key, r);
    }

    const toInsert = [];
    let skippedCount = 0;
    let replacedCount = 0;

    for (const item of records) {
      const date = String(item.workDate || '').trim();
      const timeIn = String(item.timeIn || '').trim();
      const timeOut = String(item.timeOut || '').trim();

      // Skip invalid items or future dates
      if (!date || isFutureDate(date) || !timeIn || !timeOut || timeIn === '--' || timeOut === '--') {
        continue;
      }

      const key = `${date}_${timeIn}_${timeOut}`;
      const existingRecord = existingMap.get(key);

      if (existingRecord) {
        if (duplicateMode === 'skip') {
          skippedCount++;
          continue;
        } else if (duplicateMode === 'replace') {
          // Soft delete the existing record
          await DTRRecord.findOneAndUpdate(
            { _id: existingRecord._id },
            { deletedAt: new Date(), deletedBy: req.user._id }
          );
          replacedCount++;
        }
      }

      const calc = calcEntryCreditedDuration({ timeIn, timeOut }, userSettings);
      toInsert.push({
        userId: req.user._id,
        ojtRequirementId: ojtId,
        workDate: date,
        timeIn,
        timeOut,
        hours: calc.creditedHours,
        note: String(item.note || '').trim(),
        source: 'import',
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
    }

    let inserted = [];
    if (toInsert.length > 0) {
      inserted = await DTRRecord.insertMany(toInsert);
    }

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'BULK_IMPORT_DTR',
      details: {
        totalSubmitted: records.length,
        insertedCount: inserted.length,
        skippedCount,
        replacedCount,
        duplicateMode,
      },
    });

    return res.status(201).json({
      ok: true,
      importedCount: inserted.length,
      skippedCount,
      replacedCount,
    });
  } catch (err) {
    console.error('Bulk import error:', err);
    return res.status(500).json({ error: 'Unable to complete bulk import. Please try again.' });
  }
});

// PUT /api/dtr/:id
router.put('/:id', async (req, res) => {
  try {
    const {
      workDate,
      date,
      timeIn,
      timeOut,
      note,
      ojtRequirementId,
      absent,
    } = req.body || {};

    const existing = await DTRRecord.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null,
    });

    if (!existing) {
      return res.status(404).json({ error: 'DTR entry not found.' });
    }

    const update = { updatedBy: req.user._id };
    const dateInput = workDate !== undefined ? workDate : date;

    if (dateInput !== undefined) {
      const cleanDate = String(dateInput).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        return res.status(400).json({ error: 'Date must be formatted as YYYY-MM-DD.' });
      }
      if (isFutureDate(cleanDate)) {
        return res.status(400).json({ error: 'Future dates cannot be used for DTR entries.' });
      }
      update.workDate = cleanDate;
    }

    const newTimeIn = timeIn !== undefined ? String(timeIn).trim() : existing.timeIn;
    const newTimeOut = timeOut !== undefined ? String(timeOut).trim() : existing.timeOut;
    const isAbsent = absent !== undefined
      ? Boolean(absent)
      : (newTimeIn === '--' || newTimeOut === '--');

    if (isAbsent) {
      update.absent = true;
      update.timeIn = '--';
      update.timeOut = '--';
      update.hours = 0;
      update.regularHours = 0;
      update.overtimeHours = 0;
      update.lateMinutes = 0;
      update.undertimeMinutes = 0;
    } else if (timeIn !== undefined || timeOut !== undefined || absent === false) {
      if (!newTimeIn || !newTimeOut || newTimeIn === '--' || newTimeOut === '--') {
        return res.status(400).json({ error: 'Both Time In and Time Out are required.' });
      }
      const rawDuration = calcRawDurationMins(newTimeIn, newTimeOut);
      if (rawDuration === 0) {
        return res.status(400).json({ error: 'Time In and Time Out cannot be identical.' });
      }
      update.absent = false;
      update.timeIn = newTimeIn;
      update.timeOut = newTimeOut;

      const userSettings = req.user.settings || {};
      const calc = calcEntryCreditedDuration({ timeIn: newTimeIn, timeOut: newTimeOut }, userSettings);
      update.hours = calc.creditedHours;
    }

    if (note !== undefined) update.note = String(note).trim();
    if (ojtRequirementId !== undefined) {
      const ojt = await OJTRequirement.findOne({ _id: ojtRequirementId, userId: req.user._id });
      if (ojt) update.ojtRequirementId = ojt._id;
    }

    const updated = await DTRRecord.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { new: true }
    ).lean();

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'UPDATE_DTR',
      details: { recordId: req.params.id, updates: update },
    });

    return res.json({ record: updated, session: updated });
  } catch (err) {
    console.error('Update DTR error:', err);
    return res.status(500).json({ error: 'Unable to update DTR entry.' });
  }
});

// DELETE /api/dtr/:id (SOFT DELETE)
router.delete('/:id', async (req, res) => {
  try {
    const existing = await DTRRecord.findOne({
      _id: req.params.id,
      userId: req.user._id,
      deletedAt: null,
    });

    if (!existing) {
      return res.status(404).json({ error: 'DTR entry not found.' });
    }

    // SOFT DELETE: Set deletedAt and deletedBy instead of permanent deletion
    await DTRRecord.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { deletedAt: new Date(), deletedBy: req.user._id }
    );

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'SOFT_DELETE_DTR',
      details: {
        recordId: req.params.id,
        workDate: existing.workDate,
        timeIn: existing.timeIn,
        timeOut: existing.timeOut,
      },
    });

    return res.json({ ok: true, message: 'DTR entry deleted.' });
  } catch (err) {
    console.error('Delete DTR error:', err);
    return res.status(500).json({ error: 'Unable to delete DTR entry.' });
  }
});

// DELETE /api/dtr (Soft delete all for active user or specific OJT)
router.delete('/', async (req, res) => {
  try {
    const { ojtId } = req.query;
    const query = { userId: req.user._id, deletedAt: null };
    if (ojtId) query.ojtRequirementId = ojtId;

    const activeList = await DTRRecord.find(query).lean();
    for (const r of activeList) {
      await DTRRecord.findOneAndUpdate(
        { _id: r._id },
        { deletedAt: new Date(), deletedBy: req.user._id }
      );
    }

    await AuditLog.create({
      userId: req.user._id,
      performedBy: req.user._id,
      performedByRole: req.user.role,
      action: 'SOFT_DELETE_ALL_DTR',
      details: { count: activeList.length, ojtId: ojtId || 'all' },
    });

    return res.json({ ok: true, count: activeList.length });
  } catch (err) {
    console.error('Clear DTR error:', err);
    return res.status(500).json({ error: 'Unable to clear DTR records.' });
  }
});

export default router;
