import { logger } from '@/config/logger';
import type { DbJobPayload, DbConnection } from '@/communication/protocol.types';
import type { DatabaseDriver } from './driver.interface';
import { postgresqlDriver } from './drivers/postgresql.driver';
import { mysqlDriver } from './drivers/mysql.driver';
import { mariadbDriver } from './drivers/mariadb.driver';

function getDriver(engine: DbConnection['engine']): DatabaseDriver {
  switch (engine) {
    case 'postgresql': return postgresqlDriver;
    case 'mysql':      return mysqlDriver;
    case 'mariadb':    return mariadbDriver;
    default:
      throw new Error(`Unsupported database engine: ${engine}`);
  }
}

export interface DbHandlerResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Routes a db:job payload to the appropriate driver method.
 * Returns a typed result for sending back as db:result.
 */
export async function handleDbJob(payload: DbJobPayload): Promise<DbHandlerResult> {
  const { jobType, connection } = payload;
  const driver = getDriver(connection.engine);

  try {
    switch (jobType) {
      case 'VALIDATE_DATABASE': {
        const result = await driver.validate(connection);
        return { success: true, data: result as unknown as Record<string, unknown> };
      }

      case 'LIST_DATABASE_USERS': {
        const users = await driver.listUsers(connection);
        return { success: true, data: { users } };
      }

      case 'LIST_DATABASES': {
        const databases = await driver.listDatabases(connection);
        return { success: true, data: { databases } };
      }

      case 'LIST_SCHEMAS': {
        const schemas = await driver.listSchemas(connection);
        return { success: true, data: { schemas } };
      }

      case 'LIST_PERMISSIONS': {
        const permissions = await driver.listPermissions(connection);
        return { success: true, data: { permissions } };
      }

      case 'CREATE_DATABASE_USER': {
        if (!payload.dbUsername || !payload.dbPassword) {
          throw new Error('dbUsername and dbPassword are required for CREATE_DATABASE_USER');
        }
        await driver.createUser(
          connection,
          payload.dbUsername,
          payload.dbPassword,
          payload.accessTemplate ?? 'READ_ONLY',
          payload.targetDatabase,
          payload.targetSchema,
        );
        return { success: true, data: { created: payload.dbUsername } };
      }

      case 'REVOKE_DATABASE_USER': {
        if (!payload.dbUsername) throw new Error('dbUsername is required for REVOKE_DATABASE_USER');
        await driver.revokeUser(connection, payload.dbUsername);
        return { success: true, data: { revoked: payload.dbUsername } };
      }

      case 'GRANT_DATABASE_ACCESS': {
        if (!payload.dbUsername) throw new Error('dbUsername is required for GRANT_DATABASE_ACCESS');
        await driver.grantAccess(
          connection,
          payload.dbUsername,
          payload.accessTemplate ?? 'READ_ONLY',
          payload.targetDatabase,
          payload.targetSchema,
        );
        return { success: true, data: { granted: payload.dbUsername } };
      }

      case 'REVOKE_DATABASE_ACCESS': {
        if (!payload.dbUsername) throw new Error('dbUsername is required for REVOKE_DATABASE_ACCESS');
        await driver.revokeAccess(
          connection,
          payload.dbUsername,
          payload.accessTemplate ?? 'READ_ONLY',
          payload.targetDatabase,
          payload.targetSchema,
        );
        return { success: true, data: { revoked: payload.dbUsername } };
      }

      case 'ROTATE_DATABASE_PASSWORD': {
        if (!payload.dbPassword) throw new Error('dbPassword is required for ROTATE_DATABASE_PASSWORD');
        await driver.rotatePassword(connection, payload.dbPassword);
        return { success: true, data: { rotated: true } };
      }

      default:
        throw new Error(`Unknown job type: ${jobType}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobType, engine: connection.engine }, 'DB job handler error');
    return { success: false, error: message };
  }
}
