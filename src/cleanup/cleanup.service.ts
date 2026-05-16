import { getDockerClient } from '@/docker/docker.client';
import { logger } from '@/config/logger';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export class CleanupService {
  async removeStaleContainers(): Promise<void> {
    const docker = getDockerClient();
    try {
      const containers = await docker.listContainers({
        all: true,
        filters: { label: ['deploymate.managed=true'], status: ['exited', 'dead'] },
      });

      const now = Date.now();
      for (const info of containers) {
        const createdMs = (info.Created ?? 0) * 1000;
        if (now - createdMs > STALE_THRESHOLD_MS) {
          try {
            const c = docker.getContainer(info.Id);
            await c.remove({ force: true });
            logger.info({ id: info.Id.slice(0, 12), name: info.Names[0] }, 'Removed stale container');
          } catch (err) {
            logger.warn({ err, id: info.Id }, 'Failed to remove stale container');
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to list containers for cleanup');
    }
  }

  async removeStaleImages(keepTags: string[]): Promise<void> {
    const docker = getDockerClient();
    try {
      const images = await docker.listImages({
        filters: { label: ['deploymate.managed=true'] },
      });

      for (const img of images) {
        const tags = img.RepoTags ?? [];
        const shouldKeep = tags.some((t) => keepTags.includes(t));
        if (!shouldKeep && tags.length > 0) {
          try {
            const image = docker.getImage(img.Id);
            await image.remove({ force: true });
            logger.info({ tags }, 'Removed stale image');
          } catch (err) {
            logger.warn({ err, tags }, 'Failed to remove image');
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to list images for cleanup');
    }
  }
}

export const cleanupService = new CleanupService();
