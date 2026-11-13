import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:lan`：同じ Wi-Fi の端末（ノート PC・スマホ）から開けるようにする。
// WebGPU は https（か localhost）でしか使えないので、自己署名の証明書で https にする。
// 初めて開く時はブラウザに警告が出るので「詳細設定 → アクセスする」で進む。
export default defineConfig(({ mode }) => ({
  plugins: mode === 'lan' ? [basicSsl()] : [],
  server: mode === 'lan' ? { host: true, port: 5173 } : undefined,
}));
