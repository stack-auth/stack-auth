import cors from 'cors';
import express from 'express';
import { authMiddleware } from './middleware/auth';
import { executeRouter } from './routes/execute';
import { checkVMStatus } from './services/vm-status';

const app = express();
const PORT = process.env.PORT || 8124;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.set('json spaces', 2);

// Health endpoint (no auth required)
app.get('/health', async (_req, res) => {
  const vmStatus = await checkVMStatus();
  res.json({
    status: 'ok',
    app: 'running',
    vm: vmStatus,
    environment: {
      node_env: process.env.NODE_ENV,
      port: PORT,
      ssh_port: process.env.SSH_PORT || 10022,
    }
  });
});

// Serial console endpoint (no auth required for debugging)
app.get('/serial-console', async (_req, res) => {
  const { getVMSerialConsole } = await import('./services/vm-status.js');
  const serialLog = await getVMSerialConsole();
  res.type('text/plain').send(serialLog);
});

// Apply auth middleware for all other routes
app.use(authMiddleware);
app.use(executeRouter);

app.listen(PORT, () => {
  // Server started on port ${PORT}
});
