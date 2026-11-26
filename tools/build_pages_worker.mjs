import { build } from 'esbuild';

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'url',
  'util',
  'zlib',
]);

const nodeBuiltinCjsToEsmPlugin = {
  name: 'node-builtin-cjs-to-esm',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      const bare = args.path.replace(/^node:/, '');
      if (NODE_BUILTINS.has(bare)) {
        if (args.kind === 'require-call' || args.kind === 'require-resolve') {
          return { path: bare, namespace: 'node-cjs-shim' };
        }
        return { path: `node:${bare}`, external: true };
      }
      return null;
    });

    b.onLoad({ filter: /.*/, namespace: 'node-cjs-shim' }, (args) => ({
      contents: `import * as mod from "node:${args.path}"; module.exports = mod;`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: ['src/worker/index.ts'],
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'node',
  outfile: 'public/_worker.js',
  plugins: [nodeBuiltinCjsToEsmPlugin],
  banner: {
    js: `if(typeof globalThis.process==="undefined"){globalThis.process={env:{},version:"v20.0.0",versions:{node:"20.0.0"}}}else{globalThis.process.version=globalThis.process.version||"v20.0.0";globalThis.process.versions=globalThis.process.versions||{};globalThis.process.versions.node=globalThis.process.versions.node||"20.0.0";}`,
  },
});

console.log('Built public/_worker.js successfully.');
