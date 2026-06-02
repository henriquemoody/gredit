/** Download the Playwright chromium browser required by all browser commands. */
export async function setup(): Promise<number> {
  console.log('Downloading Playwright chromium browser...');
  // playwright-core bundles the registry and download logic; this is the same
  // function called by the playwright npm postinstall script.
  // @ts-expect-error — not in playwright-core's public exports map
  const { registry } = (await import('playwright-core/lib/coreBundle')) as {
    registry: { installBrowsersForNpmInstall(browsers: string[]): Promise<void> };
  };
  await registry.installBrowsersForNpmInstall(['chromium']);
  console.log('Done.');
  return 0;
}
