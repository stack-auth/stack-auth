import { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const expectedSecret = process.env.JS_EXECUTION_ENGINE_SECRET;

  if (!expectedSecret) {
    console.error('JS_EXECUTION_ENGINE_SECRET not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}