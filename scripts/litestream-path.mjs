// Prints the path of the Litestream program that npm installed for this computer (the
// @flydotio/litestream package ships one per platform). Prints nothing and exits 1 when there is none,
// which is normal on a machine that never uses Litestream.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'node_modules', '@flydotio', `litestream-${process.platform}-${process.arch}`, 'litestream');

if (!fs.existsSync(binary)) process.exit(1);
console.log(binary);
