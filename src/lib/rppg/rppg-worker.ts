/**
 * rppg-worker.ts  — rPPG DSP Pipeline (Web Worker)
 *
 * Receives batches of {t, r, g, b} samples from the main thread,
 * runs CHROM / POS / PCA / Wiener fusion, then computes all 8 metrics.
 *
 * Message in  → { type: "samples", data: RGBSample[], elapsed: number }
 * Message out ← { type: "result", metrics: Metrics8, waveform: number[],
 *                 confidence: number, elapsed: number }
 */

export interface RGBSample {
  t: number; // ms (performance.now())
  r: number;
  g: number;
  b: number;
}

export interface Metrics8 {
  hr: number | null;
  rr: number | null;
  spo2: number | null;
  rmssd: number | null;
  lfhf: number | null;
  si: number | null;
  fi: number | null;
  mwi: number | null;
  confidence: number; // 0–100
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const FS = 30; // target resample Hz
const HR_LOW = 0.7; // Hz = 42 BPM
const HR_HIGH = 4.0; // Hz = 240 BPM
const RR_LOW = 0.1; // Hz = 6 breaths/min
const RR_HIGH = 0.5; // Hz = 30 breaths/min

// ──────────────────────────────────────────────────────────────────────────────
// Math helpers
// ──────────────────────────────────────────────────────────────────────────────
function mean(arr: Float64Array | number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function std(arr: Float64Array | number[], mu?: number): number {
  const m = mu ?? mean(arr);
  let v = 0;
  for (let i = 0; i < arr.length; i++) v += (arr[i] - m) ** 2;
  return Math.sqrt(v / arr.length);
}

function zscore(arr: Float64Array): Float64Array {
  const m = mean(arr);
  const s = std(arr, m) || 1;
  return arr.map((x) => (x - m) / s) as Float64Array;
}

/** Linear interpolation resampling onto a uniform FS grid */
function resampleUniform(
  ts: Float64Array,
  vals: Float64Array,
  fs: number
): Float64Array {
  if (ts.length < 2) return vals;
  const t0 = ts[0];
  const t1 = ts[ts.length - 1];
  const n = Math.floor(((t1 - t0) / 1000) * fs);
  if (n < 2) return vals;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tq = t0 + (i / fs) * 1000;
    while (j < ts.length - 2 && ts[j + 1] < tq) j++;
    const alpha = (tq - ts[j]) / (ts[j + 1] - ts[j]);
    out[i] = vals[j] + alpha * (vals[j + 1] - vals[j]);
  }
  return out;
}

/** Detrend by removing linear trend */
function detrend(arr: Float64Array): Float64Array {
  const n = arr.length;
  if (n < 2) return arr;
  const x0 = 0,
    x1 = n - 1;
  const yRange = arr[x1] - arr[x0];
  return arr.map((v, i) => v - (arr[x0] + (i / (n - 1)) * yRange)) as Float64Array;
}

// ──────────────────────────────────────────────────────────────────────────────
// FFT (Cooley-Tukey, in-place, power-of-2)
// ──────────────────────────────────────────────────────────────────────────────
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Returns {re, im} arrays of length nextPow2(n) */
function fft(signal: Float64Array): { re: Float64Array; im: Float64Array } {
  const N = nextPow2(signal.length);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < signal.length; i++) re[i] = signal[i];

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1,
        curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nr = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nr;
      }
    }
  }
  return { re, im };
}

/** Power spectrum magnitude (first N/2 bins) */
function powerSpectrum(signal: Float64Array): Float64Array {
  const { re, im } = fft(signal);
  const half = re.length / 2;
  const ps = new Float64Array(half);
  for (let i = 0; i < half; i++) ps[i] = re[i] ** 2 + im[i] ** 2;
  return ps;
}

/** Band-pass filter via FFT zeroing — alias kept for internal use */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _bandpassFFTUnused(signal: Float64Array, fs: number, low: number, high: number): Float64Array {
  return bandpass(signal, fs, low, high);
}

/**
 * Faster band-pass: zero FFT bins outside [low, high] Hz, then naive IDFT.
 * For N < 1024 this is fast enough in a worker.
 */
