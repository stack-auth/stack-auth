import { Router } from 'express';
import { z } from 'zod';
import { executeScript } from '../services/executor';
import { downloadCheckpoint, uploadCheckpoint } from '../services/s3';

const executeRequestSchema = z.object({
  script: z.string(),
  engine: z.enum(['quickjs', 'hermes', 'nodejs']),
  checkpoint_storage_id: z.string().optional(),
});

export const executeRouter = Router();

executeRouter.post('/execute', async (req, res): Promise<void> => {
  try {
    const body = executeRequestSchema.parse(req.body);

    let checkpointData = null;
    if (body.checkpoint_storage_id) {
      checkpointData = await downloadCheckpoint(body.checkpoint_storage_id);
    }

    const { result, checkpoint } = await executeScript({
      script: body.script,
      engine: body.engine,
      checkpoint: checkpointData,
    });

    let checkpointStorageId = body.checkpoint_storage_id;
    let checkpointByteLength = 0;

    if (checkpoint) {
      checkpointStorageId = await uploadCheckpoint(checkpoint);
      checkpointByteLength = checkpoint.length;
    }

    res.json({
      result,
      checkpoint_byte_length: checkpointByteLength,
      checkpoint_storage_id: checkpointStorageId,
    });
  } catch (error) {
    console.error('Execution error:', error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Execution failed' });
  }
});
