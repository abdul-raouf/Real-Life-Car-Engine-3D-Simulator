# Spectrogram figures for the case study page.
# Usage: python3 scripts/figures.py   (after npm run render-wavs; needs numpy + matplotlib)
import wave
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

BG = "#111318"
INK = "#d9d4cb"
DIM = "#8f8b84"


def load(path):
    w = wave.open(path)
    sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2).astype(float).mean(1) / 32768
    return x, sr


def figure(path, out, ymax, nfft, title, notes=False):
    x, sr = load(path)
    fig, ax = plt.subplots(figsize=(12, 3.4), dpi=100)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)
    ax.specgram(x, NFFT=nfft, Fs=sr, noverlap=int(nfft * 0.9), cmap="magma", vmin=-110, vmax=-20)
    ax.set_ylim(0, ymax)
    if notes:
        for m in range(30, 80):
            hz = 440 * 2 ** ((m - 69) / 12)
            if hz < ymax and m % 12 in (0, 2, 4, 5, 7, 9, 11):
                ax.axhline(hz, color="#74a9ff", lw=0.4, alpha=0.35)
    for s in ax.spines.values():
        s.set_color("#2b2f38")
    ax.tick_params(colors=DIM, labelsize=9)
    ax.set_xlabel("seconds", color=DIM, fontsize=9)
    ax.set_ylabel("Hz", color=DIM, fontsize=9)
    ax.set_title(title, color=INK, fontsize=11, loc="left")
    fig.tight_layout()
    fig.savefig(out, facecolor=BG, pil_kwargs={"quality": 84, "optimize": True})


figure("out/saints-v8.wav", "public/media/spectrogram-saints-v8.jpg", 500, 8192,
       "V8 playing When the Saints: each bright step is a note, the faint blue lines are the scale", notes=True)
figure("out/r2-tour.wav", "public/media/spectrogram-rotary.jpg", 3000, 2048,
       "Rotary: start, idle, two blips, the limiter at 9,200 rpm, then coasting down")