function bandpass(signal: Float64Array, fs: number, low: number, high: number): Float64Array {
  if (signal.length < 4) return signal;
  const N = nextPow2(signal.length);
  const padded = new Float64Array(N);
  for (let i = 0; i < signal.length; i++) padded[i] = signal[i];

  const { re, im } = fft(padded);

  // Zero bins outside band
  for (let i = 0; i < N; i++) {
    const f = (i <= N / 2 ? i : N - i) * (fs / N);
    if (f < low || f > high) {
      re[i] = 0;
      im[i] = 0;
    }
  }
  // IDFT (slow but correct; N typically ≤ 512)
  const out = new Float64Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    let s = 0;
    for (let k = 0; k < N; k++) {
      const ang = (2 * Math.PI * k * n) / N;
      s += re[k] * Math.cos(ang) - im[k] * Math.sin(ang);
    }
    out[n] = s / N;
  }
  return out;
}

/** Dominant frequency in Hz within [low, high] band */
function dominantFreq(signal: Float64Array, fs: number, low: number, high: number): number {
  const N = nextPow2(signal.length);
  const ps = powerSpectrum(signal);
  let bestPow = -1;
  let bestF = 0;
  for (let i = 0; i < ps.length; i++) {
    const f = i * (fs / N);
    if (f >= low && f <= high && ps[i] > bestPow) {
      bestPow = ps[i];
      bestF = f;
    }
  }
  return bestF;
}

/** Spectral purity: peak power / total band power */
function spectralPurity(signal: Float64Array, fs: number, low: number, high: number): number {
  const N = nextPow2(signal.length);
  const ps = powerSpectrum(signal);
  let totalPow = 0;
  let peakPow = 0;
  for (let i = 0; i < ps.length; i++) {
    const f = i * (fs / N);
    if (f >= low && f <= high) {
      totalPow += ps[i];
      if (ps[i] > peakPow) peakPow = ps[i];
    }
  }
  return totalPow > 0 ? Math.min(peakPow / totalPow, 1) : 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// rPPG algorithms
// ──────────────────────────────────────────────────────────────────────────────

/** CHROM method */
function chrom(Rn: Float64Array, Gn: Float64Array, Bn: Float64Array, fs: number): Float64Array {
  const n = Rn.length;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = 3 * Rn[i] - 2 * Gn[i];
    Y[i] = 1.5 * Rn[i] + Gn[i] - 1.5 * Bn[i];
  }
  const Xf = bandpass(X, fs, HR_LOW, HR_HIGH);
  const Yf = bandpass(Y, fs, HR_LOW, HR_HIGH);
  const stdX = std(Xf) || 1;
  const stdY = std(Yf) || 1;
  const alpha = stdX / stdY;
  return Xf.map((x, i) => x - alpha * Yf[i]) as Float64Array;
}

/** POS method */
function pos(Rn: Float64Array, Gn: Float64Array, Bn: Float64Array, fs: number): Float64Array {
  const n = Rn.length;
  const h1 = new Float64Array(n);
  const h2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    h1[i] = Gn[i] - Bn[i];
    h2[i] = -2 * Rn[i] + Gn[i] + Bn[i];
  }
  const alpha = (std(h1) || 1) / (std(h2) || 1);
  const P = h1.map((v, i) => v + alpha * h2[i]) as Float64Array;
  return bandpass(P, fs, HR_LOW, HR_HIGH);
}

/** PCA method — take first principal component of [Rn, Gn, Bn] */
function pca(Rn: Float64Array, Gn: Float64Array, Bn: Float64Array, fs: number): Float64Array {
  const n = Rn.length;
  const mR = mean(Rn);
  const mG = mean(Gn);
  const mB = mean(Bn);
  // Covariance matrix 3×3
  let vrr = 0, vgg = 0, vbb = 0, vrg = 0, vrb = 0, vgb = 0;
  for (let i = 0; i < n; i++) {
    const r = Rn[i] - mR, g = Gn[i] - mG, b = Bn[i] - mB;
    vrr += r * r; vgg += g * g; vbb += b * b;
    vrg += r * g; vrb += r * b; vgb += g * b;
  }
  vrr /= n; vgg /= n; vbb /= n; vrg /= n; vrb /= n; vgb /= n;

  // Power iteration to find largest eigenvector (3 iterations sufficient)
  let ex = 1 / Math.sqrt(3), ey = 1 / Math.sqrt(3), ez = 1 / Math.sqrt(3);
  for (let iter = 0; iter < 30; iter++) {
    const nx = vrr * ex + vrg * ey + vrb * ez;
    const ny = vrg * ex + vgg * ey + vgb * ez;
    const nz = vrb * ex + vgb * ey + vbb * ez;
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    ex = nx / norm; ey = ny / norm; ez = nz / norm;
  }

  // Project
  const proj = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    proj[i] = ex * (Rn[i] - mR) + ey * (Gn[i] - mG) + ez * (Bn[i] - mB);
  }
  return bandpass(proj, fs, HR_LOW, HR_HIGH);
}

