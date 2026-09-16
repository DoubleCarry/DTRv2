import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { User, MongoUser } from '../models/User.js';
import { inMemoryUsers } from '../models/inMemoryStore.js';

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const secret = process.env.JWT_SECRET || 'dtr-secret-fallback-key-2025';
    const payload = jwt.verify(token, secret);
    const sub = String(payload.sub || '');
    if (!sub) return res.status(401).json({ error: 'Invalid token subject' });

    let user = null;
    if (mongoose.connection?.readyState === 1 && mongoose.isValidObjectId(sub)) {
      user = await MongoUser.findById(sub).lean().catch(() => null);
    }

    // If not found by ObjectId or sub is a string ID (e.g. u_admin, u_john, admin)
    if (!user) {
      user = await User.findOne({
        $or: [{ _id: sub }, { username: sub.replace(/^u_/, '') }, { username: sub }],
      }).lean().catch(() => null);
    }

    // Check in-memory map as fallback
    if (!user) {
      const mem = inMemoryUsers.get(sub) ||
                  inMemoryUsers.get(`u_${sub}`) ||
                  Array.from(inMemoryUsers.values()).find(u => u.username === sub || u.username === sub.replace(/^u_/, ''));
      if (mem) {
        user = typeof mem.lean === 'function' ? mem.lean() : { ...mem };
      }
    }

    if (!user) return res.status(401).json({ error: 'Invalid token user' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

