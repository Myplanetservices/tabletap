/* Load .env once for local runs (server.js and scripts). On Vercel the platform
   injects env vars and there is no .env file, so this is a no-op there. */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
