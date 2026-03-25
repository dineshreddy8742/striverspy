// ── signalUtils.js ────────────────────────────────────────────────────────────
// Vanilla JS DSP utilities — no external libraries

export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export const mean = (arr) => {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
};

export const std = (arr) => {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

export const euclidean = (a, b) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

export const slope = (arr) => {
  const n = arr.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += arr[i];
    sumXY += i * arr[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
};

export const normalize = (arr) => {
  if (!arr || arr.length === 0) return [];
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  const range = mx - mn;
  if (range === 0) return arr.map(() => 0.5);
  return arr.map(v => (v - mn) / range);
};

export const shannonEntropy = (arr) => {
  if (!arr || arr.length === 0) return 0;
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  const range = mx - mn;
  const BIN_COUNT = 10;
  const bins = new Array(BIN_COUNT).fill(0);
  const binSize = range === 0 ? 1 : range / BIN_COUNT;
  for (const v of arr) {
    const bin = Math.min(Math.floor((v - mn) / binSize), BIN_COUNT - 1);
    bins[bin]++;
  }
  let entropy = 0;
  const n = arr.length;
  for (const count of bins) {
    if (count > 0) {
      const p = count / n;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
};

// ── CircularBuffer ────────────────────────────────────────────────────────────
export class CircularBuffer {
  constructor(size) {
    this._size = size;
    this._buf = new Array(size).fill(0);
    this._head = 0;     // points to oldest slot
    this._count = 0;
  }

  push(value) {
    const slot = (this._head + this._count) % this._size;
    if (this._count < this._size) {
      this._buf[slot] = value;
      this._count++;
    } else {
      // Buffer full — overwrite oldest
      this._buf[this._head] = value;
      this._head = (this._head + 1) % this._size;
    }
  }

  /** Returns values in chronological order (oldest first) */
  getAll() {
    const out = new Array(this._count);
    for (let i = 0; i < this._count; i++) {
      out[i] = this._buf[(this._head + i) % this._size];
    }
    return out;
  }

  get length() {
    return this._count;
  }

  reset() {
    this._buf = new Array(this._size).fill(0);
    this._head = 0;
    this._count = 0;
  }
}

// ── Peak Detection ────────────────────────────────────────────────────────────
/**
 * findPeaks — returns indices of peaks in signal
 * @param {number[]} signal
 * @param {number} minDistance  — minimum samples between peaks
 * @param {number} minProminence — absolute minimum prominence (floor)
 * @returns {number[]} peak indices
 */
export const findPeaks = (signal, minDistance = 10, minProminence = 0.1) => {
  const n = signal.length;
  if (n < 5) return [];
  const dynamicProminence = Math.max(minProminence, std(signal) * 0.3);
  const sigMean = mean(signal);
  const threshold = sigMean + dynamicProminence;

  const candidates = [];
  for (let i = 2; i < n - 2; i++) {
    if (
      signal[i] > signal[i - 1] &&
      signal[i] > signal[i + 1] &&
      signal[i] > signal[i - 2] &&
      signal[i] > signal[i + 2] &&
      signal[i] > threshold
    ) {
      candidates.push(i);
    }
  }

  // Enforce minDistance — keep the tallest in each group
  const peaks = [];
  for (const c of candidates) {
    if (peaks.length === 0 || c - peaks[peaks.length - 1] >= minDistance) {
      peaks.push(c);
    } else {
      // Prefer taller peak
      if (signal[c] > signal[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = c;
      }
    }
  }
  return peaks;
};

// ── Butterworth Bandpass (2nd order IIR) ────────────────────────────────────
/**
 * createButterworthBandpass
 * Uses bilinear transform with frequency pre-warping.
 * Returns { process(sample): number, reset(): void }
 */
export const createButterworthBandpass = (lowHz, highHz, sampleRate) => {
  // Pre-warp analog frequencies
  const nyquist = sampleRate / 2;
  const wl = Math.tan(Math.PI * lowHz / sampleRate);
  const wh = Math.tan(Math.PI * highHz / sampleRate);

  // Analog prototype parameters
  const wc = Math.sqrt(wl * wh);          // center frequency (geometric mean)
  const bw = wh - wl;                      // bandwidth

  const k = wc * wc + bw * wc + 1;        // denominator constant

  // Feed-forward coefficients (b)
  const b0 = bw / k;
  const b1 = 0;
  const b2 = -bw / k;

  // Feed-back coefficients (a) — note: sign convention a1,a2 on right-hand side
  const a1 = (2 * (wc * wc - 1)) / k;
  const a2 = (wc * wc - bw * wc + 1) / k;

  // Filter state
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  return {
    process(sample) {
      const y = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = sample;
      y2 = y1;
      y1 = y;
      return y;
    },
    reset() {
      x1 = 0; x2 = 0; y1 = 0; y2 = 0;
    }
  };
};
