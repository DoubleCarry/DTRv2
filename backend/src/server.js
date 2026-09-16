import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { app, initializeDatabase } from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

// Serve frontend static assets from root directory in local standalone mode
app.use(express.static(rootDir));

// SPA fallback for frontend routes in local standalone mode
app.get('*', (_req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

const port = Number(process.env.PORT || 3000);

initializeDatabase()
  .finally(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`DTR server running at http://0.0.0.0:${port}`);
    });
  });
