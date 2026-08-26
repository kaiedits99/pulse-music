import { Component } from 'react';

/**
 * Catches render errors in its children and shows a recovery UI instead of
 * crashing the entire React tree (which produces the blank/black screen).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log in development so crashes are still visible in the console.
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info?.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback, minimal } = this.props;
      if (fallback) return fallback;
      if (minimal) {
        return (
          <div className="playerbar playerbar--error" role="alert">
            <span className="player-error-msg">
              Player error — <button className="link-btn" onClick={this.handleReset}>retry</button>
            </span>
          </div>
        );
      }
      return (
        <div className="error-boundary-fallback" role="alert">
          <p>Something went wrong.</p>
          <button className="btn btn-primary" onClick={this.handleReset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
