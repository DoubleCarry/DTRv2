import express from 'express';
import dtrRouter from './dtr.js';

const router = express.Router();

// Forward /me and root to dtrRouter for backward compatibility with legacy frontends
router.use('/me', dtrRouter);
router.use('/', dtrRouter);

export default router;
