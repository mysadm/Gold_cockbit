import { Client } from 'pg';

export function getClient(connectionString) {
  return new Client({ connectionString });
}
