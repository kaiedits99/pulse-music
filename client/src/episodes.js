// Podcast episodes in the music player.
//
// Episodes are not songs — they live in their own tables and have their own
// routes — but they have to travel through the same player queue and the same
// offline cache. This module is the one place that adapts between the two
// shapes, so the rest of the app never has to special-case an episode beyond
// checking `kind === 'episode'`.
//
// The player id is the string `ep-<id>` on purpose: the offline index and the
// player queue are keyed by id, and a numeric episode id would collide with the
// song that happens to share that number.
import { api } from './api.js';

export const EPISODES_EVENT = 'pulse-episodes-changed';

export function notifyEpisodesChanged() {
  window.dispatchEvent(new CustomEvent(EPISODES_EVENT));
}

/** Convert an API episode row into a player/offline track. */
export function episodeToTrack(episode, show) {
  if (!episode) return null;
  const showTitle = episode.podcast_title || show?.title || 'Podcast';
  return {
    id: `ep-${episode.id}`,
    episode_id: episode.id,
    podcast_id: episode.podcast_id ?? show?.id ?? null,
    kind: 'episode',
    title: episode.title || 'Untitled episode',
    artist_name: showTitle,
    album_title: showTitle,
    cover_url: episode.cover_url || show?.cover_url || null,
    duration_seconds: episode.duration_seconds || 0,
    file_path: episode.file_path || null,
    description: episode.description || '',
    published_at: episode.published_at || null,
    episode_number: episode.episode_number ?? null,
    saved: !!episode.saved,
    position_seconds: episode.position_seconds || 0,
    completed: !!episode.completed
  };
}

export const episodesToTracks = (list, show) => (list || []).map((e) => episodeToTrack(e, show)).filter(Boolean);

export const isEpisode = (item) => !!item && item.kind === 'episode';

/** Resume point, ignoring "basically finished" and "basically not started". */
export function resumeAt(episode) {
  const pos = episode?.position_seconds || 0;
  const dur = episode?.duration_seconds || 0;
  if (episode?.completed) return 0;
  if (pos < 3) return 0;
  if (dur && pos > dur - 5) return 0;
  return pos;
}

export function progressPercent(episode) {
  const dur = episode?.duration_seconds || 0;
  if (!dur) return 0;
  if (episode?.completed) return 100;
  return Math.max(0, Math.min(100, ((episode.position_seconds || 0) / dur) * 100));
}

/* ------------------------------------------------------------- mutations */

export async function setEpisodeSaved(episodeId, saved) {
  if (saved) await api.post(`/api/episodes/${episodeId}/save`);
  else await api.del(`/api/episodes/${episodeId}/save`);
  notifyEpisodesChanged();
  return saved;
}

export async function setPodcastSubscribed(podcastId, subscribed) {
  if (subscribed) await api.post(`/api/podcasts/${podcastId}/subscribe`);
  else await api.del(`/api/podcasts/${podcastId}/subscribe`);
  notifyEpisodesChanged();
  return subscribed;
}

export function saveEpisodeProgress(episodeId, positionSeconds, completed = false) {
  return api.put(`/api/episodes/${episodeId}/progress`, {
    position_seconds: positionSeconds,
    completed
  }).catch(() => {});
}
