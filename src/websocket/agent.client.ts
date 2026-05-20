import WebSocket from 'ws';
import { logger } from '@/config/logger';
import type { AgentMessage, BackendMessage } from '@/communication/protocol.types';

type MessageHandler = (msg: BackendMessage) => void | Promise<void>;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MULTIPLIER = 1.5;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 8_000;

export class AgentWebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private terminated = false;
  private messageHandlers: MessageHandler[] = [];
  private connectHandlers: Array<() => void> = [];
  private disconnectHandlers: Array<() => void> = [];
  private attemptCount = 0;
  private errorTriggeredReconnect = false;

  constructor(private readonly url: string, private readonly token: string) { }

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
    this.attemptCount += 1;
    this.errorTriggeredReconnect = false;
    logger.info({ url: this.url, attempt: this.attemptCount }, 'Connecting to backend WebSocket');

    this.ws = new WebSocket(this.url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    this.ws.on('open', () => {
      logger.info({ attempt: this.attemptCount }, 'WebSocket connection established');
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.attemptCount = 0;
      this.startPingCycle();
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
      this.stopPingCycle();
      this.disconnectHandlers.forEach((h) => h());
      // Only schedule reconnect here if error handler didn't already schedule one
      if (!this.errorTriggeredReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      logger.error({ err, attempt: this.attemptCount }, 'WebSocket error');
      // The ws library does not always emit 'close' after 'error' (e.g. ECONNREFUSED
      // during a reconnect attempt). Schedule reconnect here as a safety net so the
      // agent doesn't silently stall when the backend is still starting up.
      if (!this.errorTriggeredReconnect && !this.reconnectTimer) {
        this.errorTriggeredReconnect = true;
        this.disconnectHandlers.forEach((h) => h());
        this.scheduleReconnect();
      }
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
    this.stopPingCycle();
    this.ws?.terminate();
  }

  private startPingCycle(): void {
    this.stopPingCycle();
    const ws = this.ws!;

    ws.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
    });

    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.ping();
      // If backend doesn't pong within PONG_TIMEOUT_MS the connection is silently dead
      this.pongTimer = setTimeout(() => {
        logger.warn('Pong timeout — backend unreachable, terminating stale connection');
        ws.terminate(); // fires 'close', which fires scheduleReconnect
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private stopPingCycle(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.terminated) return;
    if (this.reconnectTimer) return; // already scheduled
    const delay = Math.min(this.reconnectDelay, RECONNECT_MAX_MS);
    logger.info({ delayMs: delay, attempt: this.attemptCount }, 'Scheduling WebSocket reconnect');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
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
