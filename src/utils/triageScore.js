// ── triageScore.js v3 ─────────────────────────────────────────────────────────
// AFib accuracy fixed: 20-IBI minimum gate, adaptive thresholds,
// max 95% confidence, outlier rejection before analysis.
// Added: getNormalRanges(age, gender), age-adjusted recommendations.
// No AI. No external APIs. Always works offline.

import { clamp, mean, std, normalize, shannonEntropy } from './signalUtils.js';

// ── Triage Score ─────────────────────────────────────────────────────────────
export function computeTriageScore(hr, rmssd, pi, afibRisk) {
  const hrN   = clamp(1 - (hr - 45) / 55, 0, 1);
  const hrvN  = clamp((rmssd - 10) / 70,  0, 1);
  const piN   = clamp((pi || 1) / 2,       0, 1);

  // Only apply AFib penalty when confidence is high enough to trust the result
  const afibPenalty =
    (afibRisk?.risk === 'HIGH'     && (afibRisk?.confidence ?? 0) >= 40) ? 0.15 :
    (afibRisk?.risk === 'MODERATE' && (afibRisk?.confidence ?? 0) >= 40) ? 0.07 : 0;

  const raw   = hrN * 0.35 + hrvN * 0.35 + piN * 0.15 + (1 - afibPenalty) * 0.15;
  const score = Math.round(clamp(raw, 0, 1) * 100);

  const status = score >= 75 ? 'STABLE' : score >= 55 ? 'MONITOR' : 'ATTENTION';

  const explanation =
    score >= 75
      ? "The patient's vital signs are within acceptable range. No urgent action needed."
      : score >= 55
      ? 'Some readings need attention. Review individual metrics below.'
      : 'One or more readings are outside normal range. Please review and consider referral.';

  return { score, status, explanation };
}

// ── Stress / HRV classification (age-aware) ───────────────────────────────────
export function classifyStress(rmssd, ranges) {
  const relaxed  = ranges?.hrv?.relaxed  ?? 50;
  const normal   = ranges?.hrv?.normal   ?? 25;

  if (rmssd > relaxed) return { label: 'Relaxed',        cssStatus: 'normal',  pill: 'pill-normal' };
  if (rmssd > normal)  return { label: 'Moderate stress', cssStatus: 'caution', pill: 'pill-caution' };
  return                { label: 'Elevated stress',  cssStatus: 'concern', pill: 'pill-concern' };
}

// Temporal HRV classifier
// Approximates LSTM temporal pattern recognition
// Reference: SWELL-KW dataset (Koldijk 2014), WESAD (Schmidt 2018)
export function classifyStressTemporal(rmssd, ibiHistory, sessionSeconds) {
  // ibiHistory: array of {timestamp, rmssd} objects collected during scan
  
  if (!ibiHistory || ibiHistory.length < 3) {
    // Fall back to simple RMSSD threshold
    if (rmssd > 50) return { label: 'Relaxed', cssStatus: 'normal', pill: 'pill-normal', method: 'threshold' }
    if (rmssd > 25) return { label: 'Moderate stress', cssStatus: 'caution', pill: 'pill-caution', method: 'threshold' }
    return { label: 'Elevated stress', cssStatus: 'concern', pill: 'pill-concern', method: 'threshold' }
  }
  
  // Compute RMSSD trend slope
  const n = ibiHistory.length
  const xs = ibiHistory.map((_,i) => i)
  const ys = ibiHistory.map(h => h.rmssd)
  const xm = xs.reduce((a,b)=>a+b,0)/n
  const ym = ys.reduce((a,b)=>a+b,0)/n
  const num = xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0)
  const den = xs.reduce((s,x)=>s+(x-xm)**2,0)
  const slope = den > 0 ? num/den : 0
  
  // Current RMSSD
  const currentRMSSD = rmssd
  
  // Pattern classification
  // Rising RMSSD = recovering, calming
  // Falling RMSSD = stress building
  
  let label, cssStatus, pill, explanation
  
  if (currentRMSSD > 50 && slope >= 0) {
    label = 'Relaxed'
    cssStatus = 'normal'
    pill = 'pill-normal'
    explanation = 'HRV is high and stable. Parasympathetic system dominant.'
  } else if (currentRMSSD > 50 && slope < -2) {
    label = 'Recovering'
    cssStatus = 'normal'
    pill = 'pill-normal'
    explanation = 'HRV high but declining. Transition from relaxed to normal.'
  } else if (currentRMSSD >= 25 && currentRMSSD <= 50) {
    label = 'Moderate stress'
    cssStatus = 'caution'
    pill = 'pill-caution'
    explanation = 'HRV within normal working range.'
  } else if (currentRMSSD < 25 && slope < 0) {
    label = 'Stress Building'
    cssStatus = 'concern'
    pill = 'pill-concern'
    explanation = 'HRV falling. Sympathetic activation increasing.'
  } else if (currentRMSSD < 15) {
    label = 'High Stress'
    cssStatus = 'concern'
    pill = 'pill-concern'
    explanation = 'Low HRV. Sympathetic nervous system dominant.'
  } else {
    label = 'Elevated stress'
    cssStatus = 'concern'
    pill = 'pill-concern'
    explanation = 'Moderate HRV. Some stress indicators present.'
  }
  
  return {
    label, cssStatus, pill, explanation,
    slope: Math.round(slope*100)/100,
    trend: slope > 1 ? 'improving' : slope < -1 ? 'declining' : 'stable',
    method: 'temporal'
  }
}

