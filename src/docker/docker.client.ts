import Dockerode from 'dockerode';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

let _docker: Dockerode | null = null;

export function getDockerClient(): Dockerode {
  if (!_docker) {
    _docker = new Dockerode({ socketPath: env.docker.socketPath });
  }
  return _docker;
}

export async function getDockerVersion(): Promise<string> {
  try {
    const info = await getDockerClient().version();
    return info.Version ?? 'unknown';
  } catch (err) {
    logger.warn({ err }, 'Could not get Docker version');
    return 'unknown';
  }
}

export async function assertDockerAvailable(): Promise<void> {
  try {
    await getDockerClient().ping();
  } catch {
    throw new Error(
      `Docker is not available at ${env.docker.socketPath}. Is Docker running?`,
    );
  }
}
