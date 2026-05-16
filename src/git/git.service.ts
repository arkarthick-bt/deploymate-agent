import path from 'path';
import fse from 'fs-extra';
import simpleGit, { SimpleGit } from 'simple-git';
import { logger } from '@/config/logger';

export interface CloneOptions {
  cloneUrl: string;
  branch: string;
  commitSha: string;
  destDir: string;
}

export class GitService {
  async clone(opts: CloneOptions): Promise<void> {
    const { cloneUrl, branch, commitSha, destDir } = opts;
    logger.info({ destDir, branch, commitSha }, 'Cloning repository');

    await fse.ensureDir(destDir);
    await fse.emptyDir(destDir);

    const git: SimpleGit = simpleGit();

    await git.clone(cloneUrl, destDir, [
      '--depth', '1',
      '--branch', branch,
      '--single-branch',
    ]);

    const repoGit = simpleGit(destDir);
    await repoGit.fetch('origin', commitSha);
    await repoGit.checkout(commitSha);

    logger.info({ destDir }, 'Repository cloned and checked out');
  }

  async buildAuthenticatedUrl(repoOwner: string, repoName: string, token: string): Promise<string> {
    return `https://x-access-token:${token}@github.com/${repoOwner}/${repoName}.git`;
  }

  async getCommitInfo(repoDir: string): Promise<{ sha: string; message: string; author: string }> {
    const git = simpleGit(repoDir);
    const log = await git.log({ maxCount: 1 });
    const latest = log.latest;
    return {
      sha: latest?.hash ?? '',
      message: latest?.message ?? '',
      author: latest?.author_name ?? '',
    };
  }

  async cleanup(dir: string): Promise<void> {
    try {
      await fse.remove(dir);
      logger.debug({ dir }, 'Workspace cleaned up');
    } catch (err) {
      logger.warn({ err, dir }, 'Failed to cleanup workspace');
    }
  }

  workspaceDir(workspaceBase: string, deploymentId: string): string {
    return path.join(workspaceBase, deploymentId);
  }
}

export const gitService = new GitService();
