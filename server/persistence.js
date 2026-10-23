// Can this server lose its data?
//
// Pulse keeps everything — accounts, the catalogue, uploaded audio — in one folder on the machine it
// runs on. Some hosts (Render's free plan among them) hand out a *temporary* filesystem: the folder
// exists while the instance lives and is recreated empty on the next deploy or restart. That is why
// users had to sign up again and why songs disappeared after an update: nothing was broken in the app,
// the host was throwing the files away.
//
// Two setups keep the data: an object-storage bucket (uploads + Litestream database copies) or a real
// disk attached to the instance. PULSE_PERSISTENT_DISK=true declares the second one, because a mounted
// disk looks no different from a temporary folder from inside the process.
export function dataSafety({ remote = false, env = process.env } = {}) {
  const bucket = Boolean(remote);
  const disk = String(env.PULSE_PERSISTENT_DISK || '').toLowerCase() === 'true';
  const persistent = bucket || disk;

  if (persistent) {
    return {
      persistent: true,
      keeps: bucket ? 'bucket' : 'disk',
      message: bucket
        ? 'Uploads and database copies are kept in object storage, so deploys and restarts keep every account and song.'
        : 'Data lives on a disk attached to this instance, so deploys and restarts keep every account and song.'
    };
  }

  return {
    persistent: false,
    keeps: 'temporary',
    message:
      'This server is using a temporary disk. Every deploy, restart or sleep erases accounts, songs and '
      + 'messages. Configure the S3_* bucket settings or attach a disk, then set PULSE_PERSISTENT_DISK=true '
      + '(see DEPLOY.md).'
  };
}

/** A startup line that cannot be mistaken for noise. */
export function describeDataSafety(safety, { host = process.env.RENDER ? 'Render' : 'this host' } = {}) {
  if (safety.persistent) return `[pulse] Data is safe across restarts (${safety.keeps}).`;
  return (
    `[pulse] WARNING: ${host} is keeping Pulse's database and uploads on a TEMPORARY disk. `
    + 'A deploy, restart or sleep will erase every account and song. Configure S3_* (a free Cloudflare R2 '
    + 'bucket is enough) or attach a disk and set PULSE_PERSISTENT_DISK=true — see DEPLOY.md.'
  );
}
