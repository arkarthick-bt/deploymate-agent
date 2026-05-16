import path from 'path';
import fse from 'fs-extra';
import { getDockerClient } from './docker.client';
import { logger } from '@/config/logger';

type LogCallback = (line: string) => void;

export interface BuildOptions {
  contextDir: string;
  imageName: string;
  imageTag: string;
  onLog?: LogCallback;
}

export async function buildImage(opts: BuildOptions): Promise<string> {
  const { contextDir, imageName, imageTag, onLog } = opts;
  const fullTag = `${imageName}:${imageTag}`;
  const docker = getDockerClient();

  logger.info({ contextDir, fullTag }, 'Starting Docker image build');

  const dockerfilePath = path.join(contextDir, 'Dockerfile');
  if (!(await fse.pathExists(dockerfilePath))) {
    throw new Error(`Dockerfile not found at ${dockerfilePath}`);
  }

  const buildStream = await docker.buildImage(
    { context: contextDir, src: ['.'] },
    { t: fullTag, dockerfile: 'Dockerfile', nocache: false },
  );

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      buildStream,
      (err, output) => {
        if (err) return reject(err);
        const last = output?.[output.length - 1];
        if (last && 'error' in last) {
          return reject(new Error((last as { error: string }).error));
        }
        resolve();
      },
      (event: Record<string, unknown>) => {
        const line = (event['stream'] as string | undefined)?.trim() ?? '';
        if (line) {
          logger.debug({ line }, 'Build output');
          onLog?.(line);
        }
        if (event['error']) {
          logger.error({ error: event['error'] }, 'Build error stream');
        }
      },
    );
  });

  logger.info({ fullTag }, 'Docker image built successfully');
  return fullTag;
}

export async function removeImage(imageTag: string): Promise<void> {
  const docker = getDockerClient();
  try {
    const image = docker.getImage(imageTag);
    await image.remove({ force: true });
    logger.debug({ imageTag }, 'Removed Docker image');
  } catch (err) {
    logger.warn({ err, imageTag }, 'Failed to remove image (may not exist)');
  }
}
