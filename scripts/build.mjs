import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(repository, 'dist');
if (output !== join(repository, 'dist')) throw new Error('Refusing to build outside the repository dist directory.');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(repository, 'public'), output, { recursive: true });
await cp(join(repository, 'samples'), join(output, 'samples'), { recursive: true });
await mkdir(join(output, 'server'), { recursive: true });
await cp(join(repository, '.openai'), join(output, '.openai'), { recursive: true });
await writeFile(join(output, 'build.json'), JSON.stringify({ application: 'BAC VIDYUT', schema: 'vidyut.machine.v2', builtAt: new Date().toISOString() }, null, 2));

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.urdf': 'application/xml; charset=utf-8', '.ino': 'text/plain; charset=utf-8' };
const assetMap = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(output, path).split(sep).join('/');
    if (relativePath.startsWith('server/') || relativePath.startsWith('.openai/')) continue;
    if (entry.isDirectory()) await collect(path);
    else assetMap[`/${relativePath}`] = { body: (await readFile(path)).toString('base64'), type: mime[extname(path).toLowerCase()] || 'application/octet-stream' };
  }
}
await collect(output);
const workerTemplate = await readFile(join(repository, 'sites', 'server-index.js'), 'utf8');
await writeFile(join(output, 'server', 'index.js'), workerTemplate.replace('__VIDYUT_ASSET_MAP__', JSON.stringify(assetMap)));
console.log(`Built static site at ${output}`);
