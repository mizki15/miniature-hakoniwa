// npm run electron:dev：vite の開発サーバー（--mode electron）を立ててから Electron を起動する。
// Electron の窓を閉じると開発サーバーも止める。
// ポートは 5175（ブラウザで遊ぶ 5173・確認用の 5174 とぶつけない）。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // electron パッケージは実行ファイルのパスを返す

const server = await createServer({ mode: 'electron', server: { port: 5175, strictPort: true } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5175/';
console.log(`[electron:dev] ${url}`);

// npm run electron:dev -- --remote-debugging-port=9229 のように、後ろの引数は Electron にそのまま渡す
const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
