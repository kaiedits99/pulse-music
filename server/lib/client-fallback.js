// What a request that matched no file should get.
//
// The client is a single-page app, so a deep link such as /albums/12 has to answer with
// index.html. A *file* request is different: answering /assets/index-abc.js with index.html and
// status 200 is how a phone ends up unable to start — the WebView refuses to run a web page as a
// script, and a service worker may store that page under the script's URL so every later load
// fails too. Files that are missing get an honest 404 instead.
import path from 'path';

/** Directories (under the build) whose contents are files, never routes. */
const FILE_DIRECTORIES = ['/assets/', '/static/', '/fonts/'];

/** Extensions that can only ever be a file. */
const FILE_EXTENSION = /\.(?:m?js|css|map|json|webmanifest|txt|xml|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico|mp3|wav|ogg|m4a|mp4|webm|pdf|apk)$/i;

/**
 * True when the path names a file rather than an app route.
 * `/manifest.webmanifest` and `/icon.svg` are files too, which is why the extension list matters.
 */
export function looksLikeFileRequest(requestPath) {
  const pathname = String(requestPath || '').split('?')[0].split('#')[0];
  if (FILE_DIRECTORIES.some((dir) => pathname.startsWith(dir))) return true;
  return FILE_EXTENSION.test(pathname);
}

/** Headers for a missing file: short-lived, so a stale client cannot pin a 404 for long. */
export function missingFileHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    ...extra
  };
}

/** The index.html a route should get. Kept here so the server and its tests agree on the path. */
export function indexFileFor(dist) {
  return path.join(dist, 'index.html');
}