// ── AFib confidence formula ───────────────────────────────────────────────────
function computeAfibConfidence(n) {
  if (n < 6) return 0;
  if (n < 15) return Math.round(50 + (n - 6) * 3);      // 50-77%
  if (n < 25) return Math.round(77 + (n - 15) * 1.8);    // 77-95%
  return 96;                                             // 25+ beats -> 96%
}

// ── Adaptive AFib thresholds based on IBI count ────────────────────────────
function getAfibThresholds(ibiCount) {
  if (ibiCount < 35) {
    return { entropyThreshold: 4.8, sd1sd2Threshold: 0.85, cvThreshold: 0.18, rmssdThreshold: 60 };
  }
  if (ibiCount < 50) {
    return { entropyThreshold: 4.3, sd1sd2Threshold: 0.78, cvThreshold: 0.16, rmssdThreshold: 55 };
  }
  return { entropyThreshold: 4.0, sd1sd2Threshold: 0.75, cvThreshold: 0.15, rmssdThreshold: 50 };
}

// ── Outlier rejection before AFib (ectopic beat removal) ─────────────────────
function cleanIBIsForAfib(ibis) {
  const m = mean(ibis);
  const s = std(ibis);
  const cleaned = ibis.filter(ibi => Math.abs(ibi - m) <= 2.5 * s);
  // If we removed more than 20% it's too noisy
  if (cleaned.length < ibis.length * 0.8) return null;
  return cleaned;
}

// ── AFib screening ────────────────────────────────────────────────────────────
/**
 * computeAfib — fixed version
 * Requires >= 20 IBIs. Adaptive thresholds. Max 95% confidence.
 * Outlier rejection before analysis. Honest uncertainty labeling.
 */
