import Dockerode from 'dockerode';
import { getDockerClient } from './docker.client';
import { buildTraefikLabels } from './traefik.labels';
import { logger } from '@/config/logger';
import { env } from '@/config/env';

export interface RunContainerOptions {
  imageName: string;
  containerName: string;
  projectNetwork: string;
  domain: string;
  port: number;
  envVars: Record<string, string>;
  memoryMb: number;
  cpuCount: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
}

export async function runContainer(opts: RunContainerOptions): Promise<ContainerInfo> {
  const docker = getDockerClient();
  const {
    imageName,
    containerName,
    projectNetwork,
    domain,
    port,
    envVars,
    memoryMb,
    cpuCount,
  } = opts;

  const labels = buildTraefikLabels({
    serviceName: containerName,
    domain,
    port,
    traefikNetwork: env.traefik.network,
  });

  const envArray = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

  const container = await docker.createContainer({
    name: containerName,
    Image: imageName,
    Env: envArray,
    Labels: { ...labels, 'deploymate.container': 'true' },
    ExposedPorts: { [`${port}/tcp`]: {} },
    HostConfig: {
      Memory: memoryMb * 1024 * 1024,
      CpuQuota: Math.floor(cpuCount * 100_000),
      CpuPeriod: 100_000,
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: projectNetwork,
      PortBindings: {},
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [projectNetwork]: {},
        [env.traefik.network]: {},
      },
    },
  } as Dockerode.ContainerCreateOptions);

  await container.start();
  logger.info({ containerName, id: container.id.slice(0, 12) }, 'Container started');
  return { id: container.id, name: containerName };
}

export async function stopContainer(containerId: string): Promise<void> {
  const docker = getDockerClient();
  try {
    const c = docker.getContainer(containerId);
    await c.stop({ t: 10 });
    await c.remove({ force: true });
    logger.info({ containerId: containerId.slice(0, 12) }, 'Container stopped and removed');
  } catch (err) {
    logger.warn({ err, containerId }, 'Failed to stop container (may not exist)');
  }
}

export async function getContainerLogs(
  containerId: string,
  onLine: (line: string, isError: boolean) => void,
): Promise<void> {
  const docker = getDockerClient();
  const container = docker.getContainer(containerId);

  const logStream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
    tail: 50,
  });

  container.modem.demuxStream(
    logStream,
    {
      write(chunk: Buffer) {
        chunk.toString().split('\n').filter(Boolean).forEach((l) => onLine(l, false));
      },
    },
    {
      write(chunk: Buffer) {
        chunk.toString().split('\n').filter(Boolean).forEach((l) => onLine(l, true));
      },
    },
  );
}

export async function findContainerByLabel(
  labelKey: string,
  labelValue: string,
): Promise<Dockerode.ContainerInfo | undefined> {
  const docker = getDockerClient();
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`${labelKey}=${labelValue}`] },
  });
  return containers[0];
}
