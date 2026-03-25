// ── LandingScreen.jsx v2 ──────────────────────────────────────────────────────
// No emojis. Light/dark via CSS variables. Plain English throughout.

export function LandingScreen({ onStart, darkMode, onToggleDark }) {
  const features = [
    { name: 'Heart Rate',           desc: 'How fast your heart is beating, in beats per minute.' },
    { name: 'Heart Rhythm',         desc: 'Whether your heartbeat is regular or irregular. Helps screen for atrial fibrillation.' },
    { name: 'Stress Level',         desc: 'How much strain your nervous system is under right now, based on heart rhythm variation.' },
    { name: 'Blood Flow',           desc: 'How well blood is circulating to your skin surface. Not an oxygen level reading.' },
    { name: 'Nervous System Balance', desc: 'Whether your body is in a calm resting state or a stress response.' },
    { name: 'Skin Color Check',     desc: 'A basic indicator of whether skin color detected suggests unusual paleness.' },
  ];

  const steps = [
    'Enter patient name and age (optional)',
    'Allow camera access when asked',
    'Position face so it fills the camera frame',
    'Stay completely still for 25 seconds',
    'Get your personalised health check report',
  ];

  return (
    <div className="screen">

      {/* Sticky header */}
      <header className="app-header">
        <div className="app-header-left">
          <span className="app-logo">StriversEye</span>
        </div>
        <button
          className="dark-toggle"
          onClick={onToggleDark}
          type="button"
          aria-label="Toggle dark mode"
        >
          {darkMode ? 'Light' : 'Dark'}
        </button>
      </header>

      {/* Title */}
      <div className="landing-heading">
        <div className="landing-title">Contactless Health Check</div>
        <div className="landing-subtitle">No equipment needed — uses your device camera</div>
      </div>

      {/* What this checks */}
      <div className="section-header">What this checks</div>

      {features.map(f => (
        <div key={f.name} className="feature-card">
          <div className="feature-name">{f.name}</div>
          <div className="feature-desc">{f.desc}</div>
        </div>
      ))}

      {/* How it works */}
      <div className="section-header">How it works</div>

      <div className="how-it-works">
        {steps.map((step, i) => (
          <div key={i} className="how-step">
            <div className="step-number">{i + 1}</div>
            <div>{step}</div>
          </div>
        ))}
      </div>

      {/* Start */}
      <button
        id="start-health-check-btn"
        className="start-btn"
        onClick={onStart}
        type="button"
      >
        START HEALTH CHECK
      </button>

      {/* Disclaimer */}
      <p className="landing-disclaimer">
        This is a research tool. It is not a replacement for a doctor.<br />
        Results are indicative only. A 25-second scan is used for accuracy.
      </p>

    </div>
  );
}