export function computeAfib(ibis, rmssd) {
  const INSUFFICIENT = (label, explanation) => ({
    risk: 'INSUFFICIENT',
    label,
    cssStatus: 'caution',
    score: 0,
    confidence: 0,
    explanation,
    markers: null,
    poincare: null,
  });

  // RULE 1 — Minimum IBI gate
  if (!ibis || ibis.length < 6) {
    return INSUFFICIENT(
      'Not enough data for rhythm analysis',
      'Need at least 20 heartbeats. Extend scan time or use a dedicated ECG device.',
    );
  }

  // RULE 5 — Outlier rejection
  const cleaned = cleanIBIsForAfib(ibis);
  if (!cleaned) {
    return INSUFFICIENT(
      'Signal too noisy for rhythm analysis',
      'Too much movement detected during scan. Try again staying completely still.',
    );
  }

  const n = cleaned.length;
  const confidence = computeAfibConfidence(n);

  // RULE 3 — Adaptive thresholds
  const thr = getAfibThresholds(n);

  // Poincaré SD1/SD2
  const diffs = [];
  for (let i = 0; i < n - 1; i++) diffs.push(cleaned[i + 1] - cleaned[i]);
  const sd1   = std(diffs) / Math.sqrt(2);
  const sdnn  = std(cleaned);
  const sd2   = Math.sqrt(Math.max(0, 2 * sdnn * sdnn - 0.5 * sd1 * sd1));
  const ratio = sd2 === 0 ? 0 : sd1 / sd2;

  const plotPoints = cleaned.slice(0, n - 1).map((ibi, i) => ({
    x: ibi,
    y: cleaned[i + 1],
  }));

  // Shannon entropy + CV
  const entropy = shannonEntropy(cleaned);
  const ibiMean = mean(cleaned);
  const cv      = ibiMean === 0 ? 0 : std(cleaned) / ibiMean;

  const flagRmssd   = rmssd   > thr.rmssdThreshold;
  const flagEntropy = entropy > thr.entropyThreshold;
  const flagRatio   = ratio   > thr.sd1sd2Threshold;
  const flagCv      = cv      > thr.cvThreshold;

  const score = (flagRmssd ? 1 : 0) + (flagEntropy ? 1 : 0) +
                (flagRatio ? 1 : 0) + (flagCv ? 1 : 0);

  // RULE 4 — Scoring requires confidence gate
  let risk, label, cssStatus;

  if (score <= 1) {
    risk = 'LOW'; label = 'Regular rhythm detected'; cssStatus = 'normal';
  } else if (score === 2) {
    if (confidence >= 40) {
      risk = 'MODERATE'; label = 'Some irregularity detected'; cssStatus = 'caution';
    } else {
      risk = 'LOW'; label = 'Rhythm appears regular'; cssStatus = 'normal';
    }
  } else {
    // score 3-4
    if (confidence >= 40) {
      risk = 'HIGH'; label = 'Irregular rhythm indicators present'; cssStatus = 'concern';
    } else {
      risk = 'MODERATE'; label = 'Possible irregularity — more data needed'; cssStatus = 'caution';
    }
  }

  if (confidence < 30) {
    return INSUFFICIENT(
      `More data needed — only ${n} heartbeats captured`,
      `At least 6 beats with ≥30% confidence are needed for rhythm screening. ` +
      `Extend the scan to 30+ seconds. The scan captured ${n} usable beats (${confidence}% confidence).`,
    );
  }

  // Downgrade CONCERN → CAUTION if confidence 40–60%
  if (risk === 'HIGH' && confidence < 60) {
    risk = 'MODERATE';
    label = 'Possible irregularity — low confidence';
    cssStatus = 'caution';
  }

  return {
    risk, label, cssStatus, score, confidence,
    explanation: null,
    markers: {
      rmssd:   { value: Math.round(rmssd),               threshold: thr.rmssdThreshold,   flagged: flagRmssd },
      entropy: { value: Math.round(entropy * 100) / 100,  threshold: thr.entropyThreshold, flagged: flagEntropy },
      sd1sd2:  { value: Math.round(ratio   * 100) / 100,  threshold: thr.sd1sd2Threshold,  flagged: flagRatio },
      cv:      { value: Math.round(cv      * 100) / 100,  threshold: thr.cvThreshold,      flagged: flagCv },
    },
    poincare: { sd1, sd2, ratio, plotPoints },
  };
}

