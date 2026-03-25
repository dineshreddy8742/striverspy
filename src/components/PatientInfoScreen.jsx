// ── PatientInfoScreen.jsx ─────────────────────────────────────────────────────
// Optional patient details before scan.
// Name, age, gender. All optional. Can be skipped entirely.
// No emojis. Light/dark mode via CSS variables.

import { useState } from 'react';

export function PatientInfoScreen({ onContinue, onSkip, darkMode, onToggleDark }) {
  const [name,      setName]      = useState('');
  const [age,       setAge]       = useState('');
  const [gender,    setGender]    = useState(null); // null | 'Male' | 'Female' | 'Other'
  const [ageError,  setAgeError]  = useState('');

  function validate() {
    if (age !== '') {
      const n = parseInt(age);
      if (isNaN(n) || n < 1 || n > 120) {
        setAgeError('Please enter a valid age (1 to 120).');
        return false;
      }
    }
    setAgeError('');
    return true;
  }

  function handleContinue() {
    if (!validate()) return;
    onContinue({ name: name.trim(), age: age.trim(), gender });
  }

  function handleSkip() {
    onSkip();
  }

  const genders = ['Male', 'Female', 'Other'];

  return (
    <div className="screen">

      {/* Header */}
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
      <div className="pi-heading">
        <div className="pi-title">Patient Information</div>
        <div className="pi-subtitle">
          This helps personalise your report and show age-appropriate ranges.
          All fields are optional.
        </div>
      </div>

      {/* Name */}
      <div className="pi-field">
        <label className="pi-label" htmlFor="patient-name">
          Full Name (optional)
        </label>
        <input
          id="patient-name"
          className="pi-input"
          type="text"
          placeholder="e.g. Ramesh Kumar"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="off"
        />
      </div>

      {/* Age */}
      <div className="pi-field">
        <label className="pi-label" htmlFor="patient-age">
          Age
        </label>
        <input
          id="patient-age"
          className={`pi-input${ageError ? ' pi-input-error' : ''}`}
          type="number"
          inputMode="numeric"
          placeholder="e.g. 45"
          min="1"
          max="120"
          value={age}
          onChange={e => { setAge(e.target.value); setAgeError(''); }}
        />
        {ageError && (
          <div className="pi-error">{ageError}</div>
        )}
        <div className="pi-hint">
          Used to show age-appropriate normal ranges in the report.
        </div>
      </div>

      {/* Gender */}
      <div className="pi-field">
        <label className="pi-label">Gender (optional)</label>
        <div className="pi-gender-row">
          {genders.map(g => (
            <button
              key={g}
              type="button"
              className={`pi-gender-btn${gender === g ? ' selected' : ''}`}
              onClick={() => setGender(prev => prev === g ? null : g)}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="pi-hint">
          Women have slightly different HRV normal ranges. Selecting gender improves accuracy.
        </div>
      </div>

      {/* Continue button */}
      <button
        id="continue-to-scan-btn"
        className="start-btn"
        onClick={handleContinue}
        type="button"
      >
        CONTINUE TO SCAN
      </button>

      {/* Skip */}
      <button
        id="skip-patient-info-btn"
        className="pi-skip-btn"
        onClick={handleSkip}
        type="button"
      >
        Skip — scan without patient details
      </button>

    </div>
  );
}