/** Wiener gain: W(f) = SNR(f)/(SNR(f)+1) applied to a 1-D signal */
function wienerFilter(signal: Float64Array, fs: number, low: number, high: number): Float64Array {
  const N = nextPow2(signal.length);
  const padded = new Float64Array(N);
  for (let i = 0; i < signal.length; i++) padded[i] = signal[i];

  const { re, im } = fft(padded);
  const ps = new Float64Array(N);
  for (let i = 0; i < N; i++) ps[i] = re[i] ** 2 + im[i] ** 2;

  // Estimate noise floor as median outside HR band
  let bandTotal = 0, bandCount = 0, noiseTotal = 0, noiseCount = 0;
  for (let i = 0; i < N / 2; i++) {
    const f = i * (fs / N);
    if (f >= low && f <= high) { bandTotal += ps[i]; bandCount++; }
    else { noiseTotal += ps[i]; noiseCount++; }
  }
  const signalVar = bandCount > 0 ? bandTotal / bandCount : 1;
  const noiseVar = noiseCount > 0 ? noiseTotal / noiseCount : 0.001;
  const snrGlobal = signalVar / (noiseVar || 0.001);
  const W = snrGlobal / (snrGlobal + 1);

  // Apply Wiener gain: amplify HR band, attenuate noise
  for (let i = 0; i < N; i++) {
    const f = (i <= N / 2 ? i : N - i) * (fs / N);
    const gain = f >= low && f <= high ? 1.0 : W;
    re[i] *= gain;
    im[i] *= gain;
  }

  // IDFT
  const out = new Float64Array(signal.length);
  for (let n = 0; n < signal.length; n++) {
    let s = 0;
    for (let k = 0; k < N; k++) {
      const ang = (2 * Math.PI * k * n) / N;
      s += re[k] * Math.cos(ang) - im[k] * Math.sin(ang);
    }
    out[n] = s / N;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// Peak detection → IBI
// ──────────────────────────────────────────────────────────────────────────────
function detectPeaks(signal: Float64Array, fs: number): number[] {
  const minDist = Math.round(fs * 60 / 220); // min samples between peaks (220 BPM max)
  const mu = mean(signal);
  const s = std(signal, mu);
  // Lower threshold (0.15σ instead of 0.25σ) to reduce missed beats in noisy signal
  const threshold = mu + 0.15 * s;
  const peaks: number[] = [];
  let lastPeak = -minDist;

  for (let i = 1; i < signal.length - 1; i++) {
    if (
      signal[i] > threshold &&
      signal[i] >= signal[i - 1] &&
      signal[i] >= signal[i + 1] &&
      i - lastPeak >= minDist
    ) {
      peaks.push(i);
      lastPeak = i;
    }
  }
  return peaks;
}

/** Peaks → IBI sequence (ms), filtered to physiological range */
function peaksToIBI(peaks: number[], fs: number): number[] {
  const ibi: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ms = ((peaks[i] - peaks[i - 1]) / fs) * 1000;
    if (ms >= 300 && ms <= 1800) ibi.push(ms);
  }
  return ibi;
}

// ──────────────────────────────────────────────────────────────────────────────
// Metric computations
// ──────────────────────────────────────────────────────────────────────────────

function computeHR(fused: Float64Array, fs: number): number | null {
  const f = dominantFreq(fused, fs, HR_LOW, HR_HIGH);
  return f > 0 ? Math.round(f * 60) : null;
}

function computeRR(rawSignal: Float64Array, fs: number): number | null {
  const bp = bandpass(rawSignal, fs, RR_LOW, RR_HIGH);
  const f = dominantFreq(bp, fs, RR_LOW, RR_HIGH);
  return f > 0 ? Math.round(f * 60 * 10) / 10 : null;
}

function computeSpO2(
  R: Float64Array,
  G: Float64Array,
  B: Float64Array
): number | null {
  if (R.length < 10) return null;
  const dcR = mean(R);
  const dcB = mean(B);
  if (dcR === 0 || dcB === 0) return null;
  const acR = std(R);
  const acB = std(B);
  const ratio = (acR / dcR) / (acB / dcB + 0.001);
  const spo2 = Math.round((100 - 5 * ratio) * 10) / 10;
  return Math.min(100, Math.max(90, spo2));
}

function computeRMSSD(ibi: number[]): number | null {
  if (ibi.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < ibi.length; i++) sum += (ibi[i] - ibi[i - 1]) ** 2;
  return Math.round(Math.sqrt(sum / (ibi.length - 1)) * 10) / 10;
}

function computeLFHF(ibi: number[], fs: number): number | null {
  if (ibi.length < 16) return null; // relaxed from 20 to 16
  // Build uniform tachogram from cumulative IBI times
  const cumT: number[] = [0];
  for (let i = 0; i < ibi.length - 1; i++) cumT.push(cumT[i] + ibi[i] / 1000);
  const totalSec = cumT[cumT.length - 1];
  if (totalSec < 20) return null; // relaxed from 30s to 20s

  const tacho_fs = 4; // Hz
  const tacheN = Math.floor(totalSec * tacho_fs);
  const tachogram = new Float64Array(tacheN);
  let j = 0;
  for (let i = 0; i < tacheN; i++) {
    const tq = i / tacho_fs;
    while (j < cumT.length - 2 && cumT[j + 1] < tq) j++;
    const alpha = (tq - cumT[j]) / (cumT[j + 1] - cumT[j]);
    tachogram[i] = ibi[j] + alpha * (ibi[j + 1] - ibi[j]);
  }
  const detrendedTacho = detrend(tachogram);
  const N = nextPow2(detrendedTacho.length);
  const ps = powerSpectrum(detrendedTacho);

  let lf = 0, hf = 0;
  for (let i = 0; i < ps.length; i++) {
    const f = i * (tacho_fs / N);
    if (f >= 0.04 && f <= 0.15) lf += ps[i];
    if (f >= 0.15 && f <= 0.40) hf += ps[i];
  }
  if (hf === 0) return null;
  return Math.round((lf / hf) * 100) / 100;
}

function computeSI(ibi: number[]): number | null {
  if (ibi.length < 20) return null; // relaxed from 30 to 20
  const maxIBI = Math.max(...ibi);
  const minIBI = Math.min(...ibi);
  const mxDmn = (maxIBI - minIBI) / 1000; // seconds
  if (mxDmn === 0) return null;

  // Histogram with 50ms bins
  const bins: number[] = [];
  const binWidth = 50;
  const binMin = Math.floor(minIBI / binWidth) * binWidth;
  const binMax = Math.ceil(maxIBI / binWidth) * binWidth;
  for (let b = binMin; b < binMax; b += binWidth) bins.push(b);
  const counts = new Array(bins.length).fill(0);
  for (const v of ibi) {
    const idx = Math.floor((v - binMin) / binWidth);
    if (idx >= 0 && idx < counts.length) counts[idx]++;
  }

  let moIdx = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[moIdx]) moIdx = i;

  const Mo = (bins[moIdx] + binWidth / 2) / 1000; // seconds, mode centre
  const AMo = (counts[moIdx] / ibi.length) * 100;  // percent

  const si = AMo / (2 * Mo * mxDmn);
  return Math.round(si * 10) / 10;
}

