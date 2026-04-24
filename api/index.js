import appPromise from '../.arc/node/app.js';
import { handle } from 'hono/vercel';

const app = await appPromise;
const router = app?.router ?? app;

if (!router || typeof router.fetch !== 'function') {
  throw new Error('LumiARQ Vercel adapter expected a Hono app at app.router.');
}

export const config = { runtime: 'nodejs' };
export default handle(router);
