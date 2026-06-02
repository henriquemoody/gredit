import { loadConfig, ConfigError } from './config.ts';

export const uidPositional = {
  type: 'positional' as const,
  description: 'Dashboard UID or alias',
  required: false,
} as const;

export async function withConfig<T>(
  fn: (config: Awaited<ReturnType<typeof loadConfig>>) => Promise<T>,
): Promise<T> {
  try {
    const config = await loadConfig();
    return await fn(config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
