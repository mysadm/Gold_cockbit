import { ensureDefaultScenarios } from './ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from './ensureDefaultTranches.mjs';
import { ensureDefaultDcaPlan } from './ensureDefaultDcaPlan.mjs';
import { ensureDefaultWalletHoldings } from './ensureDefaultWalletHoldings.mjs';

export async function provisionUserDefaults(db, userId) {
  await ensureDefaultScenarios(db, userId);
  await ensureDefaultTranches(db, userId);
  await ensureDefaultDcaPlan(db, userId);
  await ensureDefaultWalletHoldings(db, userId);
}