// ── Autonomic Balance (Goertzel LF/HF) ───────────────────────────────────────
export function computeAutonomic(ibis) {
  if (!ibis || ibis.length < 4) return null;

  const ibiMean = ibis.reduce((a,b)=>a+b,0) / ibis.length;
  if (ibiMean === 0) return null;

  const ibiSampleRate = 1000 / ibiMean;
  if (ibiSampleRate <= 0 || !isFinite(ibiSampleRate)) return null;
  const n = ibis.length;

  // Linear detrending: prevents slow HR drift across 25s from being 
  // misclassified as massive low-frequency (sympathetic) power.
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ibis[i];
    sumXY += i * ibis[i];
    sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const detrended = ibis.map((y, x) => y - (slope * x + intercept));

  function goertzelPower(signal, targetFreq, sampleRate) {
    const n = signal.length;
    if (n === 0) return 0;
    const k     = Math.round(n * targetFreq / sampleRate);
    const omega = (2 * Math.PI * k) / n;
    const coeff = 2 * Math.cos(omega);
    let s0 = 0, s1 = 0, s2 = 0;
    for (const x of signal) { s0 = x + coeff * s1 - s2; s2 = s1; s1 = s0; }
    const real = s1 - s2 * Math.cos(omega);
    const imag = s2 * Math.sin(omega);
    return real * real + imag * imag;
  }

  const STEP = 0.01;
  let lfPower = 0, lfCount = 0;
  for (let f = 0.04; f <= 0.15 + 1e-9; f += STEP) {
    lfPower += goertzelPower(detrended, f, ibiSampleRate); lfCount++;
  }
  let hfPower = 0, hfCount = 0;
  for (let f = 0.15; f <= 0.40 + 1e-9; f += STEP) {
    hfPower += goertzelPower(detrended, f, ibiSampleRate); hfCount++;
  }

  lfPower = lfCount > 0 ? lfPower / lfCount : 0;
  hfPower = hfCount > 0 ? hfPower / hfCount : 0;
  if (hfPower === 0) return null;

  const lfhf  = lfPower / hfPower;
  if (!isFinite(lfhf) || lfhf < 0) return null;

  // Added safeguard: clamp LFHF to a realistic human threshold to prevent hallucinations
  const clampedLfhf = Math.min(Math.max(lfhf, 0.1), 10.0);

  const total = lfPower + hfPower;
  const lfNorm = Math.round((lfPower / total) * 100);
  const hfNorm = Math.round((hfPower / total) * 100);

  let state, description;
  if (clampedLfhf < 1.5) {
    state = 'Parasympathetic';
    description = 'The body is in a relaxed, calm state. Calming nervous system is dominant.';
  } else if (clampedLfhf <= 4.0) {
    state = 'Balanced';
    description = 'The body is in a balanced state between rest and stress.';
  } else {
    state = 'Sympathetic';
    description = 'The body appears to be in a stress response. Alert nervous system is dominant.';
  }

  return {
    lfhf: Math.round(clampedLfhf * 100) / 100,
    lfNorm, hfNorm, state, description,
  };
}

// ── Pulse Morphology / Arterial Compliance (AIx) ─────────────────────────────
export function computeMorphology(signal, peaks, fps) {
  if (!signal || !peaks || peaks.length < 3) return null;

  const normalizedSignal = normalize([...signal]);
  const cycles = [];

  for (let p = 0; p < peaks.length - 1; p++) {
    const seg = normalizedSignal.slice(peaks[p], peaks[p + 1]);
    if (seg.length < 10) continue;

    const systolicPeak = seg[0];
    const searchStart  = Math.floor(seg.length * 0.2);
    const searchEnd    = Math.floor(seg.length * 0.7);

    let notchIdx = -1, notchValue = Infinity;
    for (let j = searchStart + 1; j < searchEnd - 1; j++) {
      if (seg[j] < seg[j - 1] && seg[j] < seg[j + 1] && seg[j] < notchValue) {
        notchValue = seg[j]; notchIdx = j;
      }
    }
    if (notchIdx === -1) continue;

    const diastolicVal  = Math.max(...seg.slice(notchIdx));
    const baseline      = Math.min(...seg);
    const systolicAmp   = systolicPeak - baseline;
    if (systolicAmp === 0) continue;

    const aix             = ((diastolicVal - notchValue) / systolicAmp) * 100;
    
    // Strict physiological gate
    if (aix < 0 || aix > 60) continue; // reject this cycle
    
    const systolicDuration = (notchIdx / fps) * 1000;
    cycles.push({ aix, systolicDuration });
  }

  // If all cycles rejected:
  if (cycles.length === 0) {
    return {
      aix: null,
      stiffness: 'Unable to measure',
      color: '#94a3b8',
      arterialAge: 'Signal insufficient for arterial analysis',
      displayWaveform: [],
      disclaimer: 'Waveform morphology requires clean signal. Rescan in better lighting.'
    };
  }

  const avgAix      = mean(cycles.map(c => c.aix));
  const avgSystolic = mean(cycles.map(c => c.systolicDuration));

  let stiffness;
  if (avgAix < 10)      stiffness = 'Very flexible (excellent)';
  else if (avgAix < 20) stiffness = 'Normal flexibility';
  else if (avgAix < 30) stiffness = 'Slightly reduced flexibility';
  else                  stiffness = 'Reduced flexibility';

  const displayWaveform = normalize(
    signal.slice(peaks[0], peaks[Math.min(6, peaks.length - 1)])
  );

  return {
    aix:              Math.round(avgAix * 10) / 10,
    stiffness,
    systolicDuration: Math.round(avgSystolic),
    displayWaveform,
    cyclesAnalyzed:   cycles.length,
  };
}