/**
 * FI 疲劳指数 (0–100, 启发式)
 * 只要 hr + rmssd 有值即可计算，无需等待 lfhf
 */
function computeFI(hr: number | null, rmssd: number | null): number | null {
  if (hr === null || rmssd === null) return null;
  // 心率高 + RMSSD低 → 疲劳高
  return Math.min(100, Math.max(0, Math.round(50 + 0.6 * (hr - 70) - 0.5 * (rmssd - 40))));
}

/**
 * MWI 认知负荷 (0–100, 启发式)
 * 优先使用 lfhf；若 lfhf 尚无数据，用 SI 做线性映射替代
 * SI 典型范围 50–300：映射到等效 lfhf 1.0–3.0
 */
function computeMWI(
  lfhf: number | null,
  rmssd: number | null,
  si: number | null
): number | null {
  if (rmssd === null) return null;

  let effectiveLfhf: number;
  if (lfhf !== null) {
    effectiveLfhf = lfhf;
  } else if (si !== null) {
    // SI 50 → lfhf≈1.0, SI 300 → lfhf≈3.0，线性插值
    effectiveLfhf = 1.0 + ((si - 50) / 250) * 2.0;
    effectiveLfhf = Math.min(4, Math.max(0.5, effectiveLfhf));
  } else {
    return null;
  }

  return Math.min(100, Math.max(0,
    Math.round(40 + 12 * (effectiveLfhf - 1.5) + 0.4 * (50 - rmssd))
  ));
}

