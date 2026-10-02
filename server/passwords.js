// Password hashing that does not freeze the server.
//
// bcrypt is deliberately slow: about 80 ms on a fast computer, and most of a second on the small share of a
// CPU that a free host gives you. Done on the main thread, nothing else can happen meanwhile: pages, API
// calls and other sign-ins all wait. bcryptjs's own "asynchronous" functions do not help much. They only
// pause between 100 ms slices of work, so a hash shorter than that runs in one go, and hashes that overlap
// still run back to back.
//
// So the hashing happens on a separate thread, one at a time, and the main thread keeps answering requests.
// The hashes are ordinary bcrypt (cost 10), exactly what was stored before, so every existing account keeps working.
import { Worker } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

const COST = 10;

export function createPasswordService({
  createWorker = () => new Worker(new URL('./password-worker.js', import.meta.url)),
  cost = COST
} = {}) {
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  const failAll = (err) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
  };

  function startWorker() {
    const thread = createWorker();
    thread.unref?.(); // an idle helper thread must never keep the server process alive
    thread.on('message', ({ id, result, error }) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    });
    const lost = (err) => {
      if (worker === thread) worker = null;
      failAll(Object.assign(err, { threadFailed: true }));
    };
    thread.on('error', lost);
    thread.on('exit', () => lost(new Error('The password thread stopped')));
    return thread;
  }

  const inThisThread = (op, args) => (op === 'hash' ? bcrypt.hash(args[0], cost) : bcrypt.compare(args[0], args[1]));

  async function run(op, ...args) {
    try {
      return await new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try {
          worker = worker || startWorker();
          worker.postMessage({ id, op, args, cost });
        } catch (err) {
          pending.delete(id);
          reject(Object.assign(err, { threadFailed: true }));
        }
      });
    } catch (err) {
      // If the helper thread could not be used at all, sign-ins must still work: do it here, the slow way.
      if (err.threadFailed) return inThisThread(op, args);
      throw err;
    }
  }

  return {
    hashPassword: (password) => run('hash', password),
    verifyPassword: (password, hash) => run('verify', password, hash),
    /** Stops the helper thread. A new one starts the next time it is needed. */
    stop: async () => {
      const thread = worker;
      worker = null;
      if (thread) await thread.terminate();
    }
  };
}

const service = createPasswordService();
export const { hashPassword, verifyPassword } = service;
export const stopPasswordThread = service.stop;
