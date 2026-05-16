import WebSocket from 'ws';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import type { AgentMessage, BackendMessage } from '@/communication/protocol.types';

type MessageHandler = (msg: BackendMessage) => void | Promise<void>;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MULTIPLIER = 1.5;

export class AgentWebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private terminated = false;
  private messageHandlers: MessageHandler[] = [];
  private connectHandlers: Array<() => void> = [];
  private disconnectHandlers: Array<() => void> = [];

  constructor(private readonly url: string, private readonly token: string) {}

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onConnect(handler: () => void): void {
    this.connectHandlers.push(handler);
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }

  connect(): void {
    if (this.terminated) return;
    logger.info({ url: this.url }, 'Connecting to backend WebSocket');

    this.ws = new WebSocket(this.url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    this.ws.on('open', () => {
      logger.info('WebSocket connection established');
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.connectHandlers.forEach((h) => h());
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as BackendMessage;
        if (msg.type === 'ping') {
          this.send({ type: 'agent:heartbeat', metrics: this.getEmptyMetrics() });
          return;
        }
        this.messageHandlers.forEach((h) => h(msg));
      } catch (err) {
        logger.error({ err }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'WebSocket closed');
      this.disconnectHandlers.forEach((h) => h());
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
    });
  }

  send(msg: AgentMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  terminate(): void {
    this.terminated = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.terminate();
  }

  private scheduleReconnect(): void {
    if (this.terminated) return;
    const delay = Math.min(this.reconnectDelay, RECONNECT_MAX_MS);
    logger.info({ delayMs: delay }, 'Scheduling WebSocket reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.floor(this.reconnectDelay * RECONNECT_MULTIPLIER);
      this.connect();
    }, delay);
  }

  private getEmptyMetrics() {
    return {
      cpuUsagePercent: 0,
      memUsedMb: 0,
      memTotalMb: 0,
      diskUsedGb: 0,
      diskTotalGb: 0,
      loadAvg1m: 0,
      uptime: process.uptime(),
    };
  }
}
