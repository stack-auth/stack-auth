const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Database connection configurations
const primaryPool = new Pool({
  host: process.env.PRIMARY_HOST || 'db',
  port: parseInt(process.env.PRIMARY_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'PASSWORD-PLACEHOLDER--uqfEC1hmmv',
  database: process.env.POSTGRES_DB || 'stackframe',
});

const replicaPool = new Pool({
  host: process.env.REPLICA_HOST || 'db-replica',
  port: parseInt(process.env.REPLICA_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'PASSWORD-PLACEHOLDER--uqfEC1hmmv',
  database: process.env.POSTGRES_DB || 'stackframe',
});

// Store for WAL changes (in-memory buffer)
const walChanges = [];
const MAX_WAL_CHANGES = 500;

// Store for LSN history
const lsnHistory = [];
const MAX_LSN_HISTORY = 100;

// Store for detailed lag history (for graphing)
const lagHistory = [];
const MAX_LAG_HISTORY = 3600; // 1 hour at 1 sample/sec

app.use(express.static('public'));
app.use(express.json());

// Helper to parse LSN to bytes for comparison
function lsnToBytes(lsn) {
  if (!lsn) return 0n;
  const [high, low] = lsn.split('/');
  return (BigInt(parseInt(high, 16)) << 32n) + BigInt(parseInt(low, 16));
}

// Helper to format bytes difference
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Get replication status from primary
async function getReplicationStatus() {
  try {
    const result = await primaryPool.query(`
      SELECT 
        client_addr,
        state,
        sent_lsn,
        write_lsn,
        flush_lsn,
        replay_lsn,
        write_lag,
        flush_lag,
        replay_lag,
        sync_state,
        reply_time
      FROM pg_stat_replication
    `);
    return result.rows;
  } catch (error) {
    console.error('Error getting replication status:', error.message);
    return [];
  }
}

// Get current WAL position from primary
async function getPrimaryWalPosition() {
  try {
    const result = await primaryPool.query(`
      SELECT 
        pg_current_wal_lsn() as current_lsn,
        pg_current_wal_insert_lsn() as insert_lsn,
        pg_walfile_name(pg_current_wal_lsn()) as current_wal_file
    `);
    return result.rows[0];
  } catch (error) {
    console.error('Error getting primary WAL position:', error.message);
    return null;
  }
}

// Get replica status
async function getReplicaStatus() {
  try {
    const result = await replicaPool.query(`
      SELECT 
        pg_is_in_recovery() as is_replica,
        pg_last_wal_receive_lsn() as receive_lsn,
        pg_last_wal_replay_lsn() as replay_lsn,
        pg_last_xact_replay_timestamp() as last_replay_timestamp,
        CASE 
          WHEN pg_last_xact_replay_timestamp() IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))
          ELSE NULL 
        END as replay_lag_seconds
    `);
    return result.rows[0];
  } catch (error) {
    console.error('Error getting replica status:', error.message);
    return null;
  }
}

// Get WAL receiver status from replica
async function getWalReceiverStatus() {
  try {
    const result = await replicaPool.query(`
      SELECT 
        status,
        receive_start_lsn,
        receive_start_tli,
        written_lsn,
        flushed_lsn,
        received_tli,
        last_msg_send_time,
        last_msg_receipt_time,
        sender_host,
        sender_port,
        conninfo
      FROM pg_stat_wal_receiver
    `);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting WAL receiver status:', error.message);
    return null;
  }
}

// Get replication slots from primary
async function getReplicationSlots() {
  try {
    const result = await primaryPool.query(`
      SELECT 
        slot_name,
        plugin,
        slot_type,
        database,
        active,
        restart_lsn,
        confirmed_flush_lsn,
        wal_status,
        safe_wal_size
      FROM pg_replication_slots
    `);
    return result.rows;
  } catch (error) {
    console.error('Error getting replication slots:', error.message);
    return [];
  }
}

// Create a logical replication slot for decoding (if not exists)
async function ensureDecodingSlot() {
  try {
    const checkResult = await primaryPool.query(`
      SELECT slot_name FROM pg_replication_slots WHERE slot_name = 'wal_info_decoder'
    `);
    
    if (checkResult.rows.length === 0) {
      await primaryPool.query(`
        SELECT pg_create_logical_replication_slot('wal_info_decoder', 'test_decoding')
      `);
      console.log('Created logical replication slot: wal_info_decoder');
    }
    return true;
  } catch (error) {
    console.error('Error ensuring decoding slot:', error.message);
    return false;
  }
}

// Get decoded WAL changes (SQL-like statements)
async function getDecodedWalChanges(limit = 100) {
  try {
    // Peek at changes without consuming them (so they can be replicated)
    const result = await primaryPool.query(`
      SELECT lsn, xid, data 
      FROM pg_logical_slot_peek_changes('wal_info_decoder', NULL, $1)
    `, [limit]);
    
    return result.rows.map(row => ({
      lsn: row.lsn,
      xid: row.xid,
      data: row.data,
      timestamp: new Date().toISOString() // Approximate timestamp
    }));
  } catch (error) {
    // Slot might not exist or logical decoding not enabled
    console.error('Error getting decoded WAL changes:', error.message);
    return [];
  }
}

// Consume and store decoded WAL changes
async function consumeDecodedWalChanges(limit = 50) {
  try {
    const result = await primaryPool.query(`
      SELECT lsn, xid, data 
      FROM pg_logical_slot_get_changes('wal_info_decoder', NULL, $1)
    `, [limit]);
    
    const now = new Date();
    for (const row of result.rows) {
      walChanges.push({
        lsn: row.lsn,
        xid: row.xid,
        data: row.data,
        primaryTimestamp: now.toISOString(),
        replicaTimestamp: null // Will be updated when we detect replica caught up
      });
      
      if (walChanges.length > MAX_WAL_CHANGES) {
        walChanges.shift();
      }
    }
    
    return result.rows.length;
  } catch (error) {
    console.error('Error consuming WAL changes:', error.message);
    return 0;
  }
}

// Record LSN history for both primary and replica
async function recordLsnHistory() {
  try {
    const primaryPos = await getPrimaryWalPosition();
    const replicaStatus = await getReplicaStatus();
    
    if (primaryPos && replicaStatus) {
      const now = new Date();
      const entry = {
        timestamp: now.toISOString(),
        primary: {
          currentLsn: primaryPos.current_lsn,
          insertLsn: primaryPos.insert_lsn
        },
        replica: {
          receiveLsn: replicaStatus.receive_lsn,
          replayLsn: replicaStatus.replay_lsn,
          replayLagSeconds: replicaStatus.replay_lag_seconds
        }
      };
      
      lsnHistory.push(entry);
      if (lsnHistory.length > MAX_LSN_HISTORY) {
        lsnHistory.shift();
      }
      
      // Record detailed lag history for graphing
      const lagSeconds = replicaStatus.replay_lag_seconds != null 
        ? parseFloat(replicaStatus.replay_lag_seconds) 
        : null;
      
      let lagBytes = null;
      if (primaryPos.current_lsn && replicaStatus.replay_lsn) {
        const primaryBytes = lsnToBytes(primaryPos.current_lsn);
        const replicaBytes = lsnToBytes(replicaStatus.replay_lsn);
        lagBytes = Number(primaryBytes - replicaBytes);
      }
      
      lagHistory.push({
        timestamp: now.getTime(),
        lagSeconds,
        lagBytes,
        primaryLsn: primaryPos.current_lsn,
        replicaLsn: replicaStatus.replay_lsn
      });
      
      if (lagHistory.length > MAX_LAG_HISTORY) {
        lagHistory.shift();
      }
      
      // Update replica timestamps for WAL changes that have been replayed
      if (replicaStatus.replay_lsn) {
        const replicaLsnBytes = lsnToBytes(replicaStatus.replay_lsn);
        const nowIso = now.toISOString();
        for (const change of walChanges) {
          if (!change.replicaTimestamp && lsnToBytes(change.lsn) <= replicaLsnBytes) {
            change.replicaTimestamp = nowIso;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error recording LSN history:', error.message);
  }
}

// Get recent activity from pg_stat_activity
async function getRecentActivity() {
  try {
    const result = await primaryPool.query(`
      SELECT 
        pid,
        usename,
        application_name,
        client_addr,
        state,
        query,
        backend_start,
        query_start,
        state_change
      FROM pg_stat_activity
      WHERE state != 'idle' OR query_start > now() - interval '5 minutes'
      ORDER BY query_start DESC NULLS LAST
      LIMIT 20
    `);
    return result.rows;
  } catch (error) {
    console.error('Error getting recent activity:', error.message);
    return [];
  }
}

// API Endpoints
app.get('/api/status', async (req, res) => {
  try {
    const [replicationStatus, primaryWal, replicaStatus, walReceiver, slots] = await Promise.all([
      getReplicationStatus(),
      getPrimaryWalPosition(),
      getReplicaStatus(),
      getWalReceiverStatus(),
      getReplicationSlots()
    ]);
    
    // Calculate lag in bytes
    let lagBytes = null;
    if (primaryWal && replicaStatus && primaryWal.current_lsn && replicaStatus.replay_lsn) {
      const primaryBytes = lsnToBytes(primaryWal.current_lsn);
      const replicaBytes = lsnToBytes(replicaStatus.replay_lsn);
      lagBytes = Number(primaryBytes - replicaBytes);
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      primary: {
        walPosition: primaryWal,
        replicationStatus: replicationStatus
      },
      replica: {
        status: replicaStatus,
        walReceiver: walReceiver
      },
      slots: slots,
      lagBytes: lagBytes,
      lagBytesFormatted: lagBytes !== null ? formatBytes(lagBytes) : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/wal-changes', async (req, res) => {
  res.json({
    changes: walChanges.slice(-100).reverse(),
    total: walChanges.length
  });
});

app.get('/api/lsn-history', async (req, res) => {
  res.json({
    history: lsnHistory,
    total: lsnHistory.length
  });
});

// Get aggregated lag history for graphing
app.get('/api/lag-graph', async (req, res) => {
  const bucketSizeMs = parseInt(req.query.bucketSize) || 5000; // 5 second buckets by default
  const maxBuckets = parseInt(req.query.maxBuckets) || 60;
  
  if (lagHistory.length === 0) {
    return res.json({ buckets: [], rawData: [] });
  }
  
  // Get the time range
  const now = Date.now();
  const startTime = now - (bucketSizeMs * maxBuckets);
  
  // Filter to relevant data
  const relevantData = lagHistory.filter(d => d.timestamp >= startTime);
  
  // Create buckets
  const buckets = [];
  for (let i = 0; i < maxBuckets; i++) {
    const bucketStart = startTime + (i * bucketSizeMs);
    const bucketEnd = bucketStart + bucketSizeMs;
    
    const bucketData = relevantData.filter(d => 
      d.timestamp >= bucketStart && d.timestamp < bucketEnd
    );
    
    if (bucketData.length > 0) {
      const lags = bucketData.map(d => d.lagSeconds).filter(l => l !== null);
      const lagBytesArr = bucketData.map(d => d.lagBytes).filter(l => l !== null);
      
      buckets.push({
        startTime: bucketStart,
        endTime: bucketEnd,
        count: bucketData.length,
        lagSeconds: lags.length > 0 ? {
          min: Math.min(...lags),
          max: Math.max(...lags),
          avg: lags.reduce((a, b) => a + b, 0) / lags.length,
          last: lags[lags.length - 1]
        } : null,
        lagBytes: lagBytesArr.length > 0 ? {
          min: Math.min(...lagBytesArr),
          max: Math.max(...lagBytesArr),
          avg: lagBytesArr.reduce((a, b) => a + b, 0) / lagBytesArr.length
        } : null,
        primaryLsn: bucketData[bucketData.length - 1]?.primaryLsn,
        replicaLsn: bucketData[bucketData.length - 1]?.replicaLsn
      });
    } else {
      buckets.push({
        startTime: bucketStart,
        endTime: bucketEnd,
        count: 0,
        lagSeconds: null,
        lagBytes: null
      });
    }
  }
  
  res.json({ 
    buckets,
    bucketSizeMs,
    totalSamples: lagHistory.length
  });
});

// Get WAL changes for a specific time range
app.get('/api/wal-changes-range', async (req, res) => {
  const startTime = parseInt(req.query.startTime);
  const endTime = parseInt(req.query.endTime);
  
  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'startTime and endTime required' });
  }
  
  const changes = walChanges.filter(c => {
    const ts = new Date(c.primaryTimestamp).getTime();
    return ts >= startTime && ts < endTime;
  });
  
  res.json({
    changes,
    startTime,
    endTime,
    total: changes.length
  });
});

app.get('/api/activity', async (req, res) => {
  try {
    const activity = await getRecentActivity();
    res.json({ activity });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to manually trigger slot creation
app.post('/api/create-slot', async (req, res) => {
  try {
    const success = await ensureDecodingSlot();
    res.json({ success, message: success ? 'Slot created or already exists' : 'Failed to create slot' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to consume pending changes
app.post('/api/consume-changes', async (req, res) => {
  try {
    const count = await consumeDecodedWalChanges(req.body?.limit || 50);
    res.json({ consumed: count, total: walChanges.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Background tasks
async function startBackgroundTasks() {
  // Try to create the decoding slot on startup
  await ensureDecodingSlot();
  
  // Record LSN history every second
  setInterval(recordLsnHistory, 1000);
  
  // Consume WAL changes every 2 seconds
  setInterval(() => consumeDecodedWalChanges(50), 2000);
  
  console.log('Background tasks started');
}

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`WAL Info server running on port ${PORT}`);
  startBackgroundTasks();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await primaryPool.end();
  await replicaPool.end();
  process.exit(0);
});
