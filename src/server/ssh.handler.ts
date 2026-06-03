import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/config/logger';
import type { SshJobPayload } from '@/communication/protocol.types';

const execAsync = promisify(exec);

interface SshJobResult {
  success: boolean;
  error?: string;
}

async function run(cmd: string): Promise<void> {
  logger.debug({ cmd }, 'Executing SSH provisioning command');
  await execAsync(cmd);
}

export async function handleSshJob(payload: SshJobPayload): Promise<SshJobResult> {
  const { jobType, linuxUsername, publicKey, expiresAt } = payload;

  try {
    switch (jobType) {
      case 'CREATE_SSH_USER': {
        const escapedKey = publicKey!.replace(/"/g, '\\"');
        const expiryDate = expiresAt
          ? new Date(expiresAt).toISOString().split('T')[0]
          : null;
        const cmds = [
          `id ${linuxUsername} &>/dev/null || sudo useradd -m -s /bin/bash ${linuxUsername}`,
          `sudo mkdir -p /home/${linuxUsername}/.ssh`,
          `echo "${escapedKey}" | sudo tee /home/${linuxUsername}/.ssh/authorized_keys`,
          `sudo chmod 700 /home/${linuxUsername}/.ssh`,
          `sudo chmod 600 /home/${linuxUsername}/.ssh/authorized_keys`,
          `sudo chown -R ${linuxUsername}:${linuxUsername} /home/${linuxUsername}/.ssh`,
          ...(expiryDate ? [`sudo chage -E ${expiryDate} ${linuxUsername}`] : []),
        ];
        for (const cmd of cmds) await run(cmd);
        break;
      }

      case 'ROTATE_SSH_KEY': {
        const escapedKey = publicKey!.replace(/"/g, '\\"');
        const cmds = [
          `echo "${escapedKey}" | sudo tee /home/${linuxUsername}/.ssh/authorized_keys`,
          `sudo chmod 600 /home/${linuxUsername}/.ssh/authorized_keys`,
          `sudo chown ${linuxUsername}:${linuxUsername} /home/${linuxUsername}/.ssh/authorized_keys`,
        ];
        for (const cmd of cmds) await run(cmd);
        break;
      }

      case 'REVOKE_SSH_USER': {
        const cmds = [
          `sudo chage -E 0 ${linuxUsername}`,
          `sudo usermod -L ${linuxUsername}`,
          `sudo truncate -s 0 /home/${linuxUsername}/.ssh/authorized_keys`,
        ];
        for (const cmd of cmds) await run(cmd);
        break;
      }

      default:
        return { success: false, error: `Unknown SSH job type: ${jobType}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobType, linuxUsername }, 'SSH provisioning command failed');
    return { success: false, error: msg };
  }
}
