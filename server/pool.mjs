import { Pool } from 'pg';

export function getPool(connectionString) {
  return new Pool({ connectionString });
}
