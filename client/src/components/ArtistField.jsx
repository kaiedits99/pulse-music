import { useAuth } from '../context/AuthContext.jsx';

/**
 * Free-text artist (owner) field with suggestions from existing artists.
 * Typing a name that matches an existing profile links the upload to it;
 * any other name creates a brand-new artist profile on the server.
 */
export default function ArtistField({ value, onChange, artists = [], listId = 'artist-options', label = 'Artist' }) {
  const { artist: ownArtist } = useAuth();
  const typed = value.trim();
  const match = typed ? artists.find((a) => a.name.toLowerCase() === typed.toLowerCase()) : null;

  let hint;
  if (!typed) {
    hint = ownArtist
      ? `Defaults to your artist profile — ${ownArtist.name}. Type any name to change the owner.`
      : 'Type the artist who owns this — a new profile is created if the name is new.';
  } else if (match) {
    hint = `Links to the existing artist profile — ${match.name}.`;
  } else {
    hint = `“${typed}” will be created as a new artist profile.`;
  }
  const hintCls = !typed ? '' : match ? ' ok' : ' new';

  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type the artist's name — existing or new"
        autoComplete="off"
        aria-label={label}
      />
      <datalist id={listId}>
        {artists.map((a) => <option key={a.id} value={a.name} />)}
      </datalist>
      <small className={`field-hint${hintCls}`}>{hint}</small>
    </>
  );
}
