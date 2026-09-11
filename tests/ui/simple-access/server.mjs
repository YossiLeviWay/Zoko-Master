import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const server = await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: 5191, fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } } });
await server.listen(); server.printUrls();
