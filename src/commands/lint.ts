import type { Config } from '../config.ts';
import { resolveUid } from '../config.ts';
import { lintDashboard } from '../lint.ts';
import { dashFile, readModel } from './paths.ts';

/** Validate the local model; returns nonzero if there are errors. */
export async function lint(config: Config, arg?: string): Promise<number> {
  const uid = resolveUid(config, arg);
  const file = dashFile(config, uid);
  const model = await readModel(file);
  if (!model) return 1;
  const issues = lintDashboard(model);
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) {
    console.log(`${i.level === 'error' ? 'ERROR' : 'warn '}  ${i.message}`);
  }
  if (issues.length === 0) console.log('OK — no issues.');
  return errors.length > 0 ? 1 : 0;
}
