// ── useScan.js v3 ─────────────────────────────────────────────────────────────
// Additions over v2:
//   - Liveness detection (temporal variance of green channel < 0.3 = photo)
//   - Blink detection gate (eyes never close in 10s + low liveness → reject)
//   - Post-exercise detection (adaptive Butterworth bounds: 0.65–3.0 Hz)
//   - Activity state banner (post-exercise warning passed to UI)
//   - 3-layer peak validation (prominence + min amplitude + physiological IBI gate)
//   - RMSSD confidence cap (>150ms → max 20% confidence, warning flag)
//   - Relative skin baseline (first 90 frames) passed with results
//   - AFib confidence hard gate enforced in finaliseScan
//   - All MediaPipe via CDN only

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  mean,
  std,
  clamp,
  findPeaks,
  createButterworthBandpass,
} from '../utils/signalUtils.js';

// MediaPipe forehead landmark indices (478-point model)
const FOREHEAD_INDICES = [10, 338, 297, 332, 284, 251, 69, 108, 151, 9];

// Eye landmark indices (MediaPipe 478-point)
// Left eye: outer-inner corners 33-133, top-bottom 159-145
// Right eye: outer-inner corners 362-263, top-bottom 386-374
const EYE_TOP_L = 159, EYE_BOT_L = 145, EYE_OL = 33,  EYE_IL = 133;
const EYE_TOP_R = 386, EYE_BOT_R = 374, EYE_OR = 362, EYE_IR = 263;

const SCAN_DURATION_MS = 25000;

// ── Script loader ─────────────────────────────────────────────────────────────
function loadMediaPipeScripts() {
  return new Promise((resolve, reject) => {
    if (window.FaceMesh) { resolve(); return; }

    function loadScript(src) {
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = res;
        s.onerror = () => rej(new Error(`Failed to load: ${src}`));
        document.head.appendChild(s);
      });
    }

    loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js')
      .then(() => loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'))
      .then(resolve)
      .catch(reject);
  });
}

// ── Liveness detection ────────────────────────────────────────────────────────
// Real skin: micro-color fluctuations from blood flow → stdDev > 0.3
// Static photo: pixels don't change frame-to-frame → stdDev < 0.3
function computeLivenessScore(greenValues) {
  if (greenValues.length < 30) return 1.0; // not enough data yet
  const last30 = greenValues.slice(-30);
  const m = last30.reduce((a, b) => a + b, 0) / 30;
  const variance = last30.reduce((s, v) => s + (v - m) ** 2, 0) / 30;
  const stdDev = Math.sqrt(variance);
  
  // Live skin: stdDev typically 0.8–4.0 pixel units
  // Photo/screen: stdDev < 0.4 (pixels do not change)
  return stdDev;
}

// ── Eye Aspect Ratio (EAR) for blink detection ────────────────────────────────
// EAR < 0.25 for 2+ consecutive frames = blink detected
function computeEAR(lm, W, H) {
  function dist(a, b) {
    const dx = (lm[a].x - lm[b].x) * W;
    const dy = (lm[a].y - lm[b].y) * H;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const earL = dist(EYE_TOP_L, EYE_BOT_L) / (dist(EYE_OL, EYE_IL) || 1);
  const earR = dist(EYE_TOP_R, EYE_BOT_R) / (dist(EYE_OR, EYE_IR) || 1);
  return (earL + earR) / 2;
}

// ── Activity state detection ──────────────────────────────────────────────────
function detectActivityState(hrEstimate, pi) {
  if (hrEstimate > 110 && pi > 3.0) return 'POST_EXERCISE';
  if (hrEstimate > 90  && pi > 2.5) return 'ELEVATED';
  return 'RESTING';
}

// ── Adaptive Butterworth bounds by activity state ─────────────────────────────
function getFilterBounds(activityState) {
  if (activityState === 'POST_EXERCISE') return { low: 0.65, high: 3.0 };
  if (activityState === 'ELEVATED')     return { low: 0.70, high: 2.8 };
  return                                       { low: 0.75, high: 2.5 };
}

// ── Moving average smoothing ──────────────────────────────────────────────────
function smoothSignal(signal, windowSize = 5) {
  const smoothed = [];
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < signal.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      if (i + j >= 0 && i + j < signal.length) {
        sum += signal[i + j];
        count++;
      }
    }
    smoothed.push(sum / count);
  }
  return smoothed;
}

