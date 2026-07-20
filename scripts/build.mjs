import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(repository, 'dist');
if (output !== join(repository, 'dist')) throw new Error('Refusing to build outside the repository dist directory.');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(repository, 'public'), output, { recursive: true });
await cp(join(repository, 'samples'), join(output, 'samples'), { recursive: true });
await writeFile(join(output, 'build.json'), JSON.stringify({ application: 'BAC VIDYUT', schema: 'vidyut.machine.v2', builtAt: new Date().toISOString() }, null, 2));
console.log(`Built static site at ${output}`);
