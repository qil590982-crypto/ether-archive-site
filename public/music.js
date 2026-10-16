const tracks = {
  starlight: {
    notes: [220, 293.66, 329.63, 392, 329.63, 293.66, 261.63, 329.63],
    interval: 2.65, duration: 2.5, attack: .82, level: .25, waveform: 'sine', harmony: 1.5,
  },
  tide: {
    notes: [174.61, 220, 261.63, 220, 196, 246.94, 220, 174.61],
    interval: 3.2, duration: 3.05, attack: 1.05, level: .2, waveform: 'triangle', harmony: 2,
  },
  dusk: {
    notes: [261.63, 329.63, 392, 349.23, 293.66, 392, 329.63, 261.63],
    interval: 1.95, duration: 1.45, attack: .12, level: .17, waveform: 'triangle', harmony: 2,
  },
};

export class MemoryMusic {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.context = null;
    this.masterGain = null;
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.preload = 'none';
    this.audio.volume = .36;
    this.localUrl = null;
    this.volume = .36;
    this.trackId = null;
    this.mode = null;
    this.playing = false;
    this.step = 0;
    this.timer = null;
    this.generation = 0;
  }

  notify() {
    this.onChange({ trackId: this.trackId, mode: this.mode, playing: this.playing });
  }

  getAudioContext() {
    if (this.context) return this.context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('此浏览器暂不支持氛围音乐。');
    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = .0001;
    this.masterGain.connect(this.context.destination);
    return this.context;
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    this.audio.volume = this.volume;
    if (this.context && this.masterGain && this.playing && this.mode === 'preset') {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(Math.max(.0001, this.volume * .42), now, .12);
    }
  }

  fadePresetTo(level, seconds = .24) {
    if (!this.context || !this.masterGain) return;
    const now = this.context.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(Math.max(.0001, level), now, seconds);
  }

  async playPreset(trackId) {
    if (!tracks[trackId]) return;
    this.stop();
    let context;
    try { context = this.getAudioContext(); }
    catch (error) { this.notify(); throw error; }

    const generation = this.generation;
    this.trackId = trackId;
    this.mode = 'preset';
    this.step = 0;
    this.playing = true;
    const resume = context.resume();
    this.fadePresetTo(this.volume * .42, .65);
    this.notify();
    await resume;
    if (generation !== this.generation || !this.playing) return;
    this.scheduleNote(generation);
  }

  async playLocal(blob) {
    if (!(blob instanceof Blob)) throw new Error('没有找到这张照片保存的音频。');
    this.stop();
    this.trackId = 'local';
    this.mode = 'local';
    this.localUrl = URL.createObjectURL(blob);
    this.audio.src = this.localUrl;
    this.audio.volume = this.volume;
    const generation = this.generation;
    const playback = this.audio.play();
    this.playing = true;
    this.notify();
    try { await playback; }
    catch (error) {
      if (generation === this.generation) {
        this.playing = false;
        this.notify();
      }
      throw error;
    }
  }

  scheduleNote(generation) {
    if (generation !== this.generation || !this.playing || this.mode !== 'preset') return;
    const track = tracks[this.trackId];
    if (!track || !this.context) return;
    const frequency = track.notes[this.step % track.notes.length];
    const start = this.context.currentTime + .06;
    this.playTone(frequency, start, track.duration, track.level, track.attack, track.waveform);
    this.playTone(frequency * track.harmony, start + .16, track.duration * .74, track.level * .3, track.attack * .9, 'sine');
    this.step++;
    this.timer = window.setTimeout(() => this.scheduleNote(generation), track.interval * 1000);
  }

  playTone(frequency, start, duration, level, attack, waveform) {
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, start);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(waveform === 'triangle' ? 1500 : 1900, start);
    filter.Q.value = .32;
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0002, level), start + Math.max(.04, attack));
    envelope.gain.exponentialRampToValueAtTime(.0001, start + Math.max(attack + .05, duration));
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(start);
    oscillator.stop(start + duration + .08);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      filter.disconnect();
      envelope.disconnect();
    }, { once: true });
  }

  async toggle() {
    if (this.playing) return this.pause();
    return this.resume();
  }

  async pause() {
    if (!this.playing) return;
    this.playing = false;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.mode === 'local') this.audio.pause();
    else {
      this.fadePresetTo(.0001, .12);
      const context = this.context;
      window.setTimeout(() => {
        if (!this.playing && this.mode === 'preset' && this.context === context) context.suspend().catch(() => {});
      }, 500);
    }
    this.notify();
  }

  async resume() {
    if (!this.trackId || this.playing) return;
    const generation = ++this.generation;
    if (this.mode === 'local') {
      const playback = this.audio.play();
      this.playing = true;
      this.notify();
      try { await playback; }
      catch (error) {
        if (generation === this.generation) { this.playing = false; this.notify(); }
        throw error;
      }
      return;
    }
    if (this.mode === 'preset') {
      const context = this.getAudioContext();
      const resume = context.resume();
      this.playing = true;
      this.fadePresetTo(this.volume * .42, .65);
      this.notify();
      await resume;
      if (generation === this.generation && this.playing) this.scheduleNote(generation);
    }
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;
    this.playing = false;
    this.mode = null;
    this.trackId = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    if (this.localUrl) URL.revokeObjectURL(this.localUrl);
    this.localUrl = null;
    const context = this.context;
    const generation = this.generation;
    this.fadePresetTo(.0001, .12);
    if (context) window.setTimeout(() => {
      if (generation === this.generation && !this.playing) context.suspend().catch(() => {});
    }, 500);
    this.notify();
  }

  dispose() {
    this.stop();
    this.context?.close().catch(() => {});
  }
}