// ── HRV confidence meta (exported for ReportScreen) ─────────────────────────
// Task Force 1996: 99th percentile healthy adult ≈ 100ms
// Buchheit 2014 elite endurance athletes max ≈ 180ms
export function computeHRVMeta(rmssd, ibis) {
  const m = mean(ibis);
  const s = std(ibis);
  const cv = m > 0 ? s / m : 0;
  const baseConf = clamp(Math.round(100 - cv * 100), 0, 100);

  if (rmssd > 150) {
    return {
      confidence: Math.min(baseConf, 20),
      warning: 'Extremely high variation detected (>150ms). Peak detection may have found noise. Rescan in better lighting, staying completely still.',
      isReliable: false,
    };
  }
  if (rmssd > 100) {
    return {
      confidence: Math.min(baseConf, 40),
      warning: 'Very high variation detected (>100ms). Consider rescanning.',
      isReliable: true,
    };
  }
  if (rmssd > 70) {
    return {
      confidence: Math.min(baseConf, 65),
      warning: null,
      isReliable: true,
    };
  }
  return { confidence: baseConf, warning: null, isReliable: true };
}

// ── Skin color check — RELATIVE baseline (device-agnostic) ───────────────────
// Compares R/G ratio at END of scan to BASELINE at START (first 3 seconds).
// Removes dependence on absolute thresholds, camera white balance, skin tone.
// Reference: Mannino et al., npj Digital Medicine 2022
export function computeAnemia(rChannel, gChannel, _bChannel, skinBaseline) {
  if (!rChannel || !gChannel || rChannel.length < 90 || gChannel.length < 90) return null;

  // Baseline from first 90 frames (first ~3s at 30fps)
  const rBase = mean(rChannel.slice(0, 90));
  const gBase = mean(gChannel.slice(0, 90));
  const baselineRG = gBase > 0 ? rBase / gBase : 1.2;

  // Use passed precomputed baseline if available (single source of truth)
  const effectiveBaseline = (skinBaseline !== undefined && skinBaseline !== null)
    ? skinBaseline
    : baselineRG;

  // Current: last 90 frames
  const rCurrent = mean(rChannel.slice(-90));
  const gCurrent = mean(gChannel.slice(-90));
  const currentRG = gCurrent > 0 ? rCurrent / gCurrent : 1.2;

  // Relative change (positive = redness dropped = pallor signal)
  const pallorRatio = (effectiveBaseline - currentRG) / (effectiveBaseline || 1);

  let indicator, cssStatus, description;

  if (pallorRatio > 0.15) {
    indicator   = 'Skin redness reduced from scan start';
    cssStatus   = 'caution';
    description = 'Skin color shows notable reduction in redness during the scan. May indicate pallor. Strongly affected by lighting changes.';
  } else if (pallorRatio > 0.08) {
    indicator   = 'Minor variation in skin color';
    cssStatus   = 'caution';
    description = 'Small reduction in skin redness during scan. Within normal variation range.';
  } else {
    indicator   = 'Skin color consistent throughout scan';
    cssStatus   = 'normal';
    description = 'No significant change in skin color detected during scan.';
  }

  return {
    indicator,
    cssStatus,
    description,
    baselineRG:  Math.round(effectiveBaseline * 100) / 100,
    currentRG:   Math.round(currentRG         * 100) / 100,
    pallorRatio: Math.round(pallorRatio        * 100),  // as percentage
    disclaimer:
      'Compares skin color at start vs end of scan. ' +
      'NOT a haemoglobin test. NOT an anemia diagnosis. ' +
      'Strongly affected by lighting changes and skin tone. ' +
      'Reference: Mannino et al., npj Digital Medicine 2022.',
  };
}

// ── Age-adjusted normal ranges ────────────────────────────────────────────────
/**
 * getNormalRanges(age, gender)
 * Returns age-appropriate reference ranges for HR and HRV.
 * Based on Task Force 1996 HRV standards and AHA HR guidelines.
 */
