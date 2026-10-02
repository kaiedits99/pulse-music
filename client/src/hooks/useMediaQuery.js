import { useEffect, useState } from 'react';

const supported = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Tracks a CSS media query, e.g. `useMediaQuery('(max-width: 560px)')`. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (supported() ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported()) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
