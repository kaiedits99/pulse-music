import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'pulse_theme';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return 'dark';
}

function applyThemeToDom(theme) {
  try {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(`theme-${theme}`);
    document.body.setAttribute('data-theme', theme);
  } catch { /* ignore */ }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const setTheme = useCallback((nextTheme) => {
    const valid = nextTheme === 'light' ? 'light' : 'dark';
    setThemeState(valid);
    try {
      localStorage.setItem(STORAGE_KEY, valid);
    } catch { /* ignore */ }
    applyThemeToDom(valid);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: 'dark',
      setTheme: () => {},
      toggleTheme: () => {},
      isDark: true
    };
  }
  return ctx;
}
