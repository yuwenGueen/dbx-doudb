// Original score and synthesized game sounds. No remote audio, samples or autoplay.
let context, fxBus, musicBus, limiter, noiseBuffer, musicTimer;
let settings = { sound: false, music: false, musicVolume: 28 };
let hidden = false,
  step = 0,
  nextBeat = 0;
const voices = { fx: new Set(), music: new Set() };
const beatLength = 60 / 104 / 2;
// Eight-bar, lightly swung piano/bass groove, written for DouDB.
const score = [
  {
    bass: 48,
    chord: [60, 64, 67, 71],
    melody: [76, 79, 81, 79, 76, 74, 72, 0],
  },
  {
    bass: 50,
    chord: [62, 65, 69, 72],
    melody: [77, 81, 84, 81, 77, 76, 74, 0],
  },
  {
    bass: 43,
    chord: [59, 62, 65, 67],
    melody: [74, 77, 79, 83, 81, 79, 77, 74],
  },
  {
    bass: 52,
    chord: [59, 64, 67, 71],
    melody: [76, 79, 83, 86, 83, 79, 76, 0],
  },
  {
    bass: 45,
    chord: [60, 64, 67, 69],
    melody: [81, 84, 88, 84, 81, 79, 76, 0],
  },
  {
    bass: 50,
    chord: [60, 62, 65, 69],
    melody: [77, 76, 74, 72, 74, 77, 81, 79],
  },
  {
    bass: 43,
    chord: [59, 62, 65, 69],
    melody: [79, 83, 86, 83, 81, 79, 77, 74],
  },
  {
    bass: 48,
    chord: [60, 64, 67, 69],
    melody: [76, 79, 81, 79, 76, 74, 72, 0],
  },
];
const frequency = (note) => 440 * 2 ** ((note - 69) / 12);
function bus(channel) {
  return channel === "music" ? musicBus : fxBus;
}
function track(source, channel, nodes) {
  voices[channel].add(source);
  source.onended = () => {
    voices[channel].delete(source);
    source.disconnect();
    nodes.forEach((node) => node.disconnect());
  };
}
function tone(
  hz,
  time,
  duration,
  volume,
  type = "sine",
  end = hz,
  channel = "fx",
  pan = 0,
) {
  const source = context.createOscillator(),
    gain = context.createGain(),
    position = context.createStereoPanner();
  source.type = type;
  source.frequency.setValueAtTime(hz, time);
  if (end !== hz)
    source.frequency.exponentialRampToValueAtTime(
      Math.max(25, end),
      time + duration,
    );
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, volume),
    time + 0.008,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  position.pan.setValueAtTime(pan, time);
  source.connect(gain);
  gain.connect(position);
  position.connect(bus(channel));
  track(source, channel, [gain, position]);
  source.start(time);
  source.stop(time + duration + 0.02);
}
function noise(
  time,
  duration,
  volume,
  from = 1600,
  to = 180,
  type = "lowpass",
  channel = "fx",
  pan = 0,
  endPan = pan,
) {
  const source = context.createBufferSource(),
    filter = context.createBiquadFilter(),
    gain = context.createGain(),
    position = context.createStereoPanner();
  source.buffer = noiseBuffer;
  source.loop = true;
  filter.type = type;
  filter.Q.value = 0.65;
  filter.frequency.setValueAtTime(from, time);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(40, to),
    time + duration,
  );
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0002, volume),
    time + 0.012,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  position.pan.setValueAtTime(pan, time);
  position.pan.linearRampToValueAtTime(endPan, time + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(position);
  position.connect(bus(channel));
  track(source, channel, [filter, gain, position]);
  source.start(time);
  source.stop(time + duration + 0.03);
}
function piano(note, time, duration, volume, channel = "music", pan = 0) {
  [1, 2, 3].forEach((harmonic, i) =>
    tone(
      frequency(note) * harmonic,
      time,
      duration / (1 + i * 0.3),
      volume * [1, 0.26, 0.08][i],
      "sine",
      frequency(note) * harmonic,
      channel,
      pan,
    ),
  );
}
function stopVoices(channel) {
  for (const source of voices[channel])
    try {
      source.stop();
    } catch {}
  voices[channel].clear();
}
function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
  stopVoices("music");
}
function audible() {
  return context?.state === "running" && !hidden && !document.hidden;
}
function scheduleMusic() {
  if (!audible() || !settings.music || settings.musicVolume === 0) {
    stopMusic();
    return;
  }
  const horizon = context.currentTime + 0.18;
  while (nextBeat < horizon) {
    const bar = score[Math.floor(step / 8) % score.length],
      position = step % 8;
    const time = nextBeat + (position % 2 ? beatLength * 0.1 : 0);
    if (bar.melody[position])
      piano(bar.melody[position], time, 0.48, 0.075, "music", 0.18);
    if (position % 2 === 0) {
      const bass = bar.bass + [0, 7, 12, 7][position / 2];
      tone(
        frequency(bass),
        time,
        0.4,
        0.15,
        "triangle",
        frequency(bass),
        "music",
        -0.12,
      );
    }
    if (position === 2 || position === 6)
      bar.chord.forEach((note, i) =>
        piano(note, time + i * 0.008, 0.44, 0.035, "music", -0.25),
      );
    noise(
      time,
      0.045,
      position % 2 ? 0.035 : 0.022,
      7500,
      5500,
      "highpass",
      "music",
      0.28,
    );
    if (position === 0 || position === 4)
      tone(105, time, 0.13, 0.12, "sine", 43, "music");
    if (position === 2 || position === 6) {
      noise(time, 0.09, 0.05, 2100, 850, "bandpass", "music", -0.3);
      tone(180, time, 0.06, 0.055, "sine", 90, "music", -0.3);
    }
    step = (step + 1) % (score.length * 8);
    nextBeat += beatLength;
  }
}
function syncMusic() {
  if (!audible() || !settings.music || settings.musicVolume === 0) {
    stopMusic();
    return;
  }
  if (musicTimer) return;
  nextBeat = context.currentTime + 0.045;
  scheduleMusic();
  musicTimer = setInterval(scheduleMusic, 60);
}
export function configureAudio(profile) {
  settings = {
    sound: !!profile.sound,
    music: !!profile.music,
    musicVolume: Math.max(0, Math.min(100, profile.musicVolume ?? 28)),
  };
  if (context) {
    fxBus.gain.setTargetAtTime(
      settings.sound && !hidden ? 0.68 : 0,
      context.currentTime,
      0.025,
    );
    musicBus.gain.setTargetAtTime(
      hidden ? 0 : (settings.musicVolume / 100) * 0.65,
      context.currentTime,
      0.12,
    );
    if (!settings.sound) stopVoices("fx");
    syncMusic();
  }
}
export async function unlockAudio() {
  if ((!settings.sound && !settings.music) || hidden || document.hidden)
    return false;
  try {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      context = new Context();
      fxBus = context.createGain();
      musicBus = context.createGain();
      limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.knee.value = 15;
      limiter.ratio.value = 4;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
      fxBus.connect(limiter);
      musicBus.connect(limiter);
      limiter.connect(context.destination);
      noiseBuffer = context.createBuffer(
        1,
        context.sampleRate * 2,
        context.sampleRate,
      );
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      context.addEventListener("statechange", syncMusic);
    }
    if (context.state === "suspended") await context.resume();
    configureAudio(settings);
    return context.state === "running";
  } catch {
    return false;
  }
}
export function setAudioHidden(value) {
  hidden = !!value;
  if (hidden) {
    stopMusic();
    stopVoices("fx");
  }
  configureAudio(settings);
  if (!hidden) void unlockAudio();
}
export function playGameSound(kind) {
  if (!settings.sound || !audible()) return;
  const t = context.currentTime + 0.01;
  if (kind === "bomb") {
    noise(t, 0.9, 0.65, 3600, 85);
    tone(125, t, 0.7, 0.75, "sine", 29);
    noise(t + 0.05, 0.3, 0.25, 6500, 700, "bandpass", "fx", -0.3, 0.3);
    [0, 0.11, 0.22].forEach((d, i) =>
      tone(70 - i * 9, t + d, 0.45, 0.2, "triangle", 28),
    );
  } else if (kind === "rocket") {
    noise(t, 1.25, 0.45, 250, 6800, "bandpass", "fx", -0.35, 0.35);
    tone(105, t, 0.9, 0.2, "triangle", 1250);
    [84, 88, 91, 96].forEach((n, i) =>
      piano(n, t + 0.75 + i * 0.08, 0.35, 0.17, "fx", i % 2 ? 0.4 : -0.4),
    );
  } else if (kind === "plane") {
    noise(t, 1.0, 0.34, 300, 3000, "bandpass", "fx", -0.85, 0.85);
    tone(230, t, 0.9, 0.13, "sawtooth", 145, "fx", -0.35);
  } else if (kind === "finished" || kind === "landlord" || kind === "spring") {
    const notes =
      kind === "landlord"
        ? [60, 64, 67, 72]
        : kind === "spring"
          ? [72, 76, 79, 84, 88]
          : [72, 76, 79, 84];
    notes.forEach((n, i) =>
      piano(n, t + i * 0.1, 0.65, 0.22, "fx", (i - 2) * 0.12),
    );
    if (kind === "finished")
      [60, 64, 67, 72].forEach((n) => piano(n, t + 0.45, 1.15, 0.15, "fx"));
  } else if (kind === "loss") {
    [67, 64, 60].forEach((n, i) => piano(n, t + i * 0.15, 0.55, 0.15, "fx"));
  } else if (kind === "deal") {
    [0, 0.06, 0.12, 0.18].forEach((d, i) =>
      noise(t + d, 0.045, 0.14, 5000, 1800, "highpass", "fx", (i - 1.5) * 0.25),
    );
  } else {
    noise(t, 0.055, 0.22, 4200, 500, "bandpass");
    tone(340, t, 0.06, 0.12, "triangle", 140);
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopMusic();
    stopVoices("fx");
  } else if (!hidden) void unlockAudio();
});
