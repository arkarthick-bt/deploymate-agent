import { getDockerClient } from './docker.client';
import { logger } from '@/config/logger';

export function projectNetworkName(prefix: string, projectSlug: string): string {
  return `${prefix}-${projectSlug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export async function ensureNetwork(networkName: string): Promise<void> {
  const docker = getDockerClient();
  const networks = await docker.listNetworks({ filters: { name: [networkName] } });
  const exists = networks.some((n) => n.Name === networkName);

  if (!exists) {
    await docker.createNetwork({
      Name: networkName,
      Driver: 'bridge',
      Labels: { 'deploymate.managed': 'true' },
    });
    logger.info({ networkName }, 'Created Docker network');
  }
}

export async function removeNetwork(networkName: string): Promise<void> {
  const docker = getDockerClient();
  try {
    const networks = await docker.listNetworks({ filters: { name: [networkName] } });
    const target = networks.find((n) => n.Name === networkName);
    if (target?.Id) {
      const net = docker.getNetwork(target.Id);
      await net.remove();
      logger.info({ networkName }, 'Removed Docker network');
    }
  } catch (err) {
    logger.warn({ err, networkName }, 'Failed to remove Docker network');
  }
}
