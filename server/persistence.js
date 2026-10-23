// Can this server lose its data?
//
// Pulse keeps two things, and they are kept by *different* mechanisms. That distinction matters more
// than it sounds: a deployment can show a perfectly healthy bucket while the database behind it is
// still on a disk that gets wiped, which is exactly how "the songs and accounts vanished but the
// storage says bucket" happens.
//
//   uploads  audio, covers, avatars — copied to the object-storage bucket on upload (or live on a disk)
//   database accounts, catalogue, playlists, messages — only durable if it is on a real disk, or if
//            Litestream is copying it to the bucket while the server runs
//
// Litestream is not part of the server process: scripts/start-with-litestream.sh starts it and runs the
// server underneath. A host whose start command is `npm start` therefore gets the bucket for uploads
// and nothing at all for the database. The start script sets PULSE_DB_REPLICATED=1 so this module can
// tell the two situations apart from inside the process.
//
// PULSE_PERSISTENT_DISK=true declares "this instance has a real disk", because a mounted disk looks
// exactly like a temporary folder from in here.
const yes = (value) => String(value ?? '').toLowerCase() === 'true';

/**
 * @param {object} options
 * @param {boolean} options.remote  uploads go to object storage (the server was built with S3_* set)
 * @param {object}  [options.env]   environment to read
 * @param {boolean} [options.managedHost]  the host wipes its disk between deploys (Render's free plan)
 */
export function dataSafety({ remote = false, env = process.env, managedHost } = {}) {
  const bucket = Boolean(remote);
  const disk = yes(env.PULSE_PERSISTENT_DISK);
  // Anything but an explicit "1" from the start script means Litestream is not running. Being strict
  // here is deliberate: claiming the database is replicated when it is not is the worst failure mode.
  const replicated = env.PULSE_DB_REPLICATED === '1';
  const host = managedHost ?? Boolean(env.RENDER);

  const uploadsDurable = bucket || disk;
  const databaseDurable = disk || replicated;

  const uploads = {
    durable: uploadsDurable,
    where: bucket ? 'bucket' : disk ? 'disk' : 'temporary',
    message: bucket
      ? 'Uploaded audio and artwork are in object storage and survive every deploy and restart.'
      : disk
        ? 'Uploaded audio and artwork are on this instance’s disk and survive deploys and restarts.'
        : 'Uploaded audio and artwork sit on a temporary disk: a deploy, restart or sleep erases them.'
  };

  const database = {
    durable: databaseDurable,
    where: replicated ? 'bucket' : disk ? 'disk' : 'temporary',
    replicated,
    message: replicated
      ? 'Accounts, songs, playlists and messages are copied to the bucket by Litestream and restored when the server starts.'
      : disk
        ? 'Accounts, songs, playlists and messages are on this instance’s disk and survive deploys and restarts.'
        : 'Accounts, songs, playlists and messages are on a temporary disk: a deploy, restart or sleep erases them.'
  };

  const issues = [];
  if (!uploadsDurable) {
    issues.push({
      code: 'uploads-on-temporary-disk',
      area: 'uploads',
      message: 'Uploaded files are not being kept anywhere durable.'
    });
  }
  if (!databaseDurable) {
    // The confusing half-state: a bucket is configured, so everything *looks* fine, but the database
    // is never copied to it because the server was not started through the Litestream wrapper.
    issues.push({
      code: bucket ? 'database-not-replicated' : 'database-on-temporary-disk',
      area: 'database',
      message: bucket
        ? 'A bucket is configured, so uploads are safe — but the database is not being copied to it. '
          + 'The start command must run `npm run start:render` (which starts Litestream); with `npm start` '
          + 'accounts, songs and messages stay on the temporary disk and are erased on every deploy.'
        : 'The database is not being kept anywhere durable.'
    });
  }

  const persistent = uploadsDurable && databaseDurable;

  let keeps = 'temporary';
  if (persistent) keeps = replicated || bucket ? 'bucket' : 'disk';

  let message;
  if (persistent) {
    message = replicated
      ? 'Uploads and database copies are kept in object storage, so deploys and restarts keep every account and song.'
      : 'Data lives on a disk attached to this instance, so deploys and restarts keep every account and song.';
  } else if (bucket) {
    message =
      'Uploads are safe in the bucket, but the database is on a temporary disk. Every deploy, restart '
      + 'or sleep erases accounts, songs, playlists and messages — the audio files stay behind, which is why '
      + 'the library can look half-empty. The start command must be `npm run start:render` so Litestream '
      + 'copies the database to the bucket (see DEPLOY.md).';
  } else {
    message =
      'This server is using a temporary disk. Every deploy, restart or sleep erases accounts, songs and '
      + 'messages. Configure the S3_* bucket settings or attach a disk, then set PULSE_PERSISTENT_DISK=true '
      + '(see DEPLOY.md).';
  }

  return {
    persistent,
    keeps,
    host: host ? 'managed' : 'local',
    uploads,
    database,
    issues,
    message
  };
}

/** One startup line that cannot be mistaken for noise. */
export function describeDataSafety(safety, { host = process.env.RENDER ? 'Render' : 'this host' } = {}) {
  if (safety.persistent) return `[pulse] Data is safe across restarts (${safety.keeps}).`;
  if (safety.uploads?.durable && !safety.database?.durable) {
    return (
      `[pulse] WARNING: uploads are safe (${safety.uploads.where}) but the DATABASE is not. `
      + 'Accounts, songs, playlists and messages will be erased by the next deploy. The start command '
      + 'must be `npm run start:render`, which runs the database under Litestream — see DEPLOY.md.'
    );
  }
  return (
    `[pulse] WARNING: ${host} is keeping Pulse's database and uploads on a TEMPORARY disk. `
    + 'A deploy, restart or sleep will erase every account and song. Configure S3_* (a free Cloudflare R2 '
    + 'bucket is enough) or attach a disk and set PULSE_PERSISTENT_DISK=true — see DEPLOY.md.'
  );
}
