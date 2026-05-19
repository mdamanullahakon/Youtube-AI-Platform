import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from '../../routes/auth.routes';
import { errorHandler } from '../../middleware/errorHandler';

export function createTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  return app;
}
