import si from 'systeminformation';
import os from 'os';
import { logger } from '@/config/logger';
import type { ServerMetadata, ServerMetrics } from '@/communication/protocol.types';

const AGENT_VERSION = '1.0.0';

export class MetricsCollector {
  async getMetadata(dockerVersion: string): Promise<ServerMetadata> {
    const cpu = await si.cpu();
    const mem = await si.mem();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpuCores: cpu.physicalCores || os.cpus().length,
      totalMemoryMb: Math.round(mem.total / 1024 / 1024),
      dockerVersion,
      agentVersion: AGENT_VERSION,
    };
  }

  async getMetrics(): Promise<ServerMetrics> {
    try {
      const [cpuLoad, mem, disk, load] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.currentLoad(),
      ]);

      const mainDisk = disk[0] ?? { used: 0, size: 1 };

      return {
        cpuUsagePercent: Math.round(cpuLoad.currentLoad * 10) / 10,
        memUsedMb: Math.round((mem.total - mem.available) / 1024 / 1024),
        memTotalMb: Math.round(mem.total / 1024 / 1024),
        diskUsedGb: Math.round((mainDisk.used / 1024 / 1024 / 1024) * 10) / 10,
        diskTotalGb: Math.round((mainDisk.size / 1024 / 1024 / 1024) * 10) / 10,
        loadAvg1m: os.loadavg()[0] ?? 0,
        uptime: os.uptime(),
      };
    } catch (err) {
      logger.warn({ err }, 'Failed to collect metrics, returning zeroes');
      return {
        cpuUsagePercent: 0,
        memUsedMb: 0,
        memTotalMb: 0,
        diskUsedGb: 0,
        diskTotalGb: 0,
        loadAvg1m: 0,
        uptime: os.uptime(),
      };
    }
  }
}

export const metricsCollector = new MetricsCollector();
