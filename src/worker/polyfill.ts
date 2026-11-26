/**
 * Cloudflare Workers / Pages 頂層相容性墊片
 * 部分套件（如 exceljs / readable-stream）在 module evaluation 階段會讀取 process.versions.node.split('.')
 */
const g = globalThis as unknown as {
  process?: {
    env?: Record<string, string>;
    version?: string;
    versions?: Record<string, string>;
  };
};

if (!g.process) {
  g.process = { env: {}, version: 'v20.0.0', versions: { node: '20.0.0' } };
} else {
  if (!g.process.version) g.process.version = 'v20.0.0';
  if (!g.process.versions) {
    g.process.versions = { node: '20.0.0' };
  } else if (!g.process.versions.node) {
    g.process.versions.node = '20.0.0';
  }
}