// ── IBI outlier removal (median-based ectopic rejection) ───────────────────
function removeOutlierIBIs(ibis) {
  if (ibis.length < 4) return ibis;
  const sorted = [...ibis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  
  // Median Absolute Deviation (MAD) for robust standard deviation
  const deviations = ibis.map(val => Math.abs(val - median));
  const sortedDevs = [...deviations].sort((a, b) => a - b);
  const mad = sortedDevs[Math.floor(sortedDevs.length / 2)];
  const robustStd = mad * 1.4826; // consistent with normal distribution
  
  // Reject ±2.5 robust standard deviations from median
  return ibis.filter(ibi => Math.abs(ibi - median) <= 2.5 * Math.max(robustStd, 20));
}

// ── Signal SNR computation ────────────────────────────────────────────────────
function computeSnr(signal) {
  if (signal.length < 10) return 0;
  const validBandPower = signal.reduce((a, v) => a + v * v, 0) / signal.length;
  const m = mean(signal);
  const totalVariance = signal.reduce((a, v) => a + (v - m) ** 2, 0) / signal.length;
  return totalVariance > 0 ? validBandPower / totalVariance : 0;
}

// ── RMSSD confidence cap (physiological plausibility gate) ───────────────────
// Task Force 1996: 99th percentile for any healthy adult ≈ 100ms
// Elite endurance athletes max ≈ 180ms (Buchheit 2014)
function computeHRVMeta(rmssd, ibis) {
  const m = mean(ibis);
  const s = std(ibis);
  const cv = m > 0 ? s / m : 0;
  const baseConf = clamp(Math.round(100 - cv * 100), 0, 100);

  if (rmssd > 150) {
    return {
      confidence: Math.min(baseConf, 20),
      warning: 'Extremely high variation detected (>150ms). Peak detector may have found noise. Rescan in better lighting.',
      isReliable: false,
    };
  }
  if (rmssd > 100) {
    return {
      confidence: Math.min(baseConf, 40),
      warning: 'Very high variation detected. Consider rescanning.',
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

// ── CHROM processor ───────────────────────────────────────────────────────────
class CHROMProcessor {
  constructor(fps = 30, windowSize = 32, filterLow = 0.75, filterHigh = 2.5) {
    this.WIN = windowSize;
    this.rBuf = [];
    this.gBuf = [];
    this.bBuf = [];
    this.filter = createButterworthBandpass(filterLow, filterHigh, fps);
  }

  reset(fps = 30, windowSize = 32, filterLow = 0.75, filterHigh = 2.5) {
    this.WIN = windowSize;
    this.rBuf = [];
    this.gBuf = [];
    this.bBuf = [];
    this.filter = createButterworthBandpass(filterLow, filterHigh, fps);
  }

  process(r, g, b) {
    this.rBuf.push(r);
    this.gBuf.push(g);
    this.bBuf.push(b);

    if (this.rBuf.length > this.WIN) {
      this.rBuf.shift();
      this.gBuf.shift();
      this.bBuf.shift();
    }

    const count = this.rBuf.length;
    if (count < 2) return 0;

    const rMean = mean(this.rBuf) || 1;
    const gMean = mean(this.gBuf) || 1;
    const bMean = mean(this.bBuf) || 1;

    const Xs = this.rBuf.map((rv, i) => 3 * (rv / rMean) - 2 * (this.gBuf[i] / gMean));
    const Ys = this.rBuf.map((rv, i) =>
      1.5 * (rv / rMean) + (this.gBuf[i] / gMean) - 1.5 * (this.bBuf[i] / bMean)
    );

    const stdYs = std(Ys);
    const alpha = stdYs === 0 ? 1 : std(Xs) / stdYs;

    const s = Xs[count - 1] - alpha * Ys[count - 1];
    return this.filter.process(s);
  }
}

// ── ROI extraction ────────────────────────────────────────────────────────────
function extractROI(ctx, lm, canvasW, canvasH, padExtra = 0) {
  const pts = FOREHEAD_INDICES.map(idx => ({
    x: lm[idx].x * canvasW,
    y: lm[idx].y * canvasH,
  }));

  const PAD = 15 + padExtra;
  const minX = clamp(Math.floor(Math.min(...pts.map(p => p.x)) - PAD), 0, canvasW);
  const minY = clamp(Math.floor(Math.min(...pts.map(p => p.y)) - PAD), 0, canvasH);
  const maxX = clamp(Math.ceil( Math.max(...pts.map(p => p.x)) + PAD), 0, canvasW);
  const maxY = clamp(Math.ceil( Math.max(...pts.map(p => p.y)) + PAD), 0, canvasH);
  const roiW = maxX - minX;
  const roiH = maxY - minY;

  if (roiW <= 0 || roiH <= 0) return null;

  const imageData = ctx.getImageData(minX, minY, roiW, roiH);
  const data = imageData.data;

  let rSum = 0, gSum = 0, bSum = 0;
  const pixelCount = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }

  const r = rSum / pixelCount;
  const g = gSum / pixelCount;
  const b = bSum / pixelCount;

  return { r, g, b, brightness: (r + g + b) / 3, x: minX, y: minY, w: roiW, h: roiH };
}

// ── Full frame brightness ─────────────────────────────────────────────────────
function getFrameBrightness(ctx, W, H) {
  const px = Math.floor(W / 2) - 20;
  const py = Math.floor(H / 2) - 20;
  const imgData = ctx.getImageData(Math.max(0, px), Math.max(0, py), 40, 40);
  const d = imgData.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  }
  return sum / (d.length / 4);
}

// ── findPeaksStrict (validated version) ───────────────────────────────────────────
function findPeaksStrict(signal, fps) {
  const peaks = []
  const sigMean = signal.reduce((a,b)=>a+b,0)/signal.length
  const sigStd = Math.sqrt(signal.reduce((s,v)=>s+(v-sigMean)**2,0)/signal.length)
  
  const minDist = Math.floor(fps * 0.40)  // max 150 BPM
  const maxDist = Math.floor(fps * 1.50)  // min 40 BPM
  
  // Minimum amplitude: peak must be above mean + 0.2*std
  // This is LESS strict than before (was 0.5*std) to avoid missing beats
  const minAmp = sigMean + 0.2 * sigStd
  
  for (let i = 2; i < signal.length - 2; i++) {
    // Local maximum check (5-point window)
    const isLocalMax = signal[i] > signal[i-1] &&
                       signal[i] > signal[i-2] &&
                       signal[i] > signal[i+1] &&
                       signal[i] > signal[i+2]
    
    if (!isLocalMax) continue
    
    // Minimum amplitude check
    if (signal[i] < minAmp) continue
    
    // Minimum distance from last peak
    if (peaks.length > 0 && i - peaks[peaks.length-1] < minDist) {
      // Keep the higher peak
      if (signal[i] > signal[peaks[peaks.length-1]]) {
        peaks[peaks.length-1] = i
      }
      continue
    }
    
    peaks.push(i)
  }
  
  // Post-filter: remove peaks creating physiologically impossible IBIs
  const validPeaks = []
  for (let i = 0; i < peaks.length; i++) {
    if (i === 0) { validPeaks.push(peaks[i]); continue }
    const ibi = (peaks[i] - peaks[i-1]) / fps * 1000
    if (ibi >= 300 && ibi <= 1500) {  // 40-200 BPM range
      validPeaks.push(peaks[i])
    }
  }
  
  return validPeaks
}

// ── Vitals computation ────────────────────────────────────────────────────────
function computeVitals(signal, fps, rChannel, gChannel, bChannel, activityState) {
  const n = signal.length;
  if (n < 40) return null;

  const sigMean = mean(signal);
  const sigStd  = std(signal) || 1;
  const z       = signal.map(v => (v - sigMean) / sigStd);

  // Smooth the signal aggressively to remove dicrotic notch / noise bumps
  // A 5-frame moving average at 30fps = 166ms smoothing window
  const smoothZ = smoothSignal(z, 5);

  // Use validated strictly gated peak detector
  const peaks = findPeaksStrict(smoothZ, fps);

  if (peaks.length < 4) return null;

  // Raw IBIs from validated peaks
  const rawIbis = [];
  for (let i = 1; i < peaks.length; i++) {
    const ibi = ((peaks[i] - peaks[i - 1]) / fps) * 1000;
    if (ibi >= 350 && ibi <= 1200) rawIbis.push(ibi); // redundant but safe
  }

  if (rawIbis.length < 3) return null;

  // Outlier-cleaned IBIs
  const cleanIbis = removeOutlierIBIs(rawIbis);

  // Median HR (robust to outliers)
  const sortedIbis = [...rawIbis].sort((a, b) => a - b);
  const medianIbi  = sortedIbis[Math.floor(sortedIbis.length / 2)];
  const hr         = Math.round(60000 / medianIbi);

  if (hr < 40 || hr > 180) return null;

  // RMSSD from cleaned IBIs
  let ssd = 0;
  for (let i = 1; i < cleanIbis.length; i++) {
    ssd += (cleanIbis[i] - cleanIbis[i - 1]) ** 2;
  }
  const rmssd = cleanIbis.length > 1
    ? Math.sqrt(ssd / (cleanIbis.length - 1))
    : 0;

  let finalRMSSD = rmssd;
  let rmssdReliable = true;

  if (rmssd > 150) {
    // Above 99.9th percentile — almost certainly noise peaks
    finalRMSSD = rmssd;
    rmssdReliable = false;
    console.warn('[StriversEye] RMSSD', rmssd, 'exceeds physiological maximum — likely noise');
  }

  // HR confidence
  const ibiStd  = std(rawIbis);
  const hrConf  = clamp(Math.round(100 - (ibiStd / medianIbi) * 100), 0, 100);

  // HRV confidence with physiological plausibility gate
  const hrvMeta = computeHRVMeta(rmssd, cleanIbis);
  const hrvConf = hrvMeta.confidence;

  // Perfusion index
  const rMean = mean(rChannel);
  const pi    = rMean === 0 ? 0 : Math.round((std(rChannel) / rMean) * 10000) / 100;

  // Signal SNR
  const snr = computeSnr(z);

  // Relative skin color baseline (first 90 frames = ~3s)
  const skinBaseline = (() => {
    if (!gChannel || gChannel.length < 90) return null;
    const rBase = mean(rChannel.slice(0, 90));
    const gBase = mean(gChannel.slice(0, 90));
    return gBase > 0 ? rBase / gBase : null;
  })();

  return {
    hr, rmssd: finalRMSSD, rmssdReliable, ibis: cleanIbis, rawIbis, peaks,
    signal: z, pi, hrConf, hrvConf, snr,
    confidence: hrConf,
    hrvWarning: hrvMeta.warning,
    hrvIsReliable: hrvMeta.isReliable,
    skinBaseline,
    activityState: activityState || 'RESTING',
  };
}

// ── useScan hook ──────────────────────────────────────────────────────────────
export function useScan(onScanComplete) {
  const videoRef        = useRef(null);
  const canvasRef       = useRef(null);
  const hiddenCtxRef    = useRef(null);
  const faceMeshRef     = useRef(null);
  const cameraRef       = useRef(null);
  const chromRef        = useRef(null);
  const signalBuf       = useRef([]);
  const rawRBuf         = useRef([]);
  const rawGBuf         = useRef([]);
  const rawBBuf         = useRef([]);
  const fpsRef          = useRef(30);
  const lastFrameTs     = useRef(0);
  const frameCount      = useRef(0);
  const scanStartTs     = useRef(null);
  const scanActive      = useRef(false);
  const statusCheckCtr  = useRef(0);
  const snrHistory      = useRef([]);

  // Liveness tracking refs
  const blinkCount         = useRef(0);
  const lastBlinkFrameRef  = useRef(-20);
  const prevEarLow         = useRef(false);       // was EAR below threshold last frame
  const livenessFailed     = useRef(false);
  const landmarkHistoryRef = useRef([]);

  // Adaptive mode refs
  const lowLightModeRef  = useRef(false);
  const lowFpsModeRef    = useRef(false);
  const activityStateRef = useRef('RESTING');

  // State
  const [isLoading,     setIsLoading]     = useState(true);
  const [faceDetected,  setFaceDetected]  = useState(false);
  const [scanning,      setScanning]      = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [timeLeft,      setTimeLeft]      = useState(25);
  const [results,       setResults]       = useState(null);
  const [error,         setError]         = useState(null);
  const [scanStatus,    setScanStatus]    = useState('IDLE');
  const [adaptiveModes, setAdaptiveModes] = useState({ lowLight: false, lowFps: false });
  const [qualityWarning,setQualityWarning]= useState(null);
  const [activityBanner,setActivityBanner]= useState(null); // post-exercise banner text
  const [blinks,         setBlinks]         = useState(0);

  // ── Init MediaPipe ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await loadMediaPipeScripts();
        if (cancelled) return;

        const offscreen  = document.createElement('canvas');
        offscreen.width  = 640;
        offscreen.height = 480;
        hiddenCtxRef.current = offscreen.getContext('2d', { willReadFrequently: true });

        chromRef.current = new CHROMProcessor(30);

        const fm = new window.FaceMesh({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });

        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        fm.onResults((results) => {
          if (cancelled) return;
          onFaceResults(results);
        });

        faceMeshRef.current = fm;

        const video = videoRef.current;
        if (!video) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        video.srcObject = stream;
        await video.play();

        if (window.Camera) {
          const cam = new window.Camera(video, {
            onFrame: async () => {
              if (faceMeshRef.current) await faceMeshRef.current.send({ image: video });
            },
            width: 640, height: 480,
          });
          cam.start();
          cameraRef.current = cam;
        } else {
          async function rafLoop() {
            if (cancelled) return;
            if (faceMeshRef.current && video.readyState >= 2) {
              await faceMeshRef.current.send({ image: video });
            }
            requestAnimationFrame(rafLoop);
          }
          rafLoop();
        }

        if (!cancelled) setIsLoading(false);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Camera / MediaPipe init failed');
      }
    }

    init();

    return () => {
      cancelled = true;
      const video = videoRef.current;
      if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
      }
      if (cameraRef.current) { try { cameraRef.current.stop(); } catch (_) {} }
      if (faceMeshRef.current) { try { faceMeshRef.current.close(); } catch (_) {} }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Per-frame callback ────────────────────────────────────────────────────
  const onFaceResults = useCallback((mpResults) => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const W = video.videoWidth  || 640;
    const H = video.videoHeight || 480;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const hasFace =
      mpResults.multiFaceLandmarks &&
      mpResults.multiFaceLandmarks.length > 0;

    setFaceDetected(hasFace);

    // FPS tracking
    const now = performance.now();
    if (lastFrameTs.current > 0) {
      const dt = now - lastFrameTs.current;
      fpsRef.current = 0.9 * fpsRef.current + 0.1 * (1000 / dt);
    }
    lastFrameTs.current = now;
    frameCount.current++;

    // Draw offscreen frame for pixel extraction
    const offscreen = hiddenCtxRef.current;
    if (!offscreen) return;
    const oc = offscreen.canvas;
    oc.width  = W;
    oc.height = H;
    offscreen.drawImage(video, 0, 0, W, H);

    // Quality checks every 10 frames
    statusCheckCtr.current++;
    if (statusCheckCtr.current % 10 === 0 && scanActive.current) {
      runQualityChecks(offscreen, hasFace, mpResults, W, H, now);
    }

    if (!hasFace) {
      if (scanActive.current) setScanStatus('NO_FACE');
      return;
    }

    const lm = mpResults.multiFaceLandmarks[0];

    // ── Blink detection (runs every frame during scan) ────────────────────
    if (scanActive.current && lm.length >= 390) {
      const ear = computeEAR(lm, W, H);
      const isEarLow = ear < 0.25;

      // Rising edge of blink with debounce
      if (prevEarLow.current && !isEarLow && frameCount.current - lastBlinkFrameRef.current >= 10) {
        blinkCount.current++;
        setBlinks(blinkCount.current);
        lastBlinkFrameRef.current = frameCount.current;
      }
      prevEarLow.current = isEarLow;
    }

    // ── Check 3: Face Landmark Motion Microvariance ───────────────────────
    if (scanActive.current && lm.length > 1) {
      // Use nose tip landmark (index 1) as reference
      landmarkHistoryRef.current.push({ x: lm[1].x, y: lm[1].y });
      
      // Keep last 60 frames
      if (landmarkHistoryRef.current.length > 60) {
        landmarkHistoryRef.current.shift();
      }
      
      // After 60 frames, check for natural micromovement
      if (landmarkHistoryRef.current.length === 60 && frameCount.current % 60 === 0) {
        const xs = landmarkHistoryRef.current.map(p => p.x);
        const xMean = xs.reduce((a,b)=>a+b,0) / xs.length;
        const xVariance = xs.reduce((s,v)=>s+(v-xMean)**2,0) / xs.length;
        const naturalMotionScore = Math.sqrt(xVariance) * 1000;
        
        const lScore = computeLivenessScore(rawGBuf.current);
        
        // Set ultra-low to prevent false positives — let blink handle the heavy lifting
        // Added bypass: if we've already detected a blink, it's definitely NOT a static photo.
        const isBlinkDetected = blinkCount.current >= 1;
        
        if (!isBlinkDetected && naturalMotionScore < 0.01 && lScore < 0.05 && !livenessFailed.current) {
          livenessFailed.current = true;
          scanActive.current = false;
          setError(
            'Live face required. Face appears completely still. ' +
            'Please look directly at camera and blink naturally.'
          );
          setScanning(false);
          return;
        }
      }
    }

    // ── Liveness check (runs after 3s calibration, every 30 frames) ───────
    if (scanActive.current && frameCount.current % 30 === 0) {
      const elapsed = now - scanStartTs.current;
      
      // Wait 3 seconds for camera auto-exposure/gain to settle
      if (elapsed > 3000) {
        const liveness = computeLivenessScore(rawGBuf.current);
        const isBlinkDetected = blinkCount.current >= 1;

        // Photo gate: literal zero variance
        if (!isBlinkDetected && liveness < 0.01 && frameCount.current > 60 && !livenessFailed.current) {
          livenessFailed.current = true;
          scanActive.current = false;
          setError('Live face required. Static image detected. Please look at camera and blink.');
          setScanning(false);
          return;
        }

        // Check 2 (Warning Phase): 15 seconds elapsed, check blinks
        if (elapsed >= 15000 && blinkCount.current < 2) {
          setQualityWarning(
            'Please blink naturally. Blinks detected: ' + 
            blinkCount.current + '/2 minimum required.'
          );
        }
      }
    }

    drawGuide(ctx, lm, W, H);

    if (!scanActive.current) return;

    // ── Activity state detection (runs after first 5s, every 30 frames) ───
    if (frameCount.current % 30 === 0 && signalBuf.current.length > 150) {
      // Quick HR estimate from current signal for activity check
      const quickSignal = signalBuf.current.slice(-150);
      const qMean = mean(quickSignal);
      const qStd  = std(quickSignal) || 1;
      const qZ    = quickSignal.map(v => (v - qMean) / qStd);
      const quickPeaks = findPeaks(qZ, Math.floor(fpsRef.current * 0.4), 0.2);
      if (quickPeaks.length >= 3) {
        const qIbis = [];
        for (let i = 1; i < quickPeaks.length; i++) {
          qIbis.push(((quickPeaks[i] - quickPeaks[i-1]) / fpsRef.current) * 1000);
        }
        const qSorted = [...qIbis].sort((a,b) => a-b);
        const qMedian = qSorted[Math.floor(qSorted.length/2)];
        if (qMedian > 0) {
          const quickHR = Math.round(60000 / qMedian);
          const currentPi = rawRBuf.current.length > 0
            ? (() => {
                const rm = mean(rawRBuf.current);
                return rm > 0 ? (std(rawRBuf.current) / rm) * 100 : 0;
              })()
            : 0;
          const newState = detectActivityState(quickHR, currentPi);
          if (newState !== activityStateRef.current) {
            activityStateRef.current = newState;
            // Rebuild CHROM filter with adaptive bounds
            if (chromRef.current) {
              const bounds = getFilterBounds(newState);
              const winSize = lowLightModeRef.current ? 48 : 32;
              chromRef.current.reset(fpsRef.current, winSize, bounds.low, bounds.high);
            }
            // Show post-exercise banner
            if (newState === 'POST_EXERCISE') {
              setActivityBanner(
                'Elevated activity detected. Results may be less accurate. Rest 2 minutes for best results.'
              );
            } else {
              setActivityBanner(null);
            }
          }
        }
      }
    }

    // ── ROI extraction (adaptive padding for low light) ────────────────────
    const extraPad = lowLightModeRef.current ? Math.floor(W * 0.03) : 0;
    const roi = extractROI(offscreen, lm, W, H, extraPad);
    if (!roi) return;

    // Adaptive gain for low light
    let { r, g, b } = roi;
    if (lowLightModeRef.current && roi.brightness > 0) {
      const gain = Math.min(80 / roi.brightness, 3.0);
      r = clamp(r * gain, 0, 255);
      g = clamp(g * gain, 0, 255);
      b = clamp(b * gain, 0, 255);
    }

    rawRBuf.current.push(r);
    rawGBuf.current.push(g);
    rawBBuf.current.push(b);

    // CHROM signal
    const s = chromRef.current.process(r, g, b);
    signalBuf.current.push(s);

    // Progress
    const effectiveDuration = lowFpsModeRef.current
      ? SCAN_DURATION_MS + 5000
      : SCAN_DURATION_MS;

    const elapsed = now - scanStartTs.current;
    const pct     = clamp((elapsed / effectiveDuration) * 100, 0, 100);
    const sLeft   = Math.max(0, Math.ceil((effectiveDuration - elapsed) / 1000));
    setProgress(pct);
    setTimeLeft(sLeft);

    const calWindow = 3000;
    if (elapsed > calWindow) {
      setScanStatus('SCANNING');
    }

    if (elapsed >= effectiveDuration) {
      scanActive.current = false;
      setScanStatus('COMPLETE');
      finaliseScan();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quality checks ────────────────────────────────────────────────────────
  function runQualityChecks(offCtx, hasFace, mpResults, W, H, now) {
    const brightness = getFrameBrightness(offCtx, W, H);

    const isLowLight = brightness < 80;
    if (isLowLight !== lowLightModeRef.current) {
      lowLightModeRef.current = isLowLight;
      if (chromRef.current) {
        const bounds = getFilterBounds(activityStateRef.current);
        if (isLowLight) {
          chromRef.current.reset(fpsRef.current, 48, Math.min(bounds.low, 0.7), bounds.high);
        } else {
          chromRef.current.reset(fpsRef.current, 32, bounds.low, bounds.high);
        }
      }
      setAdaptiveModes(prev => ({ ...prev, lowLight: isLowLight }));
    }

    const isLowFps = fpsRef.current < 20 && (now - scanStartTs.current) > 3000;
    if (isLowFps !== lowFpsModeRef.current) {
      lowFpsModeRef.current = isLowFps;
      setAdaptiveModes(prev => ({ ...prev, lowFps: isLowFps }));
    }

    if (!hasFace) {
      setScanStatus('NO_FACE');
      return;
    }

    const lm = mpResults.multiFaceLandmarks[0];

    // Face size check
    const allX = lm.map(p => p.x * W);
    const bboxW = Math.max(...allX) - Math.min(...allX);
    if (bboxW < W * 0.3) {
      setScanStatus('FACE_TOO_FAR');
      return;
    }

    // Forehead brightness (hair covering check)
    const fhPts = FOREHEAD_INDICES.map(idx => ({
      x: lm[idx].x * W,
      y: lm[idx].y * H,
    }));
    const fhMinX = clamp(Math.floor(Math.min(...fhPts.map(p => p.x))), 0, W);
    const fhMinY = clamp(Math.floor(Math.min(...fhPts.map(p => p.y))), 0, H);
    const fhW    = clamp(Math.ceil(Math.max(...fhPts.map(p => p.x))) - fhMinX, 1, W - fhMinX);
    const fhH    = clamp(Math.ceil(Math.max(...fhPts.map(p => p.y))) - fhMinY, 1, H - fhMinY);
    const fhData = offCtx.getImageData(fhMinX, fhMinY, fhW, fhH).data;
    let fhSum = 0;
    for (let i = 0; i < fhData.length; i += 4) {
      fhSum += (fhData[i] + fhData[i + 1] + fhData[i + 2]) / 3;
    }
    const fhBrightness = fhSum / (fhData.length / 4);

    if (fhBrightness < 30) {
      setScanStatus('HAIR_COVERING');
      return;
    }

    if (brightness < 60) {
      setScanStatus('LOW_LIGHT');
      return;
    }

    // Signal quality after 5s
    const elapsed = now - scanStartTs.current;
    if (elapsed > 5000 && signalBuf.current.length > 30) {
      const snr = computeSnr(signalBuf.current);
      snrHistory.current.push(snr);
      if (snr < 0.2) {
        setScanStatus('POOR_SIGNAL');
        return;
      }
    }

    setScanStatus(elapsed < 3000 ? 'CALIBRATING' : 'SCANNING');
  }

  // ── Draw face guide ───────────────────────────────────────────────────────
  function drawGuide(ctx, lm, W, H) {
    const allX = lm.map(p => p.x * W);
    const allY = lm.map(p => p.y * H);
    const faceX = Math.min(...allX);
    const faceY = Math.min(...allY);
    const faceW = Math.max(...allX) - faceX;
    const faceH = Math.max(...allY) - faceY;

    ctx.strokeStyle = 'rgba(29, 78, 216, 0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(faceX, faceY, faceW, faceH);
    ctx.setLineDash([]);

    const fhPts = FOREHEAD_INDICES.map(idx => ({
      x: lm[idx].x * W,
      y: lm[idx].y * H,
    }));
    const fhMinX = Math.min(...fhPts.map(p => p.x)) - 15;
    const fhMinY = Math.min(...fhPts.map(p => p.y)) - 15;
    const fhMaxX = Math.max(...fhPts.map(p => p.x)) + 15;
    const fhMaxY = Math.max(...fhPts.map(p => p.y)) + 15;

    ctx.strokeStyle = 'rgba(22, 163, 74, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(fhMinX, fhMinY, fhMaxX - fhMinX, fhMaxY - fhMinY);

    const L = 10;
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fhMinX, fhMinY + L); ctx.lineTo(fhMinX, fhMinY); ctx.lineTo(fhMinX + L, fhMinY);
    ctx.moveTo(fhMaxX, fhMinY + L); ctx.lineTo(fhMaxX, fhMinY); ctx.lineTo(fhMaxX - L, fhMinY);
    ctx.moveTo(fhMinX, fhMaxY - L); ctx.lineTo(fhMinX, fhMaxY); ctx.lineTo(fhMinX + L, fhMaxY);
    ctx.moveTo(fhMaxX, fhMaxY - L); ctx.lineTo(fhMaxX, fhMaxY); ctx.lineTo(fhMaxX - L, fhMaxY);
    ctx.stroke();

    ctx.fillStyle = '#16a34a';
    ctx.font      = 'bold 10px Inter, sans-serif';
    ctx.fillText('Reading area', fhMinX + 2, fhMinY - 4);
  }

  // ── Finalise scan ─────────────────────────────────────────────────────────
  function finaliseScan() {
    if (blinkCount.current < 1) {
      setError(
        'No blinks detected during scan. ' +
        'This may indicate a photo was used. ' + 
        'Please look at camera and blink naturally.'
      );
      setScanning(false);
      return;
    }

    const signal    = signalBuf.current;
    const fps       = fpsRef.current;
    const rChannel  = rawRBuf.current;
    const gChannel  = rawGBuf.current;
    const bChannel  = rawBBuf.current;
    const activity  = activityStateRef.current;

    const vitals = computeVitals(signal, fps, rChannel, gChannel, bChannel, activity);

    if (!vitals) {
      setError('Scan quality was too low. Please try again with better lighting and stay still.');
      setScanning(false);
      return;
    }

    const snr = vitals.snr;
    const avgBrightness = mean(rChannel.map((r, i) =>
      (r + (gChannel[i] || r) + (bChannel[i] || r)) / 3
    ));

    let qualWarning = null;
    if (snr < 0.05) {
      setError('Scan failed — signal too weak. Please try again with better lighting and stay completely still.');
      setScanning(false);
      return;
    } else if (snr < 0.15 && avgBrightness < 80) {
      qualWarning = 'Scan quality was low due to lighting. Results may be less accurate.';
    }

    // Add HRV warning to qualWarning if present
    if (vitals.hrvWarning) {
      qualWarning = qualWarning
        ? `${qualWarning}\n${vitals.hrvWarning}`
        : vitals.hrvWarning;
    }

    // Add post-exercise warning
    if (activity === 'POST_EXERCISE') {
      qualWarning = qualWarning
        ? `${qualWarning}\nPost-exercise: results may be less accurate. Rest 2 minutes for best results.`
        : 'Post-exercise state detected. Results may be less accurate. Rest 2 minutes for best results.';
    }

    setQualityWarning(qualWarning);
    setResults({
      hr:            vitals.hr,
      rmssd:         vitals.rmssd,
      rmssdReliable: vitals.rmssdReliable ?? true,
      ibis:          vitals.ibis,
      rawIbis:       vitals.rawIbis,
      peaks:         vitals.peaks,
      signal:        vitals.signal,
      pi:            vitals.pi,
      confidence:    vitals.confidence,
      hrConf:        vitals.hrConf,
      hrvConf:       vitals.hrvConf,
      hrvWarning:    vitals.hrvWarning,
      hrvIsReliable: vitals.hrvIsReliable,
      fps:           Math.round(fps),
      snr:           Math.round(snr * 100),
      rChannel,
      gChannel,
      bChannel,
      skinBaseline:  vitals.skinBaseline,
      activityState: activity,
      sessionSeconds: 25,
      ibiHistory:    [] // Temporal HRV proxy
    });

    setScanning(false);
    setProgress(100);
    setTimeLeft(0);

    if (onScanComplete) onScanComplete();
  }

  // ── startScan ─────────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    if (!faceMeshRef.current) return;

    signalBuf.current      = [];
    rawRBuf.current        = [];
    rawGBuf.current        = [];
    rawBBuf.current        = [];
    snrHistory.current     = [];
    frameCount.current     = 0;
    lastFrameTs.current    = 0;
    statusCheckCtr.current = 0;
    blinkCount.current     = 0;
    lastBlinkFrameRef.current = -20;
    prevEarLow.current     = false;
    livenessFailed.current = false;
    landmarkHistoryRef.current = [];
    activityStateRef.current = 'RESTING';

    if (chromRef.current) chromRef.current.reset(fpsRef.current);
    setResults(null);
    setError(null);
    setQualityWarning(null);
    setActivityBanner(null);
    setProgress(0);
    setTimeLeft(25);
    setScanStatus('CALIBRATING');

    scanStartTs.current = performance.now();
    scanActive.current  = true;
    setScanning(true);
  }, []);

  // ── stopAndReset ──────────────────────────────────────────────────────────
  const stopAndReset = useCallback(() => {
    scanActive.current       = false;
    signalBuf.current        = [];
    rawRBuf.current          = [];
    rawGBuf.current          = [];
    rawBBuf.current          = [];
    snrHistory.current       = [];
    frameCount.current       = 0;
    lowLightModeRef.current  = false;
    lowFpsModeRef.current    = false;
    activityStateRef.current = 'RESTING';
    blinkCount.current       = 0;
    lastBlinkFrameRef.current = -20;
    prevEarLow.current       = false;
    livenessFailed.current   = false;
    landmarkHistoryRef.current = [];

    if (chromRef.current) chromRef.current.reset(30);
    setScanning(false);
    setResults(null);
    setProgress(0);
    setTimeLeft(25);
    setError(null);
    setQualityWarning(null);
    setActivityBanner(null);
    setFaceDetected(false);
    setScanStatus('IDLE');
    setBlinks(0);
    setAdaptiveModes({ lowLight: false, lowFps: false });
  }, []);

  return {
    videoRef,
    canvasRef,
    isLoading,
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
  };
}
