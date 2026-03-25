// ── App.jsx v3 ────────────────────────────────────────────────────────────────
// Screen flow: landing → patient-info → scanning → report
// Dark/light mode: auto-detects OS preference, toggle button on every screen.

import { useState, useEffect, useCallback } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { useScan } from './hooks/useScan.js';
import { LandingScreen } from './components/LandingScreen.jsx';
import { PatientInfoScreen } from './components/PatientInfoScreen.jsx';
import { ScanScreen } from './components/ScanScreen.jsx';
import { ReportScreen } from './components/ReportScreen.jsx';
import './App.css';

// Screens: 'landing' | 'patient-info' | 'scanning' | 'report'

export default function App() {
  const [screen, setScreen] = useState('landing'); // landing, patient-info, scanning, report
  const [patientInfo, setPatientInfo] = useState(null); // { name, age, gender }
  
  // Dark mode — read OS preference on first load
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const toggleDark = useCallback(() => setDarkMode(d => !d), []);
  
  const {
    isLoading,
    videoRef,
    canvasRef,
    faceDetected,
    scanning,
    progress,
    timeLeft,
    results,
    error,
    scanStatus,
    adaptiveModes,
    qualityWarning,
    activityBanner,
    startScan,
    stopAndReset,
    blinks,
  } = useScan(() => {
    setScreen('report');
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleLandingStart = useCallback(() => {
    setScreen('patient-info');
  }, []);

  const handlePatientInfoContinue = useCallback((info) => {
    setPatientInfo(info);
    setScreen('scanning');
    startScan();
  }, [startScan]);

  const handlePatientInfoSkip = useCallback(() => {
    setPatientInfo(null);
    setScreen('scanning');
    startScan();
  }, [startScan]);

  const handleCancel = useCallback(() => {
    stopAndReset();
    setScreen('landing');
  }, [stopAndReset]);

  const handleReset = useCallback(() => {
    stopAndReset();
    setPatientInfo(null);
    setScreen('landing');
  }, [stopAndReset]);

  // Force light mode during scan to act as a ring light for the face
  const isScanning = screen === 'scanning';
  const effectiveDarkMode = isScanning ? false : darkMode;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <ErrorBoundary>
      <div className={`app ${effectiveDarkMode ? 'dark' : 'light'}`}>

        {screen === 'landing' && (
          <LandingScreen
            onStart={handleLandingStart}
            darkMode={effectiveDarkMode}
            onToggleDark={toggleDark}
          />
        )}

        {screen === 'patient-info' && (
          <PatientInfoScreen
            onContinue={handlePatientInfoContinue}
            onSkip={handlePatientInfoSkip}
            darkMode={effectiveDarkMode}
            onToggleDark={toggleDark}
          />
        )}

        {/* ScanScreen always mounted once initialised to keep camera/MediaPipe alive */}
        <div style={{ display: screen === 'scanning' ? 'contents' : 'none' }}>
          <ScanScreen
            videoRef={videoRef}
            canvasRef={canvasRef}
            faceDetected={faceDetected}
            progress={progress}
            timeLeft={timeLeft}
            isLoading={isLoading}
            onCancel={handleCancel}
            scanStatus={scanStatus}
            adaptiveModes={adaptiveModes}
            activityBanner={activityBanner}
            darkMode={effectiveDarkMode}
            onToggleDark={toggleDark}
            blinks={blinks}
          />
        </div>

        {screen === 'report' && results && (
          <ReportScreen
            results={results}
            patientInfo={patientInfo}
            qualityWarning={qualityWarning}
            activityBanner={activityBanner}
            adaptiveModes={adaptiveModes}
            onReset={handleReset}
            darkMode={effectiveDarkMode}
            onToggleDark={toggleDark}
          />
        )}

        {error && (
          <div className="error-toast" role="alert">
            {error}
          </div>
        )}

      </div>
    </ErrorBoundary>
  );
}
