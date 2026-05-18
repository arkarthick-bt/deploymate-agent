/**
 * MariaDB driver. MariaDB is wire-compatible with MySQL but has minor
 * differences in user-management SQL. We reuse the MySQL driver and override
 * only what differs.
 */
import type { DbConnection } from '@/communication/protocol.types';
import { MySQLDriver } from './mysql.driver';
import type { ValidationResult } from '../driver.interface';
import mysql from 'mysql2/promise';

async function withConnection<T>(
  connection: DbConnection,
  fn: (conn: mysql.Connection) => Promise<T>,
): Promise<T> {
  const conn = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.username,
    password: connection.password,
    ssl: connection.sslEnabled ? {} : undefined,
    connectTimeout: 10_000,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => {});
  }
}

export class MariaDBDriver extends MySQLDriver {
  async validate(connection: DbConnection): Promise<ValidationResult> {
    const start = Date.now();
    return withConnection(connection, async (conn) => {
      const [[versionRow]] = (await conn.execute('SELECT VERSION() AS version')) as any;
      const [[userRow]] = (await conn.execute('SELECT CURRENT_USER() AS current_user')) as any;
      const [[sslRow]] = (await conn.execute("SHOW STATUS LIKE 'Ssl_cipher'")) as any;
      const [databases] = (await conn.execute('SHOW DATABASES')) as any;

      return {
        reachable: true,
        version: (versionRow as any)?.version as string,
        currentUser: (userRow as any)?.current_user as string,
        sslEnabled: !!(sslRow as any)?.Value,
        latencyMs: Date.now() - start,
        schemas: (databases as any[]).map((r: any) => r.Database as string),
      };
    });
  }
}

export const mariadbDriver = new MariaDBDriver();
