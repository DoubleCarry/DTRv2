import { app, initializeDatabase } from './app.js';

const port = Number(process.env.PORT || 3000);

initializeDatabase()
  .finally(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`DTR server running at http://0.0.0.0:${port}`);
    });
  });

