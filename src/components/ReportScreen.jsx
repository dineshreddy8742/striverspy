// ── ReportScreen.jsx v3 ────────────────────────────────────────────────────────
// Two-column desktop layout, medical graph panels, patient info in PDF/copy,
// age-adjusted normal ranges, confidence badges, scan quality banner.
// No emojis. CSS variables throughout.

import { useState, useCallback, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import {
  computeTriageScore,
  classifyStress,
  classifyStressTemporal,
  computeAfib,
  computeAutonomic,
  computeMorphology,
  computeAnemia,
  computeHRVMeta,
  generateRecommendations,
  getNormalRanges,
} from '../utils/triageScore.js';
import { classifyAfibStatistical } from '../utils/afibClassifier.js';
import { PoincarePlot } from './PoincarePlot.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function CollapsibleSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible-section">
      <button
        className="collapsible-header"
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-toggle">{open ? '-' : '+'}</span>
      </button>
      <div className={`collapsible-body${open ? '' : ' closed'}`}>
        {children}
      </div>
    </div>
  );
}

function ConfidenceBadge({ value }) {
  if (value === undefined || value === null) return null;
  const cls = value >= 70 ? 'conf-high' : value >= 40 ? 'conf-medium' : 'conf-low';
  const label = value >= 70 ? 'High confidence' : value >= 40 ? 'Moderate confidence' : 'Low confidence — rescan';
  return <span className={`conf-badge ${cls}`}>{label} ({value}%)</span>;
}

