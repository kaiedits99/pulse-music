import { Link } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

// Decoration only: an equalizer whose bars each peak at a different height. Fixed values keep it
// looking organic and identical on every visit (and it holds still for people who prefer less motion).
const BARS = Array.from({ length: 28 }, (_, i) => ({
  peak: (0.42 + 0.58 * Math.abs(Math.sin(i * 1.7 + 0.6))).toFixed(2)
}));

/**
 * The front door: what a signed-out visitor sees at "/".
 * It says what Pulse is, explains in small print how sharing works, and leads to sign-up / sign-in.
 */
export default function Landing() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="landing">
      <header className="landing-top">
        <Link to="/" className="landing-brand" aria-label="Pulse">
          <span className="brand-logo"><Icon name="wave" size={22} /></span>
          <span>Pulse</span>
        </Link>
        <div className="landing-top-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          >
            <Icon name={isDark ? 'sun' : 'moon'} size={19} />
          </button>
          <Link className="btn btn-ghost btn-pill" to="/login">Sign in</Link>
        </div>
      </header>

      <main className="landing-main">
        <div className="landing-bars" aria-hidden="true">
          {BARS.map((bar, i) => (
            <span key={i} style={{ '--i': i, '--peak': bar.peak }} />
          ))}
        </div>

        <h1 className="landing-title">
          Welcome to Pulse,
          <span>the world's first global music sharing app</span>
        </h1>

        <div className="landing-cta">
          <Link className="btn btn-primary btn-lg" to="/signup">
            Get started <Icon name="chevronRight" size={18} />
          </Link>
          <Link className="btn btn-ghost btn-lg" to="/login">Sign in</Link>
        </div>

        <p className="landing-fineprint">
          Pulse allows users to upload their music for other users to see and listen to. Create an account to
          share your own tracks and to discover what people around the world are sharing. You choose whether
          each track you upload is public or private.
        </p>
      </main>
    </div>
  );
}
