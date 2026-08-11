import { useApp } from '../store.jsx';
import { Icon } from './icons.jsx';

const SECTIONS = [
  {
    key: 'mode',
    label: 'Color scheme',
    hint: 'Choose a light or dark scheme.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
  {
    key: 'sidebarColor',
    label: 'Sidebar color',
    hint: 'Independent of the color scheme above.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'gradient', label: 'Gradient' },
    ],
  },
  {
    key: 'topbarColor',
    label: 'Topbar color',
    hint: 'Choose a light or dark topbar.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
  },
  {
    key: 'layoutWidth',
    label: 'Layout width',
    hint: 'Fluid fills the screen; boxed caps the page on wide monitors.',
    options: [
      { value: 'fluid', label: 'Fluid' },
      { value: 'boxed', label: 'Boxed' },
    ],
  },
  {
    key: 'sidebarSize',
    label: 'Sidebar size',
    hint: 'Compact and icon-only reclaim width for the page.',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'compact', label: 'Compact' },
      { value: 'icon', label: 'Icon only' },
    ],
  },
];

function Swatch({ section, value, label, active, onClick }) {
  return (
    <button
      type="button"
      className={`tc-swatch ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} ${section}`}
      data-section={section}
      data-value={value}
    >
      <span className={`tc-mock tc-mock-${section}-${value}`}>
        <span className="tc-mock-sidebar" />
        <span className="tc-mock-main">
          <span className="tc-mock-topbar" />
          <span className="tc-mock-line" />
          <span className="tc-mock-line short" />
        </span>
      </span>
      {active && (
        <span className="tc-swatch-check">
          <Icon name="check" size={10} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

export default function ThemeCustomizer({ open, onClose }) {
  const { user, themePrefs, setThemePrefs, resetThemePrefs } = useApp();

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel tc-panel">
        <header className="panel-head tc-head">
          <span className="tc-head-icon">
            <Icon name="sliders" size={15} />
          </span>
          <h2 className="grow">Theme Customizer</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="panel-body tc-body">
          <div className="tc-sync-note">
            <Icon name={user ? 'shield' : 'info'} size={13} />
            {user
              ? 'Saved to your account — follows you to any device you sign in on.'
              : 'Sign in to save this to your account. For now it is kept on this browser only.'}
          </div>

          {SECTIONS.map((section) => (
            <div className="tc-section" key={section.key}>
              <div className="tc-section-head">
                <div className="tc-label">{section.label.toUpperCase()}</div>
                <div className="tc-hint">{section.hint}</div>
              </div>
              <div className="tc-grid">
                {section.options.map((option) => (
                  <div className="tc-item" key={option.value}>
                    <Swatch
                      section={section.key}
                      value={option.value}
                      label={option.label}
                      active={themePrefs[section.key] === option.value}
                      onClick={() => setThemePrefs({ [section.key]: option.value })}
                    />
                    <div className="tc-item-label">{option.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button className="btn block" style={{ marginTop: 4 }} onClick={resetThemePrefs}>
            <Icon name="refresh" size={13} />
            Reset to default
          </button>
        </div>
      </aside>
    </>
  );
}
