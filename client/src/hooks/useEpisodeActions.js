import { useCallback } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { setEpisodeSaved } from '../episodes.js';

/**
 * Toggle "Save for later" on a podcast episode, optimistically, and keep the
 * player queue in sync so the button state matches wherever it is shown.
 * Accepts either an API episode row or a player track (see episodes.js).
 */
export function useEpisodeSaveToggle() {
  const { patchTrack } = usePlayer();
  const { toast } = useToast();

  return useCallback(async (episode) => {
    if (!episode) return;
    const episodeId = episode.episode_id ?? episode.id;
    const trackId = episode.kind === 'episode' ? episode.id : `ep-${episodeId}`;
    const next = !episode.saved;

    episode.saved = next ? 1 : 0; // optimistic, mirrors useFavoriteToggle
    patchTrack(trackId, { saved: next ? 1 : 0 });
    try {
      await setEpisodeSaved(episodeId, next);
      toast(next ? 'Saved to Your Episodes' : 'Removed from Your Episodes', next ? 'success' : 'info');
    } catch (err) {
      episode.saved = next ? 0 : 1;
      patchTrack(trackId, { saved: next ? 0 : 1 });
      toast(err.message || 'Could not update this episode', 'error');
    }
  }, [patchTrack, toast]);
}

export default useEpisodeSaveToggle;