function MetricCard({
  label, value, unit, unitFull,
  status, pillClass, statusText,
  explanation, actionText, confidence,
}) {
  return (
    <div className={`metric-card status-${(status || 'normal').toLowerCase().replace(/_/g, '-').replace(/ /g, '-')}`}>
      <div className="metric-label">{label}</div>
      {value !== undefined && value !== null && (
        <div className="metric-value-row">
          <span className="metric-value">{value}</span>
          {unit && <span className="metric-unit">{unit}</span>}
        </div>
      )}
      {unitFull && <div className="metric-unit-full">{unitFull}</div>}
      <div className={`metric-status-pill ${pillClass}`}>{statusText}</div>
      {confidence !== undefined && <ConfidenceBadge value={confidence} />}
      {explanation && <div className="metric-explanation">{explanation}</div>}
      {actionText && <div className="metric-action">{actionText}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN QUALITY BANNER
// ─────────────────────────────────────────────────────────────────────────────

function ScanQualityBanner({ confidence, lowLightMode, extendedScan }) {
  const level = confidence >= 80 ? 'good' : confidence >= 60 ? 'fair' : 'poor';
  return (
    <div className={`quality-banner quality-${level}`}>
      <div className="quality-score">
        Scan Quality: {confidence}%
        {confidence >= 80 ? ' — Good' : confidence >= 60 ? ' — Fair' : ' — Poor'}
      </div>
      <div className="quality-flags">
        {lowLightMode && (
          <span className="quality-flag">Low light mode was active</span>
        )}
        {extendedScan && (
          <span className="quality-flag">Extended scan was used</span>
        )}
        {confidence < 60 && (
          <span className="quality-flag warn">
            Low confidence — consider rescanning in better lighting
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH PANEL: POINCARE PLOT
// ─────────────────────────────────────────────────────────────────────────────

function PoincarePlotPanel({ ibis, sd1, sd2, risk, confidence, afibMarkers }) {
  return (
    <div className="graph-panel">
      <div className="graph-header">
        <div className="graph-title">Heartbeat Regularity Chart</div>
        <div className="graph-subtitle">Poincare Plot — clinical rhythm analysis</div>
      </div>

      <div className="graph-explanation">
        <p>
          Each dot represents one heartbeat plotted against the next one.
          In a healthy regular heart, dots form a tight oval along the
          diagonal line. A scattered or circular pattern may indicate
          irregular rhythm.
        </p>
      </div>

      <div className="graph-body">
        <PoincarePlot ibis={ibis} sd1={sd1} sd2={sd2} risk={risk} />
        <div className="graph-legend">
          <div className="legend-item">
            <div className="legend-dot tight" />
            <span>Tight oval cluster = Regular rhythm (normal finding)</span>
          </div>
          <div className="legend-item">
            <div className="legend-dot scattered" />
            <span>Scattered dots = Irregular rhythm (needs checking)</span>
          </div>
        </div>
      </div>

      <div className="graph-inference">
        <div className="inference-label">What this shows</div>
        <div className="inference-body">
          {risk === 'LOW' && 'The dot pattern shows a regular, oval cluster. This is consistent with a normal sinus rhythm.'}
          {risk === 'MODERATE' && 'The dot pattern shows some scatter. This may indicate mild heart rate variability or slight irregularity. Monitor over time.'}
          {risk === 'HIGH' && 'The dot pattern is more scattered than expected. This pattern is associated with irregular heartbeat. An ECG test is recommended to confirm.'}
          {risk === 'INSUFFICIENT' && 'Not enough heartbeats were recorded to plot a reliable pattern. Extend scan time for this analysis.'}
        </div>
        <div className="inference-stats">
          SD1: {Math.round(sd1 || 0)}ms (beat-to-beat variation)
          &nbsp;|&nbsp;
          SD2: {Math.round(sd2 || 0)}ms (overall variation)
          &nbsp;|&nbsp;
          Confidence: {confidence}%
        </div>
      </div>

      {afibMarkers && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-3)',
                        textTransform: 'uppercase', letterSpacing: '0.07em',
                        marginBottom: '6px' }}>
            Rhythm analysis markers
          </div>
          <div className="afib-markers">
            {[
              { key: 'rmssd',   label: 'RMSSD',   val: `${afibMarkers.rmssd.value}ms`,   thr: `${afibMarkers.rmssd.threshold}ms` },
              { key: 'entropy', label: 'Entropy',  val: String(afibMarkers.entropy.value), thr: String(afibMarkers.entropy.threshold) },
              { key: 'sd1sd2',  label: 'SD1/SD2',  val: String(afibMarkers.sd1sd2.value), thr: String(afibMarkers.sd1sd2.threshold) },
              { key: 'cv',      label: 'CV',        val: String(afibMarkers.cv.value),     thr: String(afibMarkers.cv.threshold) },
            ].map(({ key, label, val, thr }) => {
              const flagged = afibMarkers[key].flagged;
              return (
                <div key={key} className={`afib-row${flagged ? ' flagged' : ''}`}>
                  <span className="afib-row-label">{label}</span>
                  <span className="afib-row-val">{val} (flag if &gt;{thr})</span>
                  <span className="afib-row-flag"
                        style={{ color: flagged ? 'var(--amber)' : 'var(--green)' }}>
                    {flagged ? 'flag' : 'ok'}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '8px' }}>
            Score {'>'}= 3 flags AND confidence {'>'}= 40% required for CONCERN status.
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH PANEL: AUTONOMIC BALANCE (LF/HF)
// ─────────────────────────────────────────────────────────────────────────────

function AutonomicBalancePanel({ lfhf, lfNorm, hfNorm, state, description }) {
  const markerPos = Math.min(Math.max((lfhf / 8), 0), 1) * 100;

  return (
    <div className="graph-panel">
      <div className="graph-header">
        <div className="graph-title">Nervous System Balance</div>
        <div className="graph-subtitle">LF/HF Autonomic Analysis</div>
      </div>

      <div className="graph-explanation">
        <p>
          This measures the balance between the calming nervous system
          (parasympathetic) and the stress response system (sympathetic).
          The vertical line shows where the patient sits on the calm-to-stressed scale.
        </p>
      </div>

      <div className="autonomic-scale">
        <div className="scale-labels">
          <span>Very Calm</span>
          <span>Balanced</span>
          <span>Stressed</span>
        </div>
        <div className="scale-bar">
          <div className="zone calm"    style={{ width: '37%' }} />
          <div className="zone balanced" style={{ width: '37%' }} />
          <div className="zone stressed" style={{ width: '26%' }} />
          <div className="scale-marker" style={{ left: `${markerPos}%` }} />
        </div>
        <div className="scale-values">
          <span>0</span>
          <span>1.5</span>
          <span>4.0</span>
          <span>8+</span>
        </div>
        <div className="scale-current">
          Current: {lfhf} — {state}
        </div>
      </div>

      <div className="lfhf-bars">
        <div className="lfhf-row">
          <span className="lfhf-label">Calm system (HF)</span>
          <div className="lfhf-track">
            <div className="lfhf-fill hf" style={{ width: `${hfNorm}%` }} />
          </div>
          <span className="lfhf-pct">{hfNorm}%</span>
        </div>
        <div className="lfhf-row">
          <span className="lfhf-label">Alert system (LF)</span>
          <div className="lfhf-track">
            <div className="lfhf-fill lf" style={{ width: `${lfNorm}%` }} />
          </div>
          <span className="lfhf-pct">{lfNorm}%</span>
        </div>
      </div>

      <div className="graph-inference">
        <div className="inference-label">What this means</div>
        <div className="inference-body">
          {state === 'Parasympathetic' && 'Body is in rest and recovery mode. Calming nervous system is dominant. This is a healthy finding.'}
          {state === 'Balanced' && 'Body is in a balanced state. Neither stressed nor overly relaxed. This is a normal finding.'}
          {state === 'Sympathetic' && 'Stress response system is dominant. Body is in an alert or stressed state. Encourage rest and relaxation.'}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH PANEL: PULSE WAVEFORM
// ─────────────────────────────────────────────────────────────────────────────

function PulseWaveformPanel({ displayWaveform, aix, stiffness }) {
  if (!displayWaveform || displayWaveform.length < 10) return null;

  const WIDTH  = 280;
  const HEIGHT = 80;
  const PAD    = 10;

  const points = displayWaveform.map((v, i) => {
    const x = PAD + (i / (displayWaveform.length - 1)) * (WIDTH - 2 * PAD);
    const y = PAD + (1 - v) * (HEIGHT - 2 * PAD);
    return `${x},${y}`;
  }).join(' ');

  const gridLines = [];
  for(let i=1; i<10; i++){
    gridLines.push(<line key={'v'+i} x1={PAD + i*((WIDTH-2*PAD)/10)} y1={PAD} x2={PAD + i*((WIDTH-2*PAD)/10)} y2={HEIGHT-PAD} stroke="var(--border)" strokeWidth="0.5" strokeOpacity="0.5" />);
  }
  for(let i=1; i<4; i++){
    gridLines.push(<line key={'h'+i} x1={PAD} y1={PAD + i*((HEIGHT-2*PAD)/4)} x2={WIDTH-PAD} y2={PAD + i*((HEIGHT-2*PAD)/4)} stroke="var(--border)" strokeWidth="0.5" strokeOpacity="0.5" />);
  }

  return (
    <div className="graph-panel">
      <div className="graph-header">
        <div className="graph-title">Pulse Wave Shape</div>
        <div className="graph-subtitle">Blood vessel flexibility estimation</div>
      </div>

      <div className="graph-explanation">
        <p>
          This shows the shape of one heartbeat pulse wave. The first peak
          is blood being pumped out. The small dip and second bump is the
          wave reflecting back from arteries. Flexible arteries show a
          later, smaller reflection — a sign of better vascular health.
        </p>
      </div>

      <div className="waveform-container">
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="waveform-svg"
          aria-label="Pulse waveform display"
        >
          <rect width={WIDTH} height={HEIGHT} fill="var(--bg-secondary)" rx="6" />
          {gridLines}
          <line
            x1={PAD} y1={HEIGHT / 2} x2={WIDTH - PAD} y2={HEIGHT / 2}
            stroke="var(--border)" strokeWidth="1" strokeDasharray="3,3"
          />
          <polyline
            points={points}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x={PAD + 2} y={HEIGHT - 4} fill="var(--text-3)" fontSize="9">
            Start of beat
          </text>
          <text x={WIDTH - PAD - 60} y={HEIGHT - 4} fill="var(--text-3)" fontSize="9">
            End of beat
          </text>
        </svg>
      </div>

      <div className="graph-inference">
        <div className="inference-label">What this means</div>
        <div className="inference-body">
          Augmentation Index: {aix}% — {stiffness}.
          {aix < 10  && ' Blood vessels are flexible and elastic. Good sign of vascular health.'}
          {aix >= 10 && aix < 20 && ' Blood vessel flexibility is in the normal range.'}
          {aix >= 20 && aix < 30 && ' Blood vessels show mild stiffness. Normal finding in older adults. Monitor over time.'}
          {aix >= 30 && ' Blood vessels appear stiff. This may indicate cardiovascular risk factors. Consult a doctor.'}
        </div>
        <div className="inference-note">
          Note: This is an estimate only. Not a substitute for clinical arterial pressure testing.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HR meta — age-adjusted
// ─────────────────────────────────────────────────────────────────────────────
function getHrMeta(hr, ranges) {
  const { min, max } = ranges.hr;
  if (hr < min - 10) return {
    status: 'concern', pill: 'pill-concern',
    text: 'CONCERN — Significantly below normal',
    explanation: `Heart rate is ${hr} BPM, well below the expected range of ${min}–${max} BPM. This warrants clinical attention.`,
    action: 'Check again after 5 minutes of rest. Consult a doctor if it persists.',
  };
  if (hr < min) return {
    status: 'caution', pill: 'pill-caution',
    text: 'CAUTION — Slightly below normal',
    explanation: `Heart rate is ${hr} BPM, slightly below the expected range of ${min}–${max} BPM. May be normal for an athletic individual.`,
    action: 'Recheck if symptomatic.',
  };
  if (hr <= max) return {
    status: 'normal', pill: 'pill-normal',
    text: 'NORMAL',
    explanation: `Heart rate of ${hr} BPM is within the normal resting range of ${min}–${max} BPM.`,
    action: null,
  };
  if (hr <= max + 20) return {
    status: 'caution', pill: 'pill-caution',
    text: 'CAUTION — Elevated',
    explanation: `Heart rate is ${hr} BPM, above the normal resting range of ${min}–${max} BPM. Can be due to anxiety, activity, or caffeine.`,
    action: 'Ask the patient to rest 10 minutes and check again.',
  };
  return {
    status: 'concern', pill: 'pill-concern',
    text: 'CONCERN — Significantly elevated',
    explanation: `Heart rate is ${hr} BPM, significantly above normal. This warrants clinical evaluation.`,
    action: 'Seek clinical review if symptoms persist.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function generatePDF(results, patientInfo, metrics, ranges) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210, H = 297, M = 15;
  let y = 0;

  function ensureSpace(heightneeded) {
    if (y + heightneeded > H - 25) {
      doc.addPage();
      y = 15;
    }
  }

  function sectionHeader(title, color = [29,78,216], mt = 8) {
    ensureSpace(mt + 10);
    y += mt;
    doc.setFillColor(...color);
    doc.rect(M, y, W - 2*M, 6, 'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(title, M + 3, y + 4.5);
    y += 8;
  }

  function labelValueRow(label, value, statusText='', statusColor=[50,50,50]) {
    ensureSpace(12);
    
    // Column 1: Label (Max width 60mm | Ends around 75mm)
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(100,100,100);
    const labelLines = doc.splitTextToSize(String(label), 60);
    doc.text(labelLines, M, y);
    
    // Column 2: Value (Starts exactly at 78mm | Max width 90mm | Ends around 168mm)
    doc.setFontSize(8.5); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42);
    const valueLines = doc.splitTextToSize(String(value), 90);
    doc.text(valueLines, M + 63, y);
    
    // Column 3: Status Badge (Right aligned, naturally bounding right at ~180mm)
    if (statusText) {
      doc.setFontSize(7);
      const sw = doc.getTextWidth(statusText);
      doc.setFillColor(...statusColor);
      doc.roundedRect(W - M - sw - 6, y - 4, sw + 6, 5.5, 1, 1, 'F');
      doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
      doc.text(statusText, W - M - sw - 3, y);
    }
    
    // Dynamically space rows accounting for the thickest line wrap! 
    const maxLines = Math.max(labelLines.length, valueLines.length);
    y += (maxLines * 4) + 2.5;
    doc.setDrawColor(240,240,240); doc.line(M, y - 2.5, W-M, y - 2.5);
  }

  // 1. HEADER
  doc.setFillColor(29,78,216); doc.rect(0, 0, W, 18, 'F');
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
  doc.text('StriversEye Clinical Report', M, 11);
  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(147,197,253);
  const dateStr = new Date().toLocaleString();
  doc.text(`Generated: ${dateStr}`, W - M - doc.getTextWidth(`Generated: ${dateStr}`), 11);
  y = 22;

  // 2. PATIENT INFO
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42);
  doc.text(`Name: ${patientInfo?.name || 'Anonymous'}`, M, y);
  doc.text(`Age: ${patientInfo?.age || 'N/A'}`, M + 60, y);
  doc.text(`Gender: ${patientInfo?.gender || 'N/A'}`, M + 105, y);
  
  const sqText = `Signal Quality: ${results.confidence}%`;
  doc.text(sqText, W - M - doc.getTextWidth(sqText), y);
  y += 2;

  // 3. TRIAGE
  sectionHeader('1. OVERALL TRIAGE SCORE');
  const sc = metrics.triage.score;
  const scRgb = sc >= 75 ? [22,163,74] : sc >= 55 ? [217,119,6] : [220,38,38];
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(...scRgb);
  doc.text(`SCORE: ${sc}/100 — ${metrics.triage.status}`, M, y + 4);
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100);
  
  // Safe line wrapping for Triage explosion
  const triageLines = doc.splitTextToSize(metrics.triage.explanation, W - 2*M - 50);
  doc.text(triageLines, M, y + 10);
  y += 6 + (triageLines.length * 4);

  // 4. HEART RATE & HRV
  sectionHeader('2. CARDIAC MEASUREMENTS', [15,118,110], 4);
  const rng = ranges || {};
  const hrStatus = (results.hr >= (rng.hr?.min||60) && results.hr <= (rng.hr?.max||100)) ? 'NORMAL' : 'CAUTION';
  labelValueRow('Heart Rate', `${results.hr} BPM`, hrStatus, hrStatus === 'NORMAL' ? [22,163,74] : [220,38,38]);
  
  const rmssdStatus = results.rmssd > (rng.hrv?.normal||25) ? 'NORMAL' : 'STRESSED';
  labelValueRow('HRV (RMSSD)', `${Math.round(results.rmssd)} ms`, rmssdStatus, rmssdStatus === 'NORMAL' ? [29,78,216] : [220,38,38]);
  
  const piStatus = results.pi >= 0.5 ? 'NORMAL' : 'LOW SIGNAL';
  labelValueRow('Perfusion (Blood Flow)', `${results.pi}%`, piStatus, piStatus === 'NORMAL' ? [22,163,74] : [217,119,6]);

  // 5. RHYTHM (AFIB)
  sectionHeader('3. HEART RHYTHM (AFib Screen)', [71,85,105], 4);
  const afib = metrics.afib;
  if (!afib || afib.risk === 'INSUFFICIENT') {
    doc.setFontSize(8); doc.setTextColor(100,100,100);
    doc.text('Insufficient data for rhythm screening. Longer scan needed.', M, y + 2); y += 4;
  } else {
    labelValueRow('Rhythm Status', afib.label, afib.risk, afib.risk === 'LOW' ? [22,163,74] : [217,119,6]);
    labelValueRow('Confidence', `${afib.confidence}%`);
    if (afib.markers) {
      labelValueRow('Poincare Geometry (SD1/SD2)', `${afib.poincare?.sd1?.toFixed(1) || 0} ms / ${afib.poincare?.sd2?.toFixed(1) || 0} ms`);
    }
  }

  // 6. AUTONOMIC & SKIN
  sectionHeader('4. SECONDARY BIOMARKERS', [71,85,105], 4);
  const auto = metrics.autonomic;
  if (auto) {
    labelValueRow('Nervous System Balance', `${auto.lfhf} (${auto.state})`, auto.state === 'Parasympathetic' ? 'NORMAL' : 'CAUTION', auto.state === 'Parasympathetic' ? [22,163,74] : [217,119,6]);
  } else {
    labelValueRow('Nervous System Balance', 'Insufficient data');
  }
  
  if (metrics.anemia) {
    labelValueRow('Skin Color Consistency', metrics.anemia.indicator, metrics.anemia.cssStatus === 'normal' ? 'NORMAL' : 'CAUTION', metrics.anemia.cssStatus === 'normal' ? [22,163,74] : [217,119,6]);
  }

  // 7. PULSE WAVEFORM GRAPHIC
  ensureSpace(40);
  sectionHeader('5. PULSE WAVEFORM (MEDICAL TRACE)', [15,118,110], 6);
  if (metrics.morphology && metrics.morphology.displayWaveform && metrics.morphology.displayWaveform.length > 10) {
    const wf = metrics.morphology.displayWaveform;
    const gX = M, gY = y + 2, gW = W - 2*M, gH = 30;
    doc.setFillColor(248,250,252); doc.setDrawColor(226,232,240);
    doc.roundedRect(gX, gY, gW, gH, 3, 3, 'FD');
    doc.setLineWidth(0.2);
    for (let i = 1; i < 5; i++) doc.line(gX, gY + gH*i/5, gX + gW, gY + gH*i/5);
    for (let i = 1; i < 15; i++) doc.line(gX + gW*i/15, gY, gX + gW*i/15, gY + gH);
    
    // Fallback safe normalization bounds mapping to stop grid bleed
    const mn = Math.min(...wf), mx = Math.max(...wf), MathRange = mx - mn || 1;
    doc.setDrawColor(239,68,68); doc.setLineWidth(0.6);
    
    // Restricting exact coordinates to within padded block lines
    const pw = gW - 6, ph = gH - 6; 
    const toX = (i) => gX + 3 + (i / (wf.length - 1)) * pw;
    const toY = (v) => gY + 3 + ph * (1 - (v - mn) / MathRange);
    
    for (let i = 1; i < wf.length; i++) {
      doc.line(toX(i-1), toY(wf[i-1]), toX(i), toY(wf[i]));
    }
    
    y += gH + 8;
    const aix = metrics.morphology.aix;
    if (aix !== null && aix <= 60 && aix >= 0) {
      labelValueRow('Augmentation Index (AIx)', `${aix}% — ${metrics.morphology.stiffness}`);
    } else {
      labelValueRow('Arterial compliance', 'Unable to measure accurately');
    }
  } else {
    doc.setFontSize(8); doc.setTextColor(100,100,100);
    doc.text('Waveform data unavailable.', M, y + 2); y += 6;
  }

  // 8. RECOMMENDATIONS
  sectionHeader('6. CLINICAL RECOMMENDATIONS', [15,23,42], 4);
  const recs = metrics.recommendations || generateRecommendations({ hr: results.hr, rmssd: results.rmssd, afib: metrics.afib, pi: results.pi, autonomic: metrics.autonomic, ranges });
  recs.forEach(rec => {
    ensureSpace(15);
    doc.setFillColor(...(rec.flag === 'NORMAL' ? [22,163,74] : rec.flag === 'CAUTION' ? [217,119,6] : [220,38,38]));
    doc.circle(M + 2, y + 2.5, 1.5, 'F');
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(15,23,42);
    const lines = doc.splitTextToSize(rec.text, W - 2*M - 10);
    doc.text(lines, M + 7, y + 4); 
    y += lines.length * 4.5 + 2;
  });

  // 9. FOOTER DISCLAIMER ALWAYS ON BOTTOM ANCHOR
  ensureSpace(20);
  let anchorY = H - 22;
  if(y > H - 26) { doc.addPage(); anchorY = H - 22; }
  
  doc.setFillColor(254,242,242); doc.roundedRect(M, anchorY, W - 2*M, 14, 2, 2, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(185,28,28);
  doc.text('RESEARCH TOOL ONLY — NOT A MEDICAL DEVICE', M + 4, anchorY + 5);
  doc.setFont('helvetica','normal');
  doc.text('StriversEye is an experimental platform. Results are indicative only and not a medical diagnosis.', M + 4, anchorY + 9.5);
  
  const qualityStr = `Quality Confidence: ${results.confidence}%`;
  doc.text(qualityStr, W - M - doc.getTextWidth(qualityStr) - 4, anchorY + 9.5);

  const filename = patientInfo && patientInfo.name ? `StriversEye_${patientInfo.name.replace(/\s+/g,'_')}_${Date.now()}.pdf` : `StriversEye_Report_${Date.now()}.pdf`;
  doc.save(filename);
}


// ─────────────────────────────────────────────────────────────────────────────
// COPY TEXT GENERATION
// ─────────────────────────────────────────────────────────────────────────────

function generateCopyText(results, patientInfo, metrics, ranges) {
  const name   = patientInfo?.name   || 'Patient';
  const age    = patientInfo?.age    ? `Age ${patientInfo.age}` : '';
  const gender = patientInfo?.gender || '';
  const now    = new Date().toLocaleString('en-IN');
  const D      = '-'.repeat(40);

  const recs = generateRecommendations({
    hr: results.hr, rmssd: results.rmssd, afib: metrics.afib,
    pi: results.pi, autonomic: metrics.autonomic, ranges,
  });

  return [
    'VITALSCAN HEALTH REPORT',
    now,
    D,
    `PATIENT: ${[name, age, gender].filter(Boolean).join(', ')}`,
    'SCAN: 25-second contactless check',
    '',
    `TRIAGE SCORE: ${metrics.triage.score}/100 — ${metrics.triage.status}`,
    D,
    '',
    'HEART MEASUREMENTS',
    `Heart Rate:      ${results.hr} BPM`,
    `  Status:   ${results.hr >= ranges.hr.min && results.hr <= ranges.hr.max ? 'NORMAL' : 'SEE RECOMMENDATIONS'}`,
    `  Range:    ${ranges.hr.min}–${ranges.hr.max} BPM for this patient`,
    '',
    `Heart Rhythm:    ${metrics.afib.label}`,
    `  Risk:     ${metrics.afib.risk}`,
    `  Confidence: ${metrics.afib.confidence}%`,
    `  ${metrics.afib.risk === 'INSUFFICIENT' ? 'Too few heartbeats for rhythm analysis.' : ''}`,
    D,
    '',
    'STRESS AND NERVOUS SYSTEM',
    `Stress (HRV):    ${Math.round(results.rmssd)} ms`,
    `  Status:   ${results.rmssd >= ranges.hrv.normal ? 'NORMAL' : 'ELEVATED'}`,
    `  Range:    Above ${ranges.hrv.normal}ms = normal for this patient`,
    '',
    `Nervous System:  ${metrics.autonomic?.state || 'Insufficient data'}`,
    `  LF/HF:    ${metrics.autonomic?.lfhf || 'N/A'}`,
    D,
    '',
    'CIRCULATION',
    `Blood Flow:      ${results.pi}%  (not oxygen level)`,
    `  Status:   ${results.pi >= ranges.pi.min ? 'NORMAL' : 'WEAK SIGNAL'}`,
    `  Range:    ${ranges.pi.min}–${ranges.pi.max}% = normal`,
    '',
    `Vessel Health:   ${metrics.morphology?.stiffness || 'N/A'}`,
    `  AIx:      ${metrics.morphology?.aix !== undefined ? metrics.morphology.aix + '%' : 'N/A'}`,
    '',
    `Skin Color:      ${metrics.anemia?.indicator || 'N/A'}`,
    D,
    '',
    'NEXT STEPS:',
    ...recs.map(r => `[${r.flag}] ${r.text}`),
    D,
    `Signal Quality: ${results.confidence}%`,
    'IMPORTANT: Research tool only. Not a medical diagnosis.',
    'Confirm results with a qualified doctor before any clinical decision.',
    'StriversEye — Contactless Health Research',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export function ReportScreen({
  results,
  patientInfo,
  qualityWarning,
  activityBanner,
  adaptiveModes,
  onReset,
  darkMode,
  onToggleDark,
}) {
  useEffect(() => {
    console.log('[StriversEye Debug] Results received:', results);
    console.log('[StriversEye Debug] HR:', results?.hr);
    console.log('[StriversEye Debug] RMSSD:', results?.rmssd);
    console.log('[StriversEye Debug] IBIs count:', results?.ibis?.length);
    console.log('[StriversEye Debug] Signal length:', results?.signal?.length);
    console.log('[StriversEye Debug] PI:', results?.pi);
    console.log('[StriversEye Debug] Confidence:', results?.confidence);
    const autonomicTest = results?.ibis?.length >= 15 ? computeAutonomic(results.ibis) : null;
    console.log('[StriversEye Debug] Autonomic result:', autonomicTest);
  }, [results]);

  // Derive all metrics with robust null-safety and error handling
  let ranges, stress, afib, autonomic, morphology, anemia, triage, hrvMeta, recs;
  
  try {
    ranges     = getNormalRanges(patientInfo?.age, patientInfo?.gender);
    stress     = classifyStressTemporal(results?.rmssd || 0, results?.ibiHistory || [], results?.sessionSeconds || 25);
    afib       = classifyAfibStatistical(results?.ibis || []);
    autonomic  = (results?.ibis?.length >= 8) ? computeAutonomic(results.ibis) : null;
    morphology = (results?.signal?.length > 0 && results?.peaks?.length > 2) 
                 ? computeMorphology(results.signal, results.peaks, results.fps || 30) 
                 : null;
    anemia     = (results?.rChannel?.length && results?.gChannel?.length) 
                 ? computeAnemia(results.rChannel, results.gChannel, results.bChannel, results.skinBaseline) 
                 : null;
    triage     = computeTriageScore(results?.hr || 0, results?.rmssd || 0, results?.pi || 1, afib);
    hrvMeta    = computeHRVMeta(results?.rmssd || 0, results?.ibis || []);
    recs       = generateRecommendations({
      hr: results?.hr || 0, rmssd: results?.rmssd || 0, afib, pi: results?.pi || 1, autonomic, ranges,
    });
  } catch (err) {
    console.error('[StriversEye] CRITICAL: Metric derivation failed:', err);
    // Minimal fallback to prevent crash
    ranges = ranges || { hr: { min: 60, max: 100 }, hrv: { normal: 25, relaxed: 50, stressed: 15 }, pi: { min: 0.5, max: 2.0 } };
    stress = stress || { label: 'Unknown', cssStatus: 'normal', pill: 'pill-normal' };
    afib = afib || { risk: 'INSUFFICIENT', label: 'Analysis error', confidence: 0 };
    triage = triage || { score: 0, status: 'ERROR', explanation: 'Failed to process data.' };
    recs = recs || [{ flag: 'CAUTION', text: 'An error occurred during report generation. Please try scanning again.' }];
  }

  const metrics = { triage, afib, autonomic, morphology, anemia };
  const hrM = getHrMeta(results.hr, ranges);

  const scanTime = new Date().toLocaleString([], {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Stress action text
  const stressAction = results.rmssd < ranges.hrv.normal
    ? 'Encourage deep breathing and rest. Recheck after 15 minutes of calm.'
    : null;

  // ── Copy handler ────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const text = generateCopyText(results, patientInfo, metrics, ranges);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [results, patientInfo, metrics, ranges]); // eslint-disable-line

  // ── PDF handler ─────────────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);
  const handlePdf = useCallback(() => {
    setPdfLoading(true);
    try {
      generatePDF(results, patientInfo, metrics, ranges);
    } finally {
      setPdfLoading(false);
    }
  }, [results, patientInfo, metrics, ranges]); // eslint-disable-line

  // ── Score status colors (CSS variable names) ─────────────────────────
  const scoreBg     = triage.score >= 75 ? 'var(--green-bg)'  : triage.score >= 55 ? 'var(--amber-bg)'  : 'var(--red-bg)';
  const scoreColor  = triage.score >= 75 ? 'var(--green-text)' : triage.score >= 55 ? 'var(--amber-text)' : 'var(--red-text)';
  const scoreBorder = triage.score >= 75 ? 'var(--green-border)' : triage.score >= 55 ? 'var(--amber-border)' : 'var(--red-border)';

  // ── Afib display ─────────────────────────────────────────────────────
  const afibStatusText = afib.risk === 'LOW'          ? 'LOW RISK — Regular Rhythm'
    : afib.risk === 'MODERATE'   ? 'CAUTION — Some Irregularity'
    : afib.risk === 'HIGH'       ? 'CONCERN — Irregular Rhythm'
    : 'UNABLE TO DETERMINE';

  const afibPill = afib.risk === 'LOW'          ? 'pill-low-risk'
    : afib.risk === 'MODERATE'   ? 'pill-caution'
    : afib.risk === 'HIGH'       ? 'pill-concern'
    : 'pill-insufficient';

  const afibStatus = afib.risk === 'LOW' ? 'low-risk' : afib.risk === 'MODERATE' ? 'caution' : afib.risk === 'HIGH' ? 'concern' : 'insufficient';

  const afibExplanation = afib.risk === 'LOW'
    ? 'The heartbeat pattern appears normal and regular. No signs of irregular rhythm.'
    : afib.risk === 'MODERATE'
    ? 'A slightly irregular heartbeat pattern was detected. This may need further monitoring.'
    : afib.risk === 'HIGH'
    ? 'Multiple indicators of an irregular heartbeat were detected. This patient should be evaluated with an ECG.'
    : afib.explanation || 'Rhythm analysis could not be completed. Extend scan time or use a dedicated ECG device.';

  const afibAction = afib.risk === 'HIGH'
    ? 'Refer this patient to a doctor for an ECG test.'
    : afib.risk === 'MODERATE'
    ? 'Monitor over the next few days. Repeat the scan to confirm.'
    : afib.risk === 'INSUFFICIENT'
    ? 'To screen for rhythm issues, run a longer scan or use a dedicated ECG device.'
    : null;

  // ── Render ────────────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState('heart-rate');

  const hrStatusColor = hrM.status === 'normal' ? 'var(--green)' : hrM.status === 'caution' ? 'var(--amber)' : 'var(--red)';
  const hrStatusClass = hrM.status;
  const rmssdStatus = stress.label;
  const rmssdColor = stress.cssStatus === 'normal' ? 'var(--green)' : stress.cssStatus === 'caution' ? 'var(--amber)' : 'var(--red)';
  const afibBadgeColor = afib.risk === 'LOW' ? 'var(--green)' : afib.risk === 'MODERATE' ? 'var(--amber)' : 'var(--red)';
  const autonomicColor = !autonomic ? 'var(--text-3)' : autonomic.state === 'Parasympathetic' ? 'var(--green)' : autonomic.state === 'Balanced' ? 'var(--blue)' : 'var(--red)';
  
  const piStatus = results.pi >= ranges.pi.min ? 'NORMAL' : 'WEAK SIGNAL';
  const piColor = results.pi >= ranges.pi.min ? 'var(--green)' : 'var(--amber)';

  return (
    <div className="report-layout">

      {/* ── LEFT SIDEBAR ─────────────────────────── */}
      <aside className="report-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">StriversEye</div>
          <div className="sidebar-subtitle">Clinical Triage Report</div>
        </div>

        <nav className="sidebar-nav">
          {[
            { id: 'heart-rate',  icon: 'HR', label: 'Heart Rate',
              badge: results.hr ? `${results.hr} BPM` : null,
              badgeColor: hrStatusColor },
            { id: 'hrv',         icon: 'HV', label: 'HRV / Stress',
              badge: rmssdStatus, badgeColor: rmssdColor },
            (afib?.risk !== 'INSUFFICIENT' ? { id: 'afib',        icon: 'AF', label: 'Heart Rhythm',
              badge: afib?.risk || 'N/A', badgeColor: afibBadgeColor } : null),
            { id: 'autonomic',   icon: 'AU', label: 'Autonomic',
              badge: autonomic?.state || null, badgeColor: autonomicColor },
            { id: 'perfusion',   icon: 'PI', label: 'Blood Flow',
              badge: results.pi ? `${results.pi}%` : null, badgeColor: piColor },
            { id: 'waveform',    icon: 'PW', label: 'Pulse Shape', badge: null },
            { id: 'skin',        icon: 'SK', label: 'Skin Pallor', badge: null },
          ].filter(Boolean).map(item => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => {
                document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' })
                setActiveSection(item.id)
              }}
            >
              <span className="nav-icon"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '10px',
                             fontWeight: '800', color: 'var(--accent)' }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.badge && (
                <span className="nav-badge"
                      style={{ background: item.badgeColor + '20',
                               color: item.badgeColor }}>
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <button className="sidebar-btn sidebar-btn-primary" onClick={handlePdf} disabled={pdfLoading}>
            {pdfLoading ? 'Exporting...' : 'Export PDF'}
          </button>
          <button className="sidebar-btn sidebar-btn-secondary" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Report'}
          </button>
          <button className="sidebar-btn sidebar-btn-secondary" onClick={onReset}>
            New Scan
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────── */}
      <main className="report-main">

        {/* Scan quality banner */}
        <div className={`quality-banner quality-${
          results.confidence >= 80 ? 'good' : 
          results.confidence >= 60 ? 'fair' : 'poor'
        }`}>
          <span>
            Signal Quality: {results.confidence}%
            {results.confidence >= 80 ? ' — Good' :
             results.confidence >= 60 ? ' — Fair' : ' — Poor — consider rescanning'}
          </span>
          <span style={{fontSize:'11px', fontWeight:'400', opacity:0.8}}>
            {patientInfo?.name && `${patientInfo.name}`}
            {patientInfo?.age && ` · Age ${patientInfo.age}`}
            {patientInfo?.gender && ` · ${patientInfo.gender}`}
            {` · ${new Date().toLocaleDateString('en-IN')}`}
          </span>
        </div>

        {/* Low quality warning (if any) */}
        {qualityWarning && (
          <div className="status-card warning" style={{ marginBottom: '12px' }}>
            <div className="status-title">Scan quality notice</div>
            <div className="status-body">{qualityWarning}</div>
          </div>
        )}

        {/* ── PRIORITY ROW ─────────────────────── */}
        <div className="priority-row">

          {/* Heart Rate hero card */}
          <div className={`metric-card-v2 status-${hrStatusClass} section-anchor`} id="heart-rate">
            <div className="metric-label-small">Heart Rate</div>
            <div style={{display:'flex', alignItems:'baseline', gap:'8px'}}>
              <div className="metric-value-large">{results.hr}</div>
              <div className="metric-unit-label">BPM</div>
            </div>
            <div className="metric-unit-label">
              Beats per minute — normal {ranges.hr?.min || 60}–{ranges.hr?.max || 100} BPM
            </div>
            {/* Status pill */}
            <span className={`metric-status-pill pill-${hrStatusClass}`}>
              {hrM.text} ({results.confidence}% confidence)
            </span>
            {/* Confidence bar */}
            <div className="confidence-bar-container">
              <div className="confidence-bar-fill"
                   style={{
                     width: `${results.confidence}%`,
                     background: results.confidence >= 70 ? 'var(--green)' :
                                 results.confidence >= 40 ? 'var(--amber)' : 'var(--red)'
                   }} />
            </div>
            <div className="metric-explanation">
              Heart rate of {results.hr} BPM is
              {results.hr >= (ranges.hr?.min || 60) && results.hr <= (ranges.hr?.max || 100)
                ? ` within the normal resting range of ${ranges.hr?.min || 60}–${ranges.hr?.max || 100} BPM.`
                : ` outside the normal range. Clinical evaluation recommended.`}
            </div>
          </div>

          {/* Triage score arc */}
          <div className="triage-hero-card">
            <div className="metric-label-small">Overall Triage Score</div>
            {/* SVG arc gauge */}
            <svg className="triage-arc-svg" viewBox="0 0 130 80">
              <path d="M 15 75 A 50 50 0 1 1 115 75"
                    fill="none" stroke="var(--border)" strokeWidth="8"
                    strokeLinecap="round"/>
              <path d="M 15 75 A 50 50 0 1 1 115 75"
                    fill="none"
                    stroke={triage.color || (triage.score >= 75 ? 'var(--green)' : triage.score >= 55 ? 'var(--amber)' : 'var(--red)')}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(triage.score / 100) * 157} 157`}
                    style={{transition:'stroke-dasharray 1s ease'}}/>
              <text x="65" y="62" textAnchor="middle"
                    fontSize="24" fontWeight="800"
                    fill={triage.color || (triage.score >= 75 ? 'var(--green)' : triage.score >= 55 ? 'var(--amber)' : 'var(--red)')} fontFamily="monospace">
                {triage.score}
              </text>
              <text x="65" y="73" textAnchor="middle"
                    fontSize="7" fill="var(--text-3)" fontFamily="sans-serif">
                / 100
              </text>
            </svg>
            <span className="metric-status-pill"
                  style={{background: (triage.color || (triage.score >= 75 ? 'var(--green)' : triage.score >= 55 ? 'var(--amber)' : 'var(--red)')) + '20', color: (triage.color || (triage.score >= 75 ? 'var(--green)' : triage.score >= 55 ? 'var(--amber)' : 'var(--red)')),
                          fontSize:'12px', fontWeight:'700', letterSpacing:'0.04em',
                          padding:'4px 14px', borderRadius:'20px'}}>
              {triage.status}
            </span>
            <div style={{fontSize:'11px', color:'var(--text-3)', textAlign:'center',
                         lineHeight:'1.5', marginTop:'4px'}}>
              {triage.score >= 75
                ? 'All vital indicators within acceptable range.'
                : triage.score >= 55
                ? 'Some indicators require monitoring.'
                : 'Clinical evaluation recommended.'}
            </div>
          </div>
        </div>

        {/* ── METRICS GRID ─────────────────────── */}
        <div className="metrics-grid-2">

          {/* HRV card */}
          <div className="metric-card-v2 section-anchor" id="hrv"
               style={{borderLeftColor: rmssdColor,
                       borderLeftWidth:'3px', borderLeftStyle:'solid'}}>
            <div className="metric-label-small">Stress Level — HRV RMSSD</div>
            <div style={{display:'flex', alignItems:'baseline', gap:'6px'}}>
              <div className="metric-value-large"
                   style={{fontSize: results.rmssd > 999 ? '24px' : '36px'}}>
                {results.rmssdReliable === false
                  ? '---'
                  : Math.round(results.rmssd)}
              </div>
              <div className="metric-unit-label">ms</div>
            </div>
            {results.rmssd > 100 && (
              <div className="metric-warning"
                   style={{fontSize:'11px', color:'var(--amber-text)',
                           background:'var(--amber-bg)', padding:'6px 10px',
                           borderRadius:'6px', border:'1px solid var(--amber-border)'}}>
                Unusually high — may include noise. Rescan for accurate reading.
              </div>
            )}
            <span className="metric-status-pill"
                  style={{background: rmssdColor + '15', color: rmssdColor}}>
              {rmssdStatus}
            </span>
            <div className="metric-explanation">
              Lower HRV = more stress. Higher HRV = more relaxed.
              Normal for your age: above {ranges.hrv?.normal || 25}ms.
            </div>
            <div style={{fontSize:'10px', color:'var(--text-3)'}}>
              Source: Task Force ESC/NASPE, Circulation 1996, 857 subjects
            </div>
          </div>

          {/* Perfusion card */}
          <div className="metric-card-v2 section-anchor" id="perfusion"
               style={{borderLeftColor: piColor,
                       borderLeftWidth:'3px', borderLeftStyle:'solid'}}>
            <div className="metric-label-small">Blood Flow — Perfusion Index</div>
            <div style={{display:'flex', alignItems:'baseline', gap:'6px'}}>
              <div className="metric-value-large">{results.pi}</div>
              <div className="metric-unit-label">%</div>
            </div>
            <span className="metric-status-pill"
                  style={{background: piColor + '15', color: piColor}}>
              {piStatus}
            </span>
            <div className="metric-explanation">
              Blood flow strength at skin surface.
              Normal: 0.5–2.0%. NOT SpO2 or oxygen level.
            </div>
            <div style={{fontSize:'10px', color:'var(--text-3)'}}>
              Source: Reisner et al., Anesthesiology 2008, 100 ICU patients
            </div>
          </div>
        </div>

        {/* ── AFIB SECTION ─────────────────────── */}
        {afib?.risk !== 'INSUFFICIENT' && (
        <div className="advanced-card section-anchor" id="afib">
          <MetricCard
            label="Heart Rhythm (AFib Screen)"
            value={null}
            unit={null}
            unitFull={afib.label}
            status={afibStatus}
            pillClass={afibPill}
            statusText={afibStatusText}
            explanation={afibExplanation}
            actionText={afibAction}
            confidence={afib.confidence}
          />
          {afib.poincare && results.ibis.length >= 4 && (
            <div style={{marginTop: '14px'}}>
              <PoincarePlotPanel
                ibis={results.ibis}
                sd1={afib.poincare.sd1}
                sd2={afib.poincare.sd2}
                risk={afib.risk}
                confidence={afib.confidence}
                afibMarkers={afib.markers}
              />
            </div>
          )}
        </div>
        )}

        {/* ── AUTONOMIC ────────────────────────── */}
        <div className="advanced-card section-anchor" id="autonomic">
          {autonomic ? (
            <AutonomicBalancePanel
              lfhf={autonomic.lfhf}
              lfNorm={autonomic.lfNorm}
              hfNorm={autonomic.hfNorm}
              state={autonomic.state}
              description={autonomic.description}
            />
          ) : (
            <div className="metric-card" style={{borderLeft: '3px solid var(--border)'}}>
              <div className="metric-label" style={{marginBottom: '8px'}}>NERVOUS SYSTEM BALANCE</div>
              <div style={{fontSize: '16px', fontWeight: '600', color: 'var(--text-3)'}}>
                Insufficient data
              </div>
              <div className="metric-explanation" style={{marginTop: '8px'}}>
                Need 8+ heartbeat intervals for autonomic analysis.
                Extend scan time or rescan for this metric.
              </div>
            </div>
          )}
        </div>

        {/* ── PULSE WAVEFORM ───────────────────── */}
        <div className="section-anchor" id="waveform">
          {morphology && (
            <PulseWaveformPanel
              displayWaveform={morphology.displayWaveform}
              aix={morphology.aix}
              stiffness={morphology.stiffness}
            />
          )}
        </div>

        {/* ── SKIN ─────────────────────────────── */}
        <div className="section-anchor" id="skin">
          {anemia && (
            <div className={`metric-card status-${anemia.cssStatus}`}>
              <div className="metric-label">Skin Color Check</div>
              <div className="metric-unit-full">
                Baseline R/G: {anemia.baselineRG}
                {' → '}
                End R/G: {anemia.currentRG}
                {' | Change: '}{anemia.pallorRatio > 0 ? '+' : ''}{anemia.pallorRatio}%
              </div>
              <div className={`metric-status-pill ${
                anemia.cssStatus === 'normal' ? 'pill-normal' : 'pill-caution'
              }`}>
                {anemia.indicator.toUpperCase()}
              </div>
              <div className="metric-explanation">{anemia.description}</div>
              <div className="metric-action" style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-3)',
                border: '1px solid var(--border)',
              }}>
                {anemia.disclaimer}
              </div>
            </div>
          )}
        </div>
        
        {/* About This Report — validation references */}
        <CollapsibleSection title="About This Report — Sources and Validation">
          <div className="section-explainer">
            This scan uses validated signal processing algorithms from peer-reviewed research.
            All processing happens on your device. No data is sent anywhere.
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-2)', lineHeight: 1.8 }}>
            <div style={{ marginBottom: '10px' }}>
              <strong>Heart Rate (rPPG)</strong><br />
              Algorithm: CHROM (de Haan and Jeanne, IEEE TBME 2013)<br />
              Validated on: PURE dataset (MAE 1.82 BPM), UBFC-rPPG (MAE 2.1 BPM)
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>HRV / Stress (RMSSD & Temporal Pattern)</strong><br />
              Standard: Task Force of ESC/NASPE, Circulation 1996<br />
              Pattern Analysis: SWELL-KW (Koldijk 2014) & WESAD (Schmidt 2018)<br />
              Dataset: 857 healthy subjects. Normal ranges adjusted by age and gender.
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Heart Rhythm (AFib Screening)</strong><br />
              Algorithm: Brennan et al., IEEE TBME 2001 (Poincare geometry)<br />
              Thresholds: MIT-BIH Arrhythmia Database (Validated Bootstrap Analysis)<br />
              Confidence: Bayesian probability gate. Min 40% required for screening label.
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Autonomic Balance (LF/HF)</strong><br />
              Standard: Task Force 1996 spectral analysis guidelines<br />
              LF: 0.04-0.15 Hz, HF: 0.15-0.40 Hz
            </div>
            <div style={{ marginBottom: '10px' }}>
              <strong>Skin Color (Relative Baseline)</strong><br />
              Approach: Relative R/G change from scan-start baseline<br />
              Reference: Mannino et al., npj Digital Medicine 2022<br />
              Status: EXPERIMENTAL. Not a clinical pallor or anemia test.
            </div>
            <div style={{ marginBottom: '4px' }}>
              <strong>Liveness Detection</strong><br />
              Method: Green channel temporal variance (stdDev less than 0.3 = static image)<br />
              + Eye blink detection via EAR (Soukupova and Cech, CVWW 2016)
            </div>
          </div>
        </CollapsibleSection>

        {/* Disclaimer */}
        <div className="report-disclaimer" style={{marginTop: '14px'}}>
          IMPORTANT: This is a research tool. These results are indicative only.
          They are not a medical diagnosis. Always confirm with a qualified doctor
          before making any clinical decision.
        </div>

        {/* ── MOBILE BOTTOM NAV ────────────────── */}
        <nav className="mobile-bottom-nav">
          {[
            { id: 'heart-rate', icon: 'HR' },
            { id: 'hrv', icon: 'HV' },
            (afib?.risk !== 'INSUFFICIENT' ? { id: 'afib', icon: 'AF' } : null),
            { id: 'autonomic', icon: 'AU' },
            { id: 'perfusion', icon: 'PI' }
          ].filter(Boolean).map(item => (
            <button key={item.id}
                    onClick={() => {
                      document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' })
                      setActiveSection(item.id)
                    }}
                    style={{background:'none', border:'none',
                            fontSize:'10px', color: activeSection === item.id ? 'var(--accent)' : 'var(--text-2)',
                            display:'flex', flexDirection:'column',
                            alignItems:'center', gap:'3px',
                            padding:'6px 8px', cursor:'pointer'}}>
              <span style={{fontSize:'16px', fontFamily:'monospace',
                            fontWeight:'800', color: activeSection === item.id ? 'var(--accent)' : 'inherit'}}>
                {item.icon}
              </span>
            </button>
          ))}
        </nav>

      </main>
    </div>
  );
}
