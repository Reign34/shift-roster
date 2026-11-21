import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { migrate } from './db.js';
import { authRoutes } from './routes/auth.js';
import { staffRoutes } from './routes/staff.js';

migrate();

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRoutes);
app.use('/api/staff', staffRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'No such endpoint' });
});

// Express needs all four arguments to recognise this as an error handler,
// even though `next` goes unused.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // The real message could name a table or a file path, so it stays in the
  // log and the client gets something generic.
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
