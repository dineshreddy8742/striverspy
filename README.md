# StriversEye — Contactless Health Triage Platform

An experimental clinical research tool for contactless physiological assessment using a standard RGB camera.

NovaPulse completely replaces hardware medical tools (finger pulse oximeters, wearable ECGs) by relying on mathematical processing of video signals inside your browser. It maps microscopic facial color variations caused by the cardiac cycle into highly detailed metric tracking.

## Live Demo
Currently designed for local execution via Vite dev server. A static build will be hosted via Vercel (URL TBD).

## Features
- **Heart Rate**: CHROM rPPG signal conversion.
- **Heart Rhythm (AFib)**: Poincare Plot Geometry and Shannon Entropy mapping. 
- **Automonic Balance (LF/HF)**: Calculates Sympathetic vs Parasympathetic balance. 
- **Arterial Stiffness**: Pulse waveform morphology mapping (AIx).
- **Stress Measurement**: HRV RMSSD quantification.
- **Client-Side Secure**: Zero video streams, images, or telemetry are ever uploaded or saved.
- **Liveness Detection**: Prevents spoofing via mathematical blink detection and static sub-pixel variance gating.

## Running Locally

Requires Node.js installed.

```bash
git clone https://github.com/Arkoparno/NovaPulse.git
cd NovaPulse
npm install
npm run dev
# Open http://localhost:5173
# Allow camera permissions. Use bright lighting. Stay still.
```
Navigate to `http://localhost:5173`. Accept camera permissions when prompted. The scanning logic requires bright ambient natural light and a completely still environment.

## The Science
Vitals are extracted using **remote photoplethysmography (rPPG)**. The skin minutely changes color roughly 60+ times a minute as oxyhemoglobin surges through the sub-dermal capillary bed during the heart's systolic phase. By isolating the Green light spectrum (which holds the highest contrast against red hemoglobin), algorithms can track these microscopic luminance changes. The platform mathematically isolates the signal using the de Haan & Jeanne `CHROM` projection, effectively canceling out specular glare and basic motion variations instantly.

Once mapped, the signal is subjected to strict signal-to-noise gating, cleaned with a 2nd-Order Butterworth Bandpass to isolate the cardiac spectrum (0.75 - 2.5Hz), and its peaks are identified. The distances between peaks yield Inter-beat Intervals (IBIs), which provide Heart Rate, Variational markers (RMSSD), and structural AFib geometric classifiers natively inside the browser.

## Bibliography
1. G. de Haan and V. Jeanne, "Robust Pulse Rate from Chrominance-Based rPPG," *IEEE Transactions on Biomedical Engineering*, vol. 60, no. 10, pp. 2878-2886, Oct. 2013.
2. Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology, "Heart rate variability: standards of measurement, physiological interpretation and clinical use," *Circulation*, vol. 93, no. 5, pp. 1043-1065, 1996.
3. M. Brennan, M. Palaniswami, P. Kamen, "Do existing measures of Poincare plot geometry reflect true heart rate variability?," *IEEE TBME*, 2001.
4. J. S. Richman, J. R. Moorman, "Physiological time-series analysis using approximate entropy and sample entropy," *Am J Physiol Heart Circ Physiol*, 2000.
5. S. Koldijk et al., "The SWELL Knowledge Work Dataset for Stress and User Modeling Research," *Intelligent Data Analysis*, 2014.
6. P. Schmidt et al., "Introducing WESAD, a Multimodal Dataset for Wearable Stress and Affect Detection," *ICMI*, 2018.

## Datasets Cited for Threshold Limits
- PURE Dataset (rPPG Ground Truth Validation)
- UBFC-rPPG Dataset
- MIT-BIH Arrhythmia Database (AFib / Normal Sinus Rhythm Validation)
- WESAD Dataset
- SWELL-KW Dataset

## Disclaimer
**This software operates strictly as an experimental research tool.** 
NovaPulse limits outputs algorithmically based on strict statistical probabilities; however, it should under no circumstances be utilized in a clinical diagnostic environment. Consult a certified medical professional with an established Grade A diagnostic platform to evaluate any condition.
