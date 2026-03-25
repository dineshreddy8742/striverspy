import React from 'react';
import { renderToString } from 'react-dom/server';
import { ReportScreen } from './src/components/ReportScreen.jsx';

const mockResults = {
  hr: 75,
  rmssd: 45,
  ibis: [800, 810, 790, 805, 800, 810, 800, 790],
  signal: new Array(300).fill(0),
  pi: 1.5,
  confidence: 90,
  fps: 30,
  rChannel: new Array(90).fill(100),
  gChannel: new Array(90).fill(100),
  bChannel: new Array(90).fill(100),
  skinBaseline: 1.2
};

try {
  const html = renderToString(React.createElement(ReportScreen, {
    results: mockResults,
    patientInfo: {},
    qualityWarning: null,
    activityBanner: null,
    adaptiveModes: {},
    onReset: () => {},
    darkMode: false,
    onToggleDark: () => {}
  }));
  console.log("RENDER SUCCESS: ", html.length, "bytes generated.");
} catch (e) {
  console.error("RENDER CRASH:", e.stack);
}
