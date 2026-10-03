// Linked tracks: songs that live on YouTube and play through YouTube's own embedded
// player. Pulse never downloads, rips or proxies the audio — it stores the video id
// and hands playback to YouTube's iframe player, which their terms do allow.
//
// This module owns two things: recognising which links can be embedded at all, and
// fetching public metadata from YouTube's keyless oEmbed endpoint.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// Hosts that are pages *about* music rather than media a browser can play or embed on
// our behalf. Pasting one should get an explanation, not a silent dead track.
const UNSUPPORTED_HOSTS = [
  { match: /(^|\.)spotify\.com$|(^|\.)spotify\.link$/, label: 'Spotify' },
  { match: /(^|\.)music\.apple\.com$|(^|\.)itunes\.apple\.com$/, label: 'Apple Music' },
  { match: /(^|\.)audiomack\.com$/, label: 'Audiomack' },
  { match: /(^|\.)soundcloud\.com$/, label: 'SoundCloud' },
  { match: /(^|\.)deezer\.com$/, label: 'Deezer' },
  { match: /(^|\.)tidal\.com$/, label: 'TIDAL' },
  { match: /(^|\.)music\.amazon\.[a-z.]+$|(^|\.)amazon\.[a-z.]+$/, label: 'Amazon Music' }
];

const YOUTUBE_HOSTS = /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/;

// Public, keyless: returns title / author_name / thumbnail_url without any API key.
// Overridable so tests (and self-hosted mirrors) can point somewhere local.
export const oembedEndpoint = () =>
  process.env.YOUTUBE_OEMBED_BASE || 'https://www.youtube.com/oembed';

/** The provider label if the host is a music service we cannot embed, otherwise null. */
export function unsupportedProvider(rawUrl) {
  const url = asUrl(rawUrl);
  if (!url || YOUTUBE_HOSTS.test(url.hostname)) return null;
  const hit = UNSUPPORTED_HOSTS.find((entry) => entry.match.test(url.hostname));
  return hit ? hit.label : null;
}

function asUrl(value) {
  try {
    return new URL(String(value || '').trim());
  } catch {
    return null;
  }
}

/**
 * Pull the video id out of every link shape YouTube hands out: watch pages, youtu.be
 * short links, Shorts, live, /embed and the music subdomain. Returns null when the
 * link is not a YouTube video.
 */
export function parseYouTubeId(value) {
  const url = asUrl(value);
  if (!url || !YOUTUBE_HOSTS.test(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const candidate =
    url.hostname.endsWith('youtu.be')
      ? segments[0]
      : url.searchParams.get('v') ||
        (['embed', 'shorts', 'live', 'v'].includes(segments[0]) ? segments[1] : segments[0]);

  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const embedUrl = (id) => `https://www.youtube.com/embed/${id}`;
// Every video id has a thumbnail at a predictable address, so a track still shows artwork
// when oEmbed is unreachable (no internet, rate limited).
const thumbnailUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/**
 * Turn a pasted link into a linked-track payload, or throw a 400 that says what to do
 * instead. Metadata comes from oEmbed; when that endpoint is unreachable the track can
 * still be saved — the title is simply left for the user to fill in.
 */
export async function describeLink(rawUrl, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const url = asUrl(rawUrl);
  if (!url || url.protocol !== 'https:') {
    throw badRequest('Paste a full https:// link to the track you want to add.');
  }

  const provider = unsupportedProvider(url.toString());
  if (provider) {
    throw badRequest(
      `${provider} links cannot be embedded or converted, so Pulse can't play them. ` +
      'Upload the audio file you own, or link a YouTube video instead.'
    );
  }

  const id = parseYouTubeId(url.toString());
  if (!id) {
    throw badRequest(
      "That link isn't a YouTube video. Paste a youtube.com/watch, youtu.be or YouTube Shorts link — " +
      'or upload an audio file.'
    );
  }

  const metadata = await fetchOembed(id, { fetchImpl, timeoutMs });
  return {
    provider: 'youtube',
    external_id: id,
    embed_url: embedUrl(id),
    watch_url: watchUrl(id),
    title: metadata?.title || null,
    artist: metadata?.author_name || null,
    cover_url: metadata?.thumbnail_url || thumbnailUrl(id),
    metadata_found: Boolean(metadata)
  };
}

async function fetchOembed(id, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${oembedEndpoint()}?url=${encodeURIComponent(watchUrl(id))}&format=json`;
    const res = await fetchImpl(endpoint, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return null;
    const body = await res.json();
    return {
      title: typeof body.title === 'string' ? body.title.slice(0, 250) : null,
      author_name: typeof body.author_name === 'string' ? body.author_name.slice(0, 120) : null,
      thumbnail_url: typeof body.thumbnail_url === 'string' ? body.thumbnail_url : null
    };
  } catch {
    // Offline, rate limited, or the video was removed — the link itself is still valid.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * Validate the provider/external_id pair coming from a save request.
 * Returns null when there is no linked track on the payload.
 */
export function readLinkedFields(body = {}) {
  if (body.provider === undefined || body.provider === null || body.provider === '') return null;
  const provider = String(body.provider).trim().toLowerCase();
  if (provider !== 'youtube') throw badRequest(`Linked playback is not supported for "${provider}".`);
  const id = String(body.external_id || '').trim();
  if (!VIDEO_ID.test(id)) throw badRequest('That YouTube video id is not valid.');
  return { provider, external_id: id };
}
