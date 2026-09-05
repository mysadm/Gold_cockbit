import { Pool } from 'pg';

export function getPool(connectionString) {
  return new Pool({ connectionString, connectionTimeoutMillis: 5000 });
}
