import path from 'path';
import fse from 'fs-extra';
import { logger } from '@/config/logger';
import type { FrameworkType, FrameworkDetectionResult } from './framework.types';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export class FrameworkDetector {
  async detect(repoDir: string): Promise<FrameworkDetectionResult> {
    logger.debug({ repoDir }, 'Detecting framework');

    const pkgJsonPath = path.join(repoDir, 'package.json');
    const hasPhp = await fse.pathExists(path.join(repoDir, 'index.php'));
    const hasPkgJson = await fse.pathExists(pkgJsonPath);
    const hasDockerfile = await fse.pathExists(path.join(repoDir, 'Dockerfile'));

    if (hasDockerfile) {
      logger.info('Custom Dockerfile detected — skipping framework detection');
      return {
        framework: 'unknown',
        confidence: 'high',
      };
    }

    if (hasPhp) {
      return { framework: 'php', confidence: 'high', port: 80 };
    }

    if (!hasPkgJson) {
      logger.warn({ repoDir }, 'No package.json found, cannot detect framework');
      return { framework: 'unknown', confidence: 'low' };
    }

    const pkg = (await fse.readJson(pkgJsonPath)) as PackageJson;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts ?? {};

    const framework = this.classifyNodeProject(deps, scripts, repoDir);
    const result: FrameworkDetectionResult = {
      framework,
      confidence: 'high',
      port: this.defaultPort(framework),
    };

    if (framework === 'react') {
      result.buildCommand = scripts['build'] ?? 'npm run build';
      result.outputDir = 'build';
    } else if (framework === 'angular') {
      result.buildCommand = scripts['build'] ?? 'npm run build';
      result.outputDir = 'dist';
    } else if (framework === 'express') {
      result.startCommand = scripts['start'] ?? 'node index.js';
    }

    logger.info({ framework, confidence: result.confidence }, 'Framework detected');
    return result;
  }

  private classifyNodeProject(
    deps: Record<string, string>,
    scripts: Record<string, string>,
    _dir: string,
  ): FrameworkType {
    if ('@angular/core' in deps) return 'angular';
    if ('react' in deps || 'react-scripts' in deps) return 'react';
    if ('express' in deps) return 'express';
    if (scripts['start']?.includes('node')) return 'express';
    return 'express';
  }

  private defaultPort(framework: FrameworkType): number {
    switch (framework) {
      case 'react':
      case 'angular':
        return 80;
      case 'express':
        return 3000;
      case 'php':
        return 80;
      default:
        return 3000;
    }
  }
}

export const frameworkDetector = new FrameworkDetector();