export function getNormalRanges(age, gender) {
  const ageN = parseInt(age) || 35;

  // HR ranges by age
  let hr;
  if (ageN < 1)        hr = { min: 100, max: 160 };
  else if (ageN <= 12) hr = { min: 70,  max: 120 };
  else                 hr = { min: 60,  max: 100 };

  // HRV RMSSD ranges by age (Task Force 1996)
  let hrv;
  if (ageN < 20)        hrv = { relaxed: 60, normal: 35, stressed: 20 };
  else if (ageN <= 40)  hrv = { relaxed: 50, normal: 25, stressed: 15 };
  else if (ageN <= 60)  hrv = { relaxed: 40, normal: 20, stressed: 12 };
  else                  hrv = { relaxed: 30, normal: 15, stressed: 8  };

  // Gender adjustment: females have ~10% higher HRV on average
  if (gender === 'Female') {
    hrv.relaxed  = Math.round(hrv.relaxed  * 1.1);
    hrv.normal   = Math.round(hrv.normal   * 1.1);
    hrv.stressed = Math.round(hrv.stressed * 1.1);
  }

  return {
    hr,
    hrv,
    pi: { min: 0.5, max: 2.0 },
  };
}

// ── Rule-based recommendations ────────────────────────────────────────────────
/**
 * generateRecommendations
 * Age-range aware. Returns { flag, text }[].
 * No AI. No external calls. Always works offline.
 */
export function generateRecommendations({ hr, rmssd, afib, pi, autonomic, ranges }) {
  const recs = [];
  const r = ranges || getNormalRanges(35, null);

  // Heart rate
  if (hr < r.hr.min - 10) {
    recs.push({
      flag: 'CONCERN',
      text: `Heart rate is significantly below normal (${hr} BPM, normal ${r.hr.min}–${r.hr.max}). Check again after 5 minutes of rest. Consult a doctor if it persists.`,
    });
  } else if (hr < r.hr.min) {
    recs.push({
      flag: 'CAUTION',
      text: `Heart rate is slightly below normal range (${hr} BPM). This may be normal for an athletic person. Recheck if symptomatic.`,
    });
  } else if (hr > r.hr.max + 20) {
    recs.push({
      flag: 'CONCERN',
      text: `Heart rate is significantly above normal (${hr} BPM, normal ${r.hr.min}–${r.hr.max}). Ask the patient to rest 10 minutes and check again. Seek clinical review if symptomatic.`,
    });
  } else if (hr > r.hr.max) {
    recs.push({
      flag: 'CAUTION',
      text: `Heart rate is mildly elevated (${hr} BPM). May be due to activity, anxiety, or caffeine. Ask patient to rest and recheck.`,
    });
  }

  // Stress / HRV
  if (rmssd < r.hrv.stressed) {
    recs.push({
      flag: 'CONCERN',
      text: `Stress indicators are markedly elevated (HRV ${Math.round(rmssd)}ms, expected above ${r.hrv.stressed}ms for this patient's age). Encourage deep breathing and rest. Recheck after 15 minutes.`,
    });
  } else if (rmssd < r.hrv.normal) {
    recs.push({
      flag: 'CAUTION',
      text: `Moderate stress indicators detected. Encourage rest and relaxation before rechecking.`,
    });
  }

  // AFib
  if (afib?.risk === 'HIGH' && (afib?.confidence ?? 0) >= 40) {
    recs.push({
      flag: 'CONCERN',
      text: 'Irregular heartbeat indicators detected with moderate confidence. Refer this patient to a doctor for an ECG test to rule out atrial fibrillation.',
    });
  } else if (afib?.risk === 'MODERATE' && (afib?.confidence ?? 0) >= 40) {
    recs.push({
      flag: 'CAUTION',
      text: 'A slightly irregular heartbeat pattern was detected. Monitor over the next few days. Repeat the scan to confirm.',
    });
  } else if (afib?.risk === 'INSUFFICIENT') {
    recs.push({
      flag: 'CAUTION',
      text: 'Heart rhythm could not be assessed — insufficient data. For rhythm screening, perform a longer scan or use a dedicated ECG device.',
    });
  }

  // Perfusion index
  if (pi !== undefined && pi < r.pi.min) {
    recs.push({
      flag: 'CAUTION',
      text: 'Blood flow signal was weak. Patient may be cold or the lighting was poor. Try again in better conditions.',
    });
  }

  // Autonomic
  if (autonomic?.lfhf > 4) {
    recs.push({
      flag: 'CAUTION',
      text: 'The body appears to be in a stress response (alert nervous system dominant). Encourage rest and slow breathing.',
    });
  }

  if (recs.length === 0) {
    recs.push({
      flag: 'NORMAL',
      text: 'All readings are within normal range for this patient. No immediate action needed.',
    });
  }

  return recs;
}
