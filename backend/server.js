import 'dotenv/config';
import http from 'node:http';
import { nodeHandler } from './lib/node-adapter.js';

const port = process.env.PORT || 3000;
http.createServer(nodeHandler).listen(port, () => {
  console.log(`Kelvorne admin API listening on http://localhost:${port}/api/v1/admin`);
});
