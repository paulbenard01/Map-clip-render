#!/usr/bin/env python3
"""
The Heritle sonic logo: two soft electric-piano chords, Gmaj7 -> Dmaj9,
over a faint pad, about 4.4s long.

    pip install numpy scipy
    python video/tools/sting.py video/brand/heritle-sting.wav

Time 0 is the end of the voiceover; the end card's logo appears at 0.3s
(first chord), the wordmark at 1.0s (second chord). In an edit, drop the file
where the voiceover ends.
"""
import sys
import numpy as np
from scipy.signal import fftconvolve, sosfilt, butter
from scipy.io import wavfile

SR = 48000
DUR = 4.4
N = int(SR * DUR)
t = np.arange(N) / SR
# The random pad noise and reverb are drawn from this generator state, which
# reproduces the take that was picked (video/brand/heritle-sting.wav).
rng = np.random.default_rng()
rng.bit_generator.state = {"bit_generator": "PCG64", "has_uint32": 0, "uinteger": 0, "state": {
    "state": 315664731191812441896307869426324717325, "inc": 261136684632268670825940853076396136793}}

NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}
def hz(name):  # "F#4" -> Hz
    return 440.0 * 2 ** ((NOTE[name[:-1]] + 12 * (int(name[-1]) + 1) - 69) / 12)

def seg(d): return np.arange(int(d * SR)) / SR
def lowpass(x, fc): return sosfilt(butter(2, fc, fs=SR, output="sos"), x)

def place(out, sig, at, gain):
    i = int(at * SR); n = min(len(sig), N - i)
    out[i:i + n] += gain * sig[:n]

def rhodes(f, d=4.0):
    """Electric piano: gentle FM with a fading index, soft tremolo."""
    s = seg(d)
    idx = .1 + .7 * np.exp(-s / .25)
    y = np.sin(2 * np.pi * f * s + idx * np.sin(2 * np.pi * f * s)) * np.exp(-s / 2.2)
    y *= np.minimum(1, s / .006) * (1 - .12 * (1 - np.cos(2 * np.pi * 4.2 * s)) / 2)
    return lowpass(y, 3000)

def air(freqs, start, peak, end):
    """Very soft pad: sines plus breathy filtered noise."""
    env = np.interp(t, [0, start, peak, end, DUR], [0, 0, 1, 0, 0]) ** 2
    y = sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * (1 + .003 * np.sin(2 * np.pi * .3 * t)) for f in freqs) / len(freqs)
    nz = sosfilt(butter(2, [300, 1500], "bandpass", fs=SR, output="sos"), rng.standard_normal(N)) * .15
    return lowpass(y + nz, 1800) * env

def reverb(chans, size, wet, pre=0.018):
    n = int(size * SR); s = np.arange(n) / SR
    out = []
    for x in chans:
        ir = sosfilt(butter(1, 6000, fs=SR, output="sos"), rng.standard_normal(n) * np.exp(-s * 6.9 / size))
        ir = np.concatenate([np.zeros(int(pre * SR)), ir]); ir /= np.sqrt(np.sum(ir ** 2))
        out.append((1 - wet) * x + wet * 1.3 * fftconvolve(x, ir)[:N])
    return out

def lufs(st):
    """Integrated loudness (ITU-R BS.1770, 48 kHz K-weighting with gating)."""
    from scipy.signal import lfilter
    x = lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], st, axis=0)
    x = lfilter([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], x, axis=0)
    blk, hop = int(.4 * SR), int(.1 * SR)
    ms = np.array([np.mean(x[i:i + blk] ** 2, axis=0).sum() for i in range(0, len(x) - blk + 1, hop)])
    lk = -0.691 + 10 * np.log10(ms + 1e-12)
    ms = ms[lk > -70]
    rel = -0.691 + 10 * np.log10(ms.mean()) - 10
    return -0.691 + 10 * np.log10(ms[-0.691 + 10 * np.log10(ms) > rel].mean())

def main(path):
    L, R = np.zeros(N), np.zeros(N)
    def add(sig, p):  # equal-power pan, p in -1..1
        a = (p + 1) * np.pi / 4
        L[:] += sig * np.cos(a); R[:] += sig * np.sin(a)
    # Gmaj7 as the logo appears, cut short so it hands over to...
    for i, n in enumerate(["G3", "B3", "D4", "F#4"]):
        b = np.zeros(N); place(b, rhodes(hz(n), 1.2) * np.interp(seg(1.2), [0, .9, 1.2], [1, 1, 0]), .30 + .02 * i, .3)
        add(b, -.15 + .1 * i)
    # ...Dmaj9 on the wordmark, left to ring out.
    for i, n in enumerate(["D3", "A3", "E4", "F#4", "C#5"]):
        b = np.zeros(N); place(b, rhodes(hz(n)), 1.0 + .025 * i, .18 if n == "C#5" else .3)
        add(b, -.2 + .1 * i)
    add(air([hz("D3"), hz("A3")], .8, 1.6, 4.3) * .2, 0)
    L, R = reverb((L, R), 2.8, .28)
    st = np.stack([lowpass(L, 5000), lowpass(R, 5000)], 1)
    st *= np.interp(t, [0, DUR - .35, DUR], [1, 1, 0])[:, None]
    st = sosfilt(butter(2, 35, "highpass", fs=SR, output="sos"), st, axis=0)
    st *= 10 ** ((-20 - lufs(st)) / 20)  # -20 LUFS: sits under the end card, peaks around -6 dBFS
    wavfile.write(path, SR, (st * 32767).astype(np.int16))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "heritle-sting.wav")
