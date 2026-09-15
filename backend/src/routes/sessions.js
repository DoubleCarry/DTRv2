import dtrRouter from './dtr.js';

/**
 * Backward compatibility route wrapper:
 * Routes `/api/sessions/*` requests through the `/api/dtr` router.
 */
export default dtrRouter;
