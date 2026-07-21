import { Moon } from '@phosphor-icons/react/Moon';
import { Sun } from '@phosphor-icons/react/Sun';
import { useTheme } from '../lib/useTheme';

interface ThemeToggleProps {
  className?: string;
}

/** Compact, icon-only GLP theme control shared by setup and live interview. */
export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';

  return (
    <button
      className={`glp-theme-toggle ${className}`.trim()}
      type="button"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {theme === 'dark' ? (
        <Sun size={16} data-icon-library="phosphor" aria-hidden="true" />
      ) : (
        <Moon size={16} data-icon-library="phosphor" aria-hidden="true" />
      )}
    </button>
  );
}
