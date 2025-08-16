import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

type ExecuteOptions = {
  script: string,
  engine: 'quickjs' | 'hermes' | 'nodejs',
  checkpoint?: Buffer | null,
}

type ExecuteResult = {
  result: unknown,
  checkpoint: Buffer | null,
  logs?: string,
}

// SSH connection details for the QEMU VM
const VM_SSH_PORT = '10022';
const VM_SSH_USER = 'root';
const VM_SSH_HOST = 'localhost';

export async function executeScript(options: ExecuteOptions): Promise<ExecuteResult> {
  const { script, engine, checkpoint } = options;
  const executionId = uuidv4();
  const tempDir = `/tmp/js-exec-${executionId}`;

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // For now, simulate checkpoint functionality
    // In production with proper CRIU support, this would restore container state
    let previousState = {};
    if (checkpoint) {
      try {
        const checkpointData = JSON.parse(checkpoint.toString());
        previousState = checkpointData.state || {};
      } catch {
        // Invalid checkpoint, ignore
      }
    }

    // Create a wrapper script that handles state and returns JSON
    const wrapperScript = `
      const previousState = ${JSON.stringify(previousState)};
      const global = { ...previousState };
      
      let userResult;
      try {
        userResult = (function() {
          ${script}
        })();
      } catch (error) {
        userResult = { error: error.message, stack: error.stack };
      }
      
      const output = {
        result: userResult,
        state: global
      };
      
      console.log(JSON.stringify(output));
    `;

    const scriptPath = path.join(tempDir, 'script.js');
    await fs.writeFile(scriptPath, wrapperScript);

    // Check VM status first
    const { checkVMStatus } = await import('./vm-status.js');
    const vmStatus = await checkVMStatus();

    if (!vmStatus.qemu_running) {
      throw new Error('QEMU VM is not running');
    }

    // Log current VM status
    console.log(`VM Status: QEMU PID=${vmStatus.qemu_pid}, Uptime=${vmStatus.qemu_uptime_seconds}s`);

    let stdout: string;
    let logs = '';

    // Map engine to container command
    let containerCmd: string;
    switch (engine) {
      case 'nodejs': {
        containerCmd = 'node';
        break;
      }
      case 'quickjs': {
        containerCmd = 'qjs';
        break;
      }
      case 'hermes': {
        containerCmd = 'hermes';
        break;
      }
      default: {
        containerCmd = 'node';
      }
    }

    // Try to execute via SSH in the VM
    if (vmStatus.ready && vmStatus.qemu_uptime_seconds && vmStatus.qemu_uptime_seconds > 60) {
      try {
        // First, try to check if SSH is accessible
        const checkSSH = `timeout 2 nc -z ${VM_SSH_HOST} ${VM_SSH_PORT}`;
        const sshCheck = await execAsync(checkSSH).catch(() => null);

        if (sshCheck) {
          // SSH is accessible, try to execute in VM
          const sshCommand = `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p ${VM_SSH_PORT} ${VM_SSH_USER}@${VM_SSH_HOST} "echo '${wrapperScript.replace(/'/g, "'\\''").replace(/\n/g, ' ')}' | ${containerCmd}"`;

          const result = await execAsync(sshCommand, { timeout: 30000 });
          stdout = result.stdout;
          logs = `Executed in VM via SSH on port ${VM_SSH_PORT}`;
        } else {
          throw new Error('SSH port not accessible');
        }
      } catch (sshError) {
        // SSH failed, fall back to local execution
        console.warn('VM SSH execution failed, using local fallback:', sshError);
        logs = `SSH failed (${sshError}), using local execution`;

        // Execute locally with the appropriate interpreter
        const localCommand = `${containerCmd === 'qjs' ? 'node' : containerCmd} ${scriptPath}`;
        const result = await execAsync(localCommand, { timeout: 30000 });
        stdout = result.stdout;
      }
    } else {
      // VM not ready, execute locally
      logs = 'VM not ready, using local execution';
      const localCommand = `node ${scriptPath}`;
      const result = await execAsync(localCommand, { timeout: 30000 });
      stdout = result.stdout;
    }

    let output;
    try {
      output = JSON.parse(stdout.trim());
    } catch {
      // If parsing fails, return the raw output
      output = { result: stdout.trim(), state: {} };
    }

    // Create a simulated checkpoint with the current state
    const checkpointData = {
      engine,
      state: output.state || {},
      timestamp: new Date().toISOString(),
    };

    const newCheckpoint = Buffer.from(JSON.stringify(checkpointData));

    return {
      result: output.result,
      checkpoint: newCheckpoint,
      logs,
    };
  } catch (error) {
    console.error('Execution error:', error);
    // Return a more detailed error for debugging
    throw new Error(`Execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
