import { build } from 'esbuild';
import { builtinModules } from 'node:module';

const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

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
      contents: `import mod from "node:${args.path}"; module.exports = mod;`,
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
    js: `try{if(typeof globalThis.process==="undefined"){globalThis.process={env:{},version:"v20.0.0",versions:{node:"20.0.0"},umask:()=>18,getuid:()=>0}}else{if(!globalThis.process.version)globalThis.process.version="v20.0.0";if(!globalThis.process.versions)globalThis.process.versions={node:"20.0.0"};else if(!globalThis.process.versions.node)globalThis.process.versions.node="20.0.0";try{globalThis.process.umask()}catch{Object.defineProperty(globalThis.process,"umask",{value:()=>18,configurable:true,writable:true})}try{if(typeof globalThis.process.getuid==="function")globalThis.process.getuid()}catch{Object.defineProperty(globalThis.process,"getuid",{value:()=>0,configurable:true,writable:true})}}}catch{}`,
  },
});

console.log('Built public/_worker.js successfully.');
