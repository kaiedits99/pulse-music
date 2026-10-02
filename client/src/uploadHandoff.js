// Hands the files chosen in the post-sign-in "share your music" prompt over to the Upload page.
// Plain module state on purpose: File objects don't belong in browser history, and a reload
// of /upload must not bring old files back. `takeFiles` empties the slot, so each pick is used once.
export const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac';

let pending = [];

export function stashFiles(files) {
  pending = Array.from(files || []);
}

export function takeFiles() {
  const files = pending;
  pending = [];
  return files;
}
