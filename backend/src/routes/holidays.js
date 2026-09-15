import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Holiday } from '../models/Holiday.js';
import { getPhilippineHolidays } from '../utils/calcEngine.js';

const router = express.Router();
router.use(requireAuth);

// GET /api/holidays
router.get('/', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const sysMap = getPhilippineHolidays(year);
    const systemHolidays = [];
    for (const [date, name] of sysMap.entries()) {
      systemHolidays.push({
        _id: `sys_${date}`,
        date,
        name,
        type: 'system',
      });
    }

    const customHolidays = await Holiday.find({
      $or: [{ userId: req.user._id }, { userId: null }],
    }).lean();

    const combined = [...systemHolidays, ...customHolidays].sort((a, b) => a.date.localeCompare(b.date));
    return res.json({ holidays: combined });
  } catch (err) {
    console.error('Fetch holidays error:', err);
    return res.status(500).json({ error: 'Failed to retrieve holiday list.' });
  }
});

// POST /api/holidays
router.post('/', async (req, res) => {
  try {
    const { date, name } = req.body || {};
    if (!date || !name) {
      return res.status(400).json({ error: 'Date and holiday name are required.' });
    }
    const created = await Holiday.create({
      userId: req.user._id,
      date: String(date).trim(),
      name: String(name).trim(),
      type: 'custom',
    });
    return res.status(201).json({ holiday: created });
  } catch (err) {
    console.error('Create holiday error:', err);
    return res.status(500).json({ error: 'Failed to create custom holiday.' });
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Holiday.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!deleted) {
      return res.status(404).json({ error: 'Custom holiday not found or cannot be deleted.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete holiday error:', err);
    return res.status(500).json({ error: 'Failed to delete holiday.' });
  }
});

export default router;
