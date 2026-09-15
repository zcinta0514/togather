/**
 * 构建并部署到 Cloudflare Pages。
 *
 * 为什么要有这个脚本，而不是直接两条命令：
 *
 * 1. Pages 的「高级模式」要求 _worker.js 自己处理所有请求（含静态文件），
 *    所以前端和后端要分别构建、再放到同一个目录里。
 *
 * 2. Cloudflare 的 Vite 插件会在 .wrangler/deploy/ 留一个配置重定向，
 *    让 wrangler 去读 Worker 的那份配置。那份配置带着 run_worker_first
 *    和 assets.directory —— 被 Pages 继承过去之后，只有 /api/* 会走到
 *    Worker，其余请求去找静态资源却找错目录，表现为整站 522。
 *
 * 3. Pages 不支持 `--config` 指定配置文件，只认根目录的 wrangler.jsonc。
 *    而根目录那份是 Worker 的（本地 npm run dev 要用）。
 *
 * 所以：部署前把根配置临时换成 Pages 版，部署完用 try/finally 换回来。
 */
import { execFileSync } from 'node:child_process';
import { rmSync, renameSync, copyFileSync, existsSync } from 'node:fs';

const run = (cmd, args) =>
  execFileSync(process.platform === 'win32' ? `${cmd}.cmd` : cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

const ROOT_CFG = 'wrangler.jsonc';
const BACKUP_CFG = 'wrangler.worker.jsonc';
const PAGES_CFG = 'wrangler.pages.jsonc';

console.log('\n▸ 清理旧产物');
rmSync('dist/pages', { recursive: true, force: true });
rmSync('.wrangler/deploy', { recursive: true, force: true });

console.log('\n▸ 构建前端');
run('npx', ['vite', 'build', '--config', 'vite.config.pages.ts']);

console.log('\n▸ 打包后端为 _worker.js');
run('npx', [
  'esbuild',
  'src/server/pages-entry.ts',
  '--bundle',
  '--format=esm',
  '--target=es2022',
  '--platform=neutral',
  '--main-fields=module,main',
  '--outfile=dist/pages/_worker.js',
]);

console.log('\n▸ 临时切换为 Pages 配置');
if (existsSync(BACKUP_CFG)) rmSync(BACKUP_CFG);
renameSync(ROOT_CFG, BACKUP_CFG);
copyFileSync(PAGES_CFG, ROOT_CFG);

try {
  console.log('\n▸ 部署到 Cloudflare Pages');
  run('npx', ['wrangler', 'pages', 'deploy', 'dist/pages', '--branch=main', '--commit-dirty=true']);
} finally {
  // 无论如何都要换回来，否则本地 npm run dev 会坏掉
  renameSync(BACKUP_CFG, ROOT_CFG);
  console.log('\n▸ 配置已还原');
}

console.log('\n✓ 完成\n');
