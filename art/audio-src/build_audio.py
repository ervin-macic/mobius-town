#!/usr/bin/env python3
"""Rebuild Mobius Town's audio/ folder from its CC0 sources.

Every source is an Asset Commons asset; its provenance (asset-commons.json) is
kept in art/audio-src/<asset>/. To rebuild, download each id listed in TRACKS,
LOOPS and SHOTS with asset_commons_download into one folder (AUDIO_SRC; Kenney
packs keep their pack folder names), then run:

    AUDIO_SRC=/path/to/sources python3 art/audio-src/build_audio.py [out_dir]

Needs ffmpeg (libmp3lame) and numpy. Prints a JSON summary: loop points to copy
into av/audio.js, loudness, true peak and seam measurements.

How loops are made seamless
  * A loop [s, s+L) is cut where the music repeats (found by self-similarity of
    log-band spectra, refined to the sample by waveform cross-correlation).
  * Its first XF seconds are crossfaded from what follows the loop end in the
    source into the loop head, so the wrap continues the music exactly.
  * The file holds PAD seconds of the loop tail before the loop and PAD seconds
    of the loop head after it, so the content is L-periodic across the loop
    points. AudioBufferSourceNode.loopStart/loopEnd = PAD and PAD+L. If a
    browser keeps the MP3 encoder delay (~25 ms) both points shift together and
    the loop stays seamless.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np

SR = 44100
PAD = 0.3  # seconds of periodic padding either side of a loop
SRC = os.environ.get('AUDIO_SRC', os.path.expanduser('~/audio-src'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'audio')

MUSIC_LUFS = -20.0
SFX_LUFS = -16.0
AMBIENT_LUFS = -20.0
CEILING = -1.0  # dBTP

# Music and dance loops. mode 'whole': the file is the author's own loop.
# mode 'cut': loop [s, s+L) (approximate, refined here); head: where the music
# that follows the loop end lives (default s+L).
TRACKS = [
    dict(out='town.mp3', id='opengameart:town-theme-rpg', src='town-theme-rpg/TownTheme.mp3', mode='cut', s=13.64, L=75.971, xf=0.25, pre=0.25, post=1.0),
    dict(out='interior.mp3', id='opengameart:a-small-fire-will-do-calming-loop', src='a-small-fire-will-do-calming-loop/a_small_fire_will_do.wav', mode='whole'),
    dict(out='dance-minstrel.mp3', id='opengameart:medieval-minstrel-dance', src='medieval-minstrel-dance/Loop_Minstrel_Dance.wav', mode='whole'),
    dict(out='dance-disco.mp3', id='opengameart:funky-disco-beats-to-boogiewoogie-to', src='funky-disco-beats-to-boogiewoogie-to/funkydiscobeatstoboogieslashwoogieto.flac', mode='cut', s=4.783, L=34.911, xf=0.25),
    dict(out='dance-flowerbed.mp3', id='opengameart:flowerbed-fields-loop', src='flowerbed-fields-loop/flowerbed_fields.ogg', mode='cut', s=34.830, L=52.976, xf=0.25),
    # Tropical: a 4-bar pattern played twice, then 0.37 s of silence. Loop the 8 bars from 0; what
    # follows bar 8 is what follows bar 4 (the pattern repeats), so crossfade from there.
    dict(out='dance-tropical.mp3', id='opengameart:tropical-loop', src='tropical-loop/Tropical.wav', mode='pattern2', s=0.0, P=8.731, xf=0.15),
]
LOOPS = [
    dict(out='fire.mp3', id='freesound:813328', src='813328-crackling-flames-loop/813328-crackling-flames-loop.ogg', mode='whole', mono=True, limit_db=8.0),
]
KEN = 'kenney'  # folder holding the Kenney packs
SHOTS = [
    dict(out='coin.mp3', id='kenney:rpg-audio', src='rpg-audio/Audio/handleCoins2.ogg'),
    dict(out='splash.mp3', id='freesound:398032', src='398032-splash/398032-splash.ogg'),
    dict(out='lock.mp3', id='kenney:rpg-audio', src='rpg-audio/Audio/metalLatch.ogg'),
    dict(out='unlock.mp3', id='kenney:rpg-audio', src='rpg-audio/Audio/metalClick.ogg'),
    dict(out='door.mp3', id='kenney:rpg-audio', src='rpg-audio/Audio/doorOpen_1.ogg'),
    dict(out='chime.mp3', id='kenney:interface-sounds', src='interface-sounds/Audio/confirmation_004.ogg'),
    dict(out='fanfare.mp3', id='freesound:521639', src='521639-winbrass/521639-winbrass.ogg'),
    dict(out='win.mp3', id='kenney:music-jingles', src='music-jingles/Audio/Pizzicato jingles/jingles_PIZZI10.ogg'),
    dict(out='lose.mp3', id='kenney:music-jingles', src='music-jingles/Audio/Pizzicato jingles/jingles_PIZZI07.ogg'),
    dict(out='pop.mp3', id='kenney:interface-sounds', src='interface-sounds/Audio/drop_004.ogg'),
    dict(out='click.mp3', id='kenney:ui-audio', src='ui-audio/Audio/click1.ogg', limit_db=4.0),
    dict(out='sparkle.mp3', id='freesound:457306', src='457306-anime/457306-anime.ogg'),
    dict(out='whoosh.mp3', id='freesound:60011', src='60011-whoosh-24/60011-whoosh-24.ogg'),
]


def src_path(rel):
    for base in (SRC, os.path.join(SRC, KEN)):
        p = os.path.join(base, rel)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(rel)


def run(cmd, data=None):
    r = subprocess.run(cmd, input=data, capture_output=True)
    if r.returncode:
        raise RuntimeError(f'{cmd[:6]}... failed: {r.stderr.decode()[-800:]}')
    return r


def native_rate(path):
    out = run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', path]).stdout
    return int(out.decode().strip().split(',')[0])


def decode(path, ch=2, sr=None):
    args = ['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', str(ch)]
    if sr:
        args += ['-ar', str(sr)]
    raw = run(args + ['-']).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).T.copy()


def resample(x, sr_in, sr_out):
    ch = x.shape[0]
    raw = run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(sr_in), '-ac', str(ch), '-i', '-', '-af', 'aresample=resampler=soxr:precision=28' if has_soxr() else 'aresample',
               '-ar', str(sr_out), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], x.T.astype(np.float32).tobytes()).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).T.copy()


_SOXR = None


def has_soxr():
    global _SOXR
    if _SOXR is None:
        _SOXR = b'soxr' in subprocess.run(['ffmpeg', '-hide_banner', '-h', 'filter=aresample'], capture_output=True).stdout
    return _SOXR


def load_loop_source(path, ch):
    """Decode at 44.1 kHz. A whole-file loop at another rate is resampled as a periodic signal."""
    sr = native_rate(path)
    if sr == SR:
        return decode(path, ch)
    x = decode(path, ch)
    n_out = int(round(x.shape[1] * SR / sr))
    tiled = resample(np.concatenate([x, x, x], axis=1), sr, SR)
    start = int(round(x.shape[1] * SR / sr))
    return tiled[:, start:start + n_out]


def ncc(a, b):
    den = np.sqrt(np.dot(a, a) * np.dot(b, b)) or 1.0
    return float(np.dot(a, b) / den)


def refine_lag(mono, s, L, search=0.03, pre=1.0, post=1.5):
    """Best lag near L (samples) so that the audio around the seam s matches the audio around s+L."""
    s = max(0, s - int(pre * SR))
    W = int((pre + post) * SR)
    a = mono[s:s + W]
    span = int(search * SR)
    # FFT cross-correlation of a against the region around s+L
    seg = mono[s + L - span: s + L + span + W]
    n = 1 << (len(seg) + len(a)).bit_length()
    c = np.fft.irfft(np.fft.rfft(seg, n) * np.conj(np.fft.rfft(a, n)), n)[: 2 * span + 1]
    # normalise by the energy of each window of seg
    cs = np.concatenate([[0.0], np.cumsum(seg.astype(np.float64) ** 2)])
    energy = cs[W:W + 2 * span + 1] - cs[:2 * span + 1]
    score = c / np.sqrt(energy * np.dot(a, a) + 1e-12)
    k = int(np.argmax(score))
    return L - span + k, float(score[k])


def raised_cos(n):
    return (0.5 - 0.5 * np.cos(np.pi * (np.arange(n) + 0.5) / n)).astype(np.float32)


def build_loop(x, spec):
    mono = x.mean(axis=0)
    info = {}
    if spec['mode'] == 'whole':
        return x.copy(), {'source_range_s': [0.0, round(x.shape[1] / SR, 4)], 'crossfade_s': 0}
    if spec['mode'] == 'cut':
        s = int(round(spec['s'] * SR))
        L, score = refine_lag(mono, s, int(round(spec['L'] * SR)), pre=spec.get('pre', 1.0), post=spec.get('post', 1.5))
        head = s + L
    elif spec['mode'] == 'pattern2':
        s = int(round(spec['s'] * SR))
        probe = s + int(0.5 * SR)
        P, score = refine_lag(mono, probe, int(round(spec['P'] * SR)), pre=0.0, post=2.5)
        L = 2 * P
        head = s + P
    C = int(spec['xf'] * SR)
    y = x[:, s:s + L].copy()
    r = raised_cos(C)
    y[:, :C] = x[:, head:head + C] * (1 - r) + x[:, s:s + C] * r
    info.update({'source_range_s': [round(s / SR, 4), round((s + L) / SR, 4)], 'match_ncc': round(score, 4), 'crossfade_s': spec['xf']})
    return y, info


def band_feats(mono, n_fft=2048, hop=512, bands=36, floor=None):
    """Log energy in log-spaced bands 50 Hz..11 kHz with an energy floor (60 dB under the mean)."""
    if len(mono) < n_fft:
        mono = np.pad(mono, (0, n_fft - len(mono)))
    fr = np.lib.stride_tricks.sliding_window_view(mono, n_fft)[::hop]
    mag = np.abs(np.fft.rfft(fr * np.hanning(n_fft), axis=1)) ** 2
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    idx = np.searchsorted(freqs, np.geomspace(50, 11000, bands + 1))
    cs = np.cumsum(mag, axis=1)
    e = cs[:, idx[1:] - 1] - cs[:, idx[:-1] - 1]
    if floor is None:
        floor = 1e-6 * float(e.sum(axis=1).mean()) + 1e-12
    return np.log10(e + floor), floor


def seam_metrics(y, start, end, w=0.25, body=None):
    """Playback jumps from sample end-1 back to start. Sample jump vs the loop's own steps, and the
    spectral flux across the jump vs the flux distribution inside the loop (or `body` range)."""
    mono = y.mean(axis=0) if y.ndim == 2 else y
    lo, hi = body or (start, end)
    steps = np.abs(np.diff(mono[lo:hi]))
    jump = abs(float(mono[end - 1] - mono[start]))
    n = int(w * SR)
    body, floor = band_feats(mono[lo:hi])
    fl_all = np.sqrt((np.diff(body, axis=0) ** 2).sum(axis=1))
    wrap = np.concatenate([mono[end - n:end], mono[start:start + n]])
    f, _ = band_feats(wrap, floor=floor)
    flux = np.sqrt((np.diff(f, axis=0) ** 2).sum(axis=1))
    mid = n // 512
    return {'jump': round(jump, 4), 'step_p99': round(float(np.percentile(steps, 99)), 4),
            'flux': round(float(flux[max(0, mid - 3): mid + 3].max()), 2),
            'flux_p95': round(float(np.percentile(fl_all, 95)), 2), 'flux_p99': round(float(np.percentile(fl_all, 99)), 2)}


def limit(y, pre_db, ceiling_db, periodic=False, attack=2.0, release=40.0):
    """Lookahead limiter (ffmpeg alimiter, delay-compensated). periodic: limit a loop as a loop."""
    ch = y.shape[0]
    L = y.shape[1]
    g = np.float32(10 ** (pre_db / 20))
    pad = int(0.05 * SR)
    src = np.concatenate([y, y, y], axis=1) * g if periodic else np.pad(y * g, ((0, 0), (pad, pad)))
    raw = run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-af',
               f'alimiter=limit={10 ** (ceiling_db / 20):.5f}:attack={attack}:release={release}:level=0:latency=1',
               '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], src.T.astype(np.float32).tobytes()).stdout
    out = np.frombuffer(raw, dtype=np.float32).reshape(-1, ch).T.copy()
    assert out.shape[1] == src.shape[1], (out.shape, src.shape)
    return out[:, L:2 * L] if periodic else out[:, pad:pad + L]


def write_wav(path, y):
    ch = y.shape[0]
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-c:a', 'pcm_f32le', path], y.T.astype(np.float32).tobytes())


def ebur(path, pad=False):
    af = ('apad=pad_dur=0.5,' if pad else '') + 'ebur128=peak=true:framelog=info'
    out = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', af, '-f', 'null', '-']).stderr.decode()
    mom = [float(v) for v in re.findall(r'M:\s*(-?[\d.]+)', out) if float(v) > -100]
    integ = re.findall(r'I:\s*(-?[\d.]+) LUFS', out)
    tp = re.findall(r'Peak:\s*(-?[\d.]+|-inf) dBFS', out)
    return {'I': float(integ[-1]) if integ else None, 'Mmax': max(mom) if mom else None,
            'TP': float(tp[-1]) if tp and tp[-1] != '-inf' else None}


def encode(y, out, kbps):
    ch = y.shape[0]
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k',
         '-ac', str(ch), '-map_metadata', '-1', '-id3v2_version', '0', '-write_id3v1', '0', out], y.T.astype(np.float32).tobytes())


def db(v):
    return 20 * np.log10(max(float(v), 1e-12))


def make_loop_file(spec, kind, tmp):
    ch = 1 if spec.get('mono') else 2
    x = load_loop_source(src_path(spec['src']), ch)
    y, info = build_loop(x, spec)
    L = y.shape[1]
    info['seam_built'] = seam_metrics(y, 0, L)
    # loudness of the loop (two passes so the wrap is included)
    wav = os.path.join(tmp, 'loop.wav')
    write_wav(wav, np.concatenate([y, y], axis=1))
    m = ebur(wav)
    target = AMBIENT_LUFS if kind == 'ambient' else MUSIC_LUFS
    gain = target - m['I']
    limited_db = 0.0
    if m['TP'] is not None and m['TP'] + gain > CEILING and spec.get('limit_db'):
        pre = min(gain, CEILING - m['TP'] + spec['limit_db'])
        y = limit(y, pre, CEILING - 1.0, periodic=True, attack=3.0, release=60.0)
        limited_db = round(pre - (CEILING - m['TP']), 2)
        write_wav(wav, np.concatenate([y, y], axis=1))
        m = ebur(wav)
        gain = target - m['I']
    if m['TP'] is not None and m['TP'] + gain > CEILING:
        gain = CEILING - m['TP']
    info['limiter_db'] = limited_db
    y = y * np.float32(10 ** (gain / 20))
    P = int(PAD * SR)
    body = np.concatenate([y[:, L - P:], y, y[:, :P]], axis=1)
    out = os.path.join(OUT, spec['out'])
    encode(body, out, 64 if ch == 1 else 96)
    # verify the encoded file
    z = decode(out, ch)
    v = ebur(out)
    res = {
        'file': spec['out'], 'id': spec['id'], 'bytes': os.path.getsize(out), 'duration_s': round(z.shape[1] / SR, 3),
        'loop_s': round(L / SR, 4), 'loopStart': round(P / SR, 6), 'loopEnd': round((P + L) / SR, 6),
        'decoded_samples': z.shape[1], 'expected_samples': body.shape[1], 'gain_db': round(gain, 2),
        'LUFS_I': v['I'], 'TP': v['TP'], **info,
        'seam_mp3': seam_metrics(z, P, P + L),
        'seam_mp3_shift_1105': seam_metrics(z, P + 1105, P + L + 1105) if z.shape[1] > P + L + 1105 + int(0.25 * SR) else None,
        'seam_mp3_continuous_ref': seam_metrics(z, P + L, P + L, body=(P, P + L)),
        'period_ncc_mp3': round(ncc(z.mean(0)[P:P + P], z.mean(0)[P + L:P + L + P]), 5),
    }
    return res


def trim(x, lead_db=-50, tail_db=-60):
    mono = np.abs(x.mean(axis=0))
    on = np.where(mono > 10 ** (lead_db / 20))[0]
    if not len(on):
        return x
    a = max(0, on[0] - int(0.003 * SR))
    # tail: last 10 ms frame above tail_db
    n = int(0.01 * SR)
    frames = len(mono) // n
    env = np.sqrt((x.mean(axis=0)[: frames * n].reshape(frames, n) ** 2).mean(axis=1))
    loud = np.where(env > 10 ** (tail_db / 20))[0]
    b = min(x.shape[1], (loud[-1] + 2) * n) if len(loud) else x.shape[1]
    y = x[:, a:b].copy()
    fi = min(int(0.002 * SR), y.shape[1] // 4)
    if a > 0 and fi:
        y[:, :fi] *= np.linspace(0, 1, fi, dtype=np.float32)
    fo = min(int(0.02 * SR), y.shape[1] // 4)
    if fo:
        y[:, -fo:] *= np.linspace(1, 0, fo, dtype=np.float32) ** 2
    return y


def make_shot(spec, tmp):
    x = decode(src_path(spec['src']), 1, SR)
    y = trim(x)
    wav = os.path.join(tmp, 'shot.wav')
    write_wav(wav, y)
    m = ebur(wav, pad=True)
    need = SFX_LUFS - m['Mmax']
    room = CEILING - m['TP'] if m['TP'] is not None else need
    limited_db = 0.0
    if need > room + 0.5 and spec.get('limit_db', 6.0) > 0:
        pre = min(need, room + spec.get('limit_db', 6.0))
        y = limit(y, pre, CEILING - 0.5)
        limited_db = round(pre - room, 2)
        write_wav(wav, y)
        m = ebur(wav, pad=True)
        need = SFX_LUFS - m['Mmax']
        room = CEILING - m['TP'] if m['TP'] is not None else need
    gain = min(need, room)
    limited = gain < need - 0.05
    y = y * np.float32(10 ** (gain / 20))
    out = os.path.join(OUT, spec['out'])
    encode(y, out, 64)
    v = ebur(out, pad=True)
    return {'file': spec['out'], 'id': spec['id'], 'source_file': os.path.basename(spec['src']), 'bytes': os.path.getsize(out),
            'duration_s': round(y.shape[1] / SR, 3), 'source_duration_s': round(x.shape[1] / SR, 3), 'gain_db': round(gain, 2),
            'limiter_db': limited_db, 'peak_bound': limited, 'Mmax': v['Mmax'], 'LUFS_I': v['I'], 'TP': v['TP']}


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(os.environ.get('ONLY', '').split(',')) - {''}
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for spec in TRACKS:
            if not only or spec['out'] in only:
                results.append(make_loop_file(spec, 'music', tmp))
                print(json.dumps(results[-1]), flush=True)
        for spec in LOOPS:
            if not only or spec['out'] in only:
                results.append(make_loop_file(spec, 'ambient', tmp))
                print(json.dumps(results[-1]), flush=True)
        for spec in SHOTS:
            if not only or spec['out'] in only:
                results.append(make_shot(spec, tmp))
                print(json.dumps(results[-1]), flush=True)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.mp3'))
    print(json.dumps({'total_bytes': total}))


if __name__ == '__main__':
    main()
