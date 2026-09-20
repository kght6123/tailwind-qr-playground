import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
await build({
  entryPoints: ['cli/index.mjs'], outfile: 'cli-dist/index.mjs',
  bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
});
await chmod('cli-dist/index.mjs', 0o755);