// ──────────────────────────────────────────────────────────────────────────────
// Worker message handler
// ──────────────────────────────────────────────────────────────────────────────
self.onmessage = (ev: MessageEvent) => {
  if (ev.data?.type !== "samples") return;

  const samples: RGBSample[] = ev.data.data;
  const elapsed: number = ev.data.elapsed ?? 0; // ms

  if (samples.length < 30) {
    self.postMessage({
      type: "result",
      metrics: { hr: null, rr: null, spo2: null, rmssd: null, lfhf: null, si: null, fi: null, mwi: null, confidence: 0 },
      waveform: [],
      confidence: 0,
      elapsed,
    });
    return;
  }

  // ── Step 1: Resample to uniform FS grid ───────────────────────────────────
  const ts = new Float64Array(samples.map((s) => s.t));
  const rawR = new Float64Array(samples.map((s) => s.r));
  const rawG = new Float64Array(samples.map((s) => s.g));
  const rawB = new Float64Array(samples.map((s) => s.b));

  const R = resampleUniform(ts, rawR, FS);
  const G = resampleUniform(ts, rawG, FS);
  const B = resampleUniform(ts, rawB, FS);

  if (R.length < 30) {
    self.postMessage({
      type: "result",
      metrics: { hr: null, rr: null, spo2: null, rmssd: null, lfhf: null, si: null, fi: null, mwi: null, confidence: 0 },
      waveform: [],
      confidence: 0,
      elapsed,
    });
    return;
  }

  // ── Step 2: Normalise & detrend ───────────────────────────────────────────
  const mR = mean(R) || 1;
  const mG = mean(G) || 1;
  const mB = mean(B) || 1;
  const Rn = detrend(R.map((v) => v / mR) as Float64Array);
  const Gn = detrend(G.map((v) => v / mG) as Float64Array);
  const Bn = detrend(B.map((v) => v / mB) as Float64Array);

  // ── Step 3: Three rPPG methods ────────────────────────────────────────────
  const sChrom = zscore(chrom(Rn, Gn, Bn, FS));
  const sPos   = zscore(pos  (Rn, Gn, Bn, FS));
  const sPca   = zscore(pca  (Rn, Gn, Bn, FS));

  // Phase-align POS/PCA to CHROM via sign of cross-correlation peak
  function alignSign(ref: Float64Array, sig: Float64Array): Float64Array {
    let corr = 0;
    for (let i = 0; i < ref.length; i++) corr += ref[i] * sig[i];
    return corr >= 0 ? sig : sig.map((v) => -v) as Float64Array;
  }
  const sPosA = alignSign(sChrom, sPos);
  const sPcaA = alignSign(sChrom, sPca);

  // ── Step 4: Equal-weight fusion ───────────────────────────────────────────
  const rawFused = new Float64Array(sChrom.length);
  for (let i = 0; i < rawFused.length; i++) {
    rawFused[i] = (sChrom[i] + sPosA[i] + sPcaA[i]) / 3;
  }

  // ── Step 5: Wiener + final band-pass ─────────────────────────────────────
  const filtered = wienerFilter(rawFused, FS, HR_LOW, HR_HIGH);
  const fused = bandpass(filtered, FS, HR_LOW, HR_HIGH);

  // ── Step 6: Metrics ───────────────────────────────────────────────────────
  const peaks = detectPeaks(fused, FS);
  const ibi = peaksToIBI(peaks, FS);

  const elapsedSec = elapsed / 1000;

  const hr    = computeHR(fused, FS);
  const rr    = computeRR(Gn, FS);     // respiration modulates G channel
  const spo2  = computeSpO2(R, G, B);
  const rmssd = ibi.length >= 10 && elapsedSec >= 20  ? computeRMSSD(ibi) : null;
  const lfhf  = elapsedSec >= 60  ? computeLFHF(ibi, FS) : null;
  const si    = ibi.length >= 20 && elapsedSec >= 60   ? computeSI(ibi) : null;
  const fi    = computeFI(hr, rmssd);
  const mwi   = computeMWI(lfhf, rmssd, si);

  // Debug log — remove before release
  // eslint-disable-next-line no-console
  console.log("[worker]", {
    elapsed: Math.round(elapsedSec), peaks: peaks.length, ibi: ibi.length,
    hr, rmssd, lfhf, si, fi, mwi,
    ibiSample: ibi.slice(0, 5).map(v => Math.round(v)),
  });

  const purity = spectralPurity(fused, FS, HR_LOW, HR_HIGH);
  const confidence = Math.round(purity * 100);

  self.postMessage({
    type: "result",
    metrics: { hr, rr, spo2, rmssd, lfhf, si, fi, mwi, confidence },
    waveform: Array.from(fused.slice(-300)), // last 10s
    ibi: ibi.slice(-100),
    confidence,
    elapsed,
  });
};
