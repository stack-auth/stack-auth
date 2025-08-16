import { exec } from 'child_process';
import * as fs from 'fs/promises';
import { promisify } from 'util';

const execAsync = promisify(exec);

type VMStatus = {
  qemu_running: boolean,
  qemu_pid?: number,
  qemu_uptime_seconds?: number,
  vm_network_info?: {
    ip?: string,
    mac?: string,
  },
  ssh_status?: {
    port_open: boolean,
    port: number,
    authentication_working?: boolean,
    error?: string,
    username?: string,
  },
  podman_status?: {
    installed: boolean,
    version?: string,
    containers?: {
      running: number,
      total: number,
      list?: string[],
    },
  },
  cloud_init_status?: {
    completed: boolean,
    uptime?: string,
  },
  serial_console?: {
    lines_available: number,
    last_lines?: string[],
  },
  ready: boolean,
  diagnostics?: string[],
}

export async function checkVMStatus(): Promise<VMStatus> {
  const status: VMStatus = {
    qemu_running: false,
    ready: false,
    diagnostics: [],
  };

  const sshPort = 10022;
  const sshUser = 'root';

  try {
    // Check if QEMU process is running
    const { stdout: psOutput } = await execAsync('ps aux | grep qemu-system-x86_64 | grep -v grep').catch(() => ({ stdout: '' }));

    if (psOutput.trim()) {
      status.qemu_running = true;

      // Extract PID from ps output
      const pidMatch = psOutput.match(/^\S+\s+(\d+)/);
      if (pidMatch) {
        status.qemu_pid = parseInt(pidMatch[1], 10);

        // Get process uptime
        try {
          const { stdout: uptimeData } = await execAsync(`ps -o etimes= -p ${status.qemu_pid}`);
          status.qemu_uptime_seconds = parseInt(uptimeData.trim(), 10);
          status.diagnostics?.push(`QEMU running for ${status.qemu_uptime_seconds} seconds`);
        } catch {
          status.diagnostics?.push('Could not determine QEMU uptime');
        }
      }

      // Parse QEMU command line to get network info
      const netMatch = psOutput.match(/-netdev\s+user,id=(\w+)/);
      if (netMatch) {
        status.vm_network_info = {
          mac: '52:54:00:12:34:56', // Default QEMU MAC
        };
        status.diagnostics?.push('VM network configured');
      }

      // Check SSH connectivity
      status.ssh_status = {
        port_open: false,
        port: sshPort,
        username: sshUser,
      };

      // Check if SSH port is open
      try {
        const { stdout: ncOutput } = await execAsync(`timeout 1 nc -z localhost ${sshPort} && echo "open" || echo "closed"`);
        if (ncOutput.trim() === 'open') {
          status.ssh_status.port_open = true;
          status.diagnostics?.push(`SSH port ${sshPort} is open`);

          // Try to authenticate via SSH
          try {
            // Try a simple SSH command - note: this requires SSH key setup
            const { stdout: sshTest } = await execAsync(
              `timeout 2 ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p ${sshPort} ${sshUser}@localhost "echo 'SSH_OK' && uname -a" 2>/dev/null`
            ).catch(err => {
              // Check if it's a permission denied (authentication) issue
              if (err.message.includes('Permission denied')) {
                return { stdout: 'AUTH_FAILED' };
              }
              return { stdout: '' };
            });

            if (sshTest.includes('SSH_OK')) {
              status.ssh_status.authentication_working = true;
              status.diagnostics?.push('SSH authentication successful');

              // Get more VM info since SSH works
              try {
                // Check cloud-init status
                const { stdout: cloudInitStatus } = await execAsync(
                  `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p ${sshPort} ${sshUser}@localhost "cloud-init status --wait 2>/dev/null || echo 'not-ready'" 2>/dev/null`
                ).catch(() => ({ stdout: 'error' }));

                if (cloudInitStatus.includes('done')) {
                  status.cloud_init_status = { completed: true };
                  status.diagnostics?.push('Cloud-init completed');
                } else {
                  status.cloud_init_status = { completed: false };
                  status.diagnostics?.push('Cloud-init still running');
                }

                // Check Podman installation
                const { stdout: podmanVersion } = await execAsync(
                  `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p ${sshPort} ${sshUser}@localhost "podman --version 2>/dev/null || echo 'not-installed'" 2>/dev/null`
                ).catch(() => ({ stdout: 'not-installed' }));

                if (!podmanVersion.includes('not-installed')) {
                  status.podman_status = {
                    installed: true,
                    version: podmanVersion.trim(),
                  };

                  // Get container info
                  const { stdout: containerList } = await execAsync(
                    `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p ${sshPort} ${sshUser}@localhost "podman ps -a --format '{{.Names}}:{{.Status}}' 2>/dev/null" 2>/dev/null`
                  ).catch(() => ({ stdout: '' }));

                  const containers = containerList.trim().split('\n').filter(line => line);
                  const runningContainers = containers.filter(c => c.includes(':Up')).length;

                  status.podman_status.containers = {
                    running: runningContainers,
                    total: containers.length,
                    list: containers.slice(0, 5), // Show first 5 containers
                  };

                  status.diagnostics?.push(`Podman ${status.podman_status.version} with ${runningContainers}/${containers.length} containers`);
                } else {
                  status.podman_status = { installed: false };
                  status.diagnostics?.push('Podman not installed yet');
                }

                // Get VM uptime
                const { stdout: vmUptime } = await execAsync(
                  `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -p ${sshPort} ${sshUser}@localhost "uptime" 2>/dev/null`
                ).catch(() => ({ stdout: '' }));

                if (vmUptime) {
                  status.cloud_init_status.uptime = vmUptime.trim();
                }

                status.ready = true;
              } catch (err) {
                status.diagnostics?.push(`SSH works but some commands failed: ${err}`);
              }
            } else if (sshTest === 'AUTH_FAILED') {
              status.ssh_status.authentication_working = false;
              status.ssh_status.error = 'Authentication failed - SSH keys may not be set up';
              status.diagnostics?.push('SSH port open but authentication failed');
            } else {
              status.ssh_status.authentication_working = false;
              status.ssh_status.error = 'Connection failed';
              status.diagnostics?.push('SSH connection failed');
            }
          } catch (sshErr) {
            status.ssh_status.authentication_working = false;
            status.ssh_status.error = String(sshErr);
            status.diagnostics?.push(`SSH test failed: ${sshErr}`);
          }
        } else {
          status.diagnostics?.push(`SSH port ${sshPort} is not open`);
        }
      } catch (err) {
        status.diagnostics?.push(`Cannot check SSH port: ${err}`);
      }
    } else {
      status.diagnostics?.push('QEMU process not found');
    }

    // Check for QEMU serial output
    try {
      const serialLog = await fs.readFile('/tmp/qemu-serial.log', 'utf-8').catch(() => null);
      if (serialLog) {
        const lines = serialLog.split('\n');
        const lastLines = lines.slice(-10).filter(line => line.trim());

        status.serial_console = {
          lines_available: lines.length,
          last_lines: lastLines,
        };

        // Check for key boot milestones in serial log
        if (serialLog.includes('cloud-init') && serialLog.includes('finished')) {
          if (!status.cloud_init_status) {
            status.cloud_init_status = { completed: true };
          }
          status.diagnostics?.push('Cloud-init finished (from serial log)');
        }

        if (serialLog.includes('Ubuntu')) {
          status.diagnostics?.push('Ubuntu detected in serial log');
        }
      }
    } catch {
      // Serial log not available
    }

  } catch (error) {
    console.error('Error checking VM status:', error);
    status.diagnostics?.push(`Error: ${error}`);
  }

  return status;
}

export async function getVMSerialConsole(): Promise<string> {
  try {
    const serialLog = await fs.readFile('/tmp/qemu-serial.log', 'utf-8').catch(() => '');
    return serialLog;
  } catch {
    return 'Serial console not available';
  }
}

export async function executeInVM(command: string): Promise<{ stdout: string, stderr: string }> {
  const sshPort = 10022;
  const sshUser = 'root';

  try {
    const { stdout, stderr } = await execAsync(
      `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -p ${sshPort} ${sshUser}@localhost "${command}" 2>&1`
    );
    return { stdout, stderr: stderr || '' };
  } catch (error) {
    return {
      stdout: '',
      stderr: `VM command execution failed: ${error}`,
    };
  }
}
