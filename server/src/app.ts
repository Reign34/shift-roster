import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { migrate } from './db.ts';
import { authRoutes } from './routes/auth.ts';
import { staffRoutes } from './routes/staff.ts';
import { scheduleRoutes } from './routes/schedules.ts';
import { availabilityRoutes } from './routes/availability.ts';
import { swapRoutes } from './routes/swaps.ts';

// Building the app is separate from listening on a port, so the tests can
// start it on a throwaway port without the real server also coming up.
export function createApp(): Express {
  migrate();

  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => { res.json({ ok: true }); });

  app.use('/api/auth', authRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/schedules', scheduleRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/swaps', swapRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'No such endpoint' });
  });

  // Express only recognises this as an error handler with all four arguments
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (process.env.NODE_ENV !== 'test') console.error(err);
    // The real message could name a table or a path, so it stays in the log
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
