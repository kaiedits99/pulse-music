// Runs on its own thread (see passwords.js): does the slow bcrypt work so the main thread never has to.
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

parentPort.on('message', ({ id, op, args, cost }) => {
  try {
    const result = op === 'hash' ? bcrypt.hashSync(args[0], cost) : bcrypt.compareSync(args[0], args[1]);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
