import type { AdminConfig } from '../admin.types';
import { getConfig } from '../config';
import { ConfigConflictError } from '../config-revisions';
import { db } from '../db';
/** Retry only a synchronous merge; network work must complete before entering here. */
export async function updateConfig(
  mutator: (current: AdminConfig) => AdminConfig | void
) {
  for (let attempt = 0; ; attempt++) {
    const current = await getConfig(true);
    const before = JSON.stringify(current);
    const next = mutator(current) || current;
    if (JSON.stringify(next) === before) return;
    try {
      await db.saveAdminConfig(next);
      return;
    } catch (error) {
      if (!(error instanceof ConfigConflictError) || attempt >= 3) throw error;
    }
  }
}
