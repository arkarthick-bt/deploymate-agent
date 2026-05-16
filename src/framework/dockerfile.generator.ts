import path from 'path';
import fse from 'fs-extra';
import { generateReactDockerfile } from './generators/react.generator';
import { generateAngularDockerfile } from './generators/angular.generator';
import { generateExpressDockerfile } from './generators/express.generator';
import { generatePhpDockerfile } from './generators/php.generator';
import { logger } from '@/config/logger';
import type { FrameworkDetectionResult } from './framework.types';

export async function generateDockerfile(
  repoDir: string,
  detection: FrameworkDetectionResult,
  port: number,
  customDockerfile?: string,
): Promise<void> {
  const dockerfilePath = path.join(repoDir, 'Dockerfile');

  if (customDockerfile) {
    await fse.writeFile(dockerfilePath, customDockerfile, 'utf-8');
    logger.info('Used custom Dockerfile provided by user');
    return;
  }

  // If a Dockerfile already exists in the repo, use it
  if (await fse.pathExists(dockerfilePath)) {
    logger.info('Using existing Dockerfile from repository');
    return;
  }

  let content: string;
  switch (detection.framework) {
    case 'react':
      content = generateReactDockerfile(port);
      break;
    case 'angular':
      content = generateAngularDockerfile(port);
      break;
    case 'php':
      content = generatePhpDockerfile(port);
      break;
    case 'express':
    default:
      content = generateExpressDockerfile(port);
      break;
  }

  await fse.writeFile(dockerfilePath, content, 'utf-8');
  logger.info({ framework: detection.framework, port }, 'Generated Dockerfile');
}
