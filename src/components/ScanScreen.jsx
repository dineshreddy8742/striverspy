// ── ScanScreen.jsx v2 ─────────────────────────────────────────────────────────
// Plain English live status. Dark/light via CSS variables. No emojis.

const STATUS_CONFIG = {
  IDLE: {
    type: 'info',
    title: 'Ready to scan',
    body: 'Press Start when you are ready. Make sure your face is in frame.',
  },
  CALIBRATING: {
    type: 'info',
    title: 'Calibrating camera...',
    body: 'Please stay still and look directly at the camera.',
  },
  NO_FACE: {
    type: 'warning',
    title: 'No face detected',
    body: 'Please position your face so it fills the camera frame.',
  },
  FACE_TOO_FAR: {
    type: 'warning',
    title: 'Face is too far away',
    body: 'Move closer to the camera until your face fills most of the frame.',
  },
  HAIR_COVERING: {
    type: 'warning',
    title: 'Forehead may be covered',
    body: 'Please move hair, headscarf, or any head covering away from your forehead.',
  },
  LOW_LIGHT: {
    type: 'warning',
    title: 'Lighting is too low',
    body: 'Move closer to a window or turn on a light above you. Face the light source.',
  },
  POOR_SIGNAL: {
    type: 'warning',
    title: 'Signal is weak',
    body: 'Stay completely still and face the light source directly.',
  },
  MOVE_LESS: {
    type: 'warning',
    title: 'Too much movement',
    body: 'Please stay as still as possible. Do not talk during the scan.',
  },
  SCANNING: {
    type: 'info',
    title: 'Reading your vitals',
    body: 'Stay still and look at the camera. Almost done.',
  },
  COMPLETE: {
    type: 'success',
    title: 'Scan complete',
    body: 'Preparing your report...',
  },
};

export function ScanScreen({
  videoRef,
  canvasRef,
  faceDetected,
  progress,
  timeLeft,
  isLoading,
  onCancel,
  scanStatus = 'CALIBRATING',
  adaptiveModes = { lowLight: false, lowFps: false },
  activityBanner = null,
  darkMode,
  onToggleDark,
  blinks = 0,
}) {
  const cfg = STATUS_CONFIG[scanStatus] || STATUS_CONFIG['CALIBRATING'];

  const progressLabel = progress < 100
    ? `Reading vitals — ${timeLeft} second${timeLeft !== 1 ? 's' : ''} remaining`
    : 'Scan complete — preparing report...';

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

      {/* Sub-header */}
      <div className="scan-sub-header">
        <div className="scan-title">Health Check</div>
        <div className="scan-step">Step 2 of 2</div>
      </div>

      {/* Camera */}
      <div className="camera-wrapper">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-feed"
        />
        <canvas
          ref={canvasRef}
          className="camera-overlay"
        />
        {isLoading && (
          <div className="camera-loading">
            <div className="spinner" />
            <span>Initializing camera...</span>
          </div>
        )}
      </div>

      {/* Adaptive mode badges */}
      {adaptiveModes.lowLight && (
        <span className="mode-badge">Low light mode active</span>
      )}
      {adaptiveModes.lowFps && (
        <span className="mode-badge">Extended scan for accuracy</span>
      )}

      {/* Post-exercise / activity banner */}
      {activityBanner && (
        <div className="status-card warning" style={{ marginTop: '8px' }}>
          <div className="status-title">Elevated activity detected</div>
          <div className="status-body">{activityBanner}</div>
        </div>
      )}

      {/* Live status */}
      <div className={`status-card ${cfg.type}`}>
        <div className="status-title">{cfg.title}</div>
        <div className="status-body">
          {cfg.body}
          {progress > 0 && progress < 100 && (
            <div style={{ marginTop: '5px', fontWeight: '600' }}>
              Blinks detected: {blinks} (blink naturally)
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="progress-section">
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="progress-text">
          <span>{progressLabel}</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Tips */}
      <div className="scan-tips">
        <div className="tips-title">Tips for best results</div>
        <div className="tip-row"><span className="tip-bullet">-</span><span>Face the light source directly</span></div>
        <div className="tip-row"><span className="tip-bullet">-</span><span>Remove glasses if possible</span></div>
        <div className="tip-row"><span className="tip-bullet">-</span><span>Move hair away from your forehead</span></div>
        <div className="tip-row"><span className="tip-bullet">-</span><span>Do not move or talk during the scan</span></div>
      </div>

      {/* Cancel */}
      <button
        id="cancel-scan-btn"
        className="cancel-btn"
        onClick={onCancel}
        type="button"
      >
        Cancel Scan
      </button>

    </div>
  );
}
