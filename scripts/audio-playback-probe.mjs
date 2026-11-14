// TEST ONLY. Inject before application initialization with Playwright's
// addInitScript. Native constructors, play promises and output routes retain
// their real behavior. Parallel unconnected analyser taps only observe PCM.
// This file is never imported by either production application.
export function installCrownfallAudioProbe() {
  if (window.__crownfallAudioProbe) return;
  const elements = [], contexts = [], events = [], playCalls = [], oscillators = [];
  const nodes = [], edges = [], meters = [], mediaSources = [];
  const elementIds = new WeakMap(), nodeIds = new WeakMap();
  const now = () => performance.now();
  const mediaId = media => {
    if (elementIds.has(media)) return elementIds.get(media);
    const id = elements.length + 1; elementIds.set(media, id); elements.push(media);
    for (const name of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'pause', 'ended', 'waiting', 'stalled', 'error', 'emptied']) {
      media.addEventListener(name, () => events.push({ at: now(), name, id, src: media.currentSrc || media.src, currentTime: media.currentTime,
        readyState: media.readyState, paused: media.paused, ended: media.ended,
        error: media.error ? { code: media.error.code, message: media.error.message } : null }));
    }
    return id;
  };
  const nodeId = node => {
    if (!node || typeof node !== 'object') return null;
    if (nodeIds.has(node)) return nodeIds.get(node);
    const id = nodes.length + 1; nodeIds.set(node, id); nodes.push(node); return id;
  };
  const NativeAudio = window.Audio;
  if (NativeAudio) window.Audio = new Proxy(NativeAudio, { construct(Target, args, newTarget) {
    const media = Reflect.construct(Target, args, newTarget); mediaId(media); return media;
  } });
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const call = { id: mediaId(this), at: now(), src: this.currentSrc || this.src,
      trustedActivation: navigator.userActivation?.isActive ?? null, priorActivation: navigator.userActivation?.hasBeenActive ?? null, outcome: 'pending' };
    playCalls.push(call);
    let result;
    try { result = nativePlay.apply(this, args); }
    catch (error) { call.outcome = 'threw'; call.error = String(error); throw error; }
    result?.then(() => { call.outcome = 'resolved'; call.completedAt = now(); }, error => {
      call.outcome = 'rejected'; call.completedAt = now(); call.error = { name: error.name, message: error.message };
    });
    return result;
  };
  const NativeContext = window.AudioContext || window.webkitAudioContext;
  const nativeConnect = window.AudioNode?.prototype.connect;
  const nativeDisconnect = window.AudioNode?.prototype.disconnect;
  const addMeter = (source, kind, id) => {
    if (!nativeConnect) return;
    try {
      const analyser = source.context.createAnalyser(); analyser.fftSize = 512;
      nativeConnect.call(source, analyser);
      meters.push({ analyser, kind, sourceNode: nodeId(source), mediaId: id ?? null });
    } catch (error) { events.push({ at: now(), name: 'observer-meter-unavailable', error: String(error) }); }
  };
  if (nativeConnect) AudioNode.prototype.connect = function (destination, ...args) {
    const result = nativeConnect.call(this, destination, ...args);
    if (destination && typeof destination === 'object') {
      edges.push({ from: nodeId(this), to: nodeId(destination), active: true });
      if (destination === this.context.destination && !meters.some(meter => meter.kind === 'output' && meter.analyser.context === this.context)) addMeter(this, 'output');
    }
    return result;
  };
  if (nativeDisconnect) AudioNode.prototype.disconnect = function (...args) {
    const result = nativeDisconnect.apply(this, args), from = nodeId(this);
    for (const edge of edges) if (edge.from === from && (!args.length || typeof args[0] === 'number' || edge.to === nodeId(args[0]))) edge.active = false;
    return result;
  };
  if (NativeContext) {
    const prototype = NativeContext.prototype;
    const source = prototype.createMediaElementSource;
    prototype.createMediaElementSource = function (media) {
      const result = source.call(this, media), id = mediaId(media);
      mediaSources.push({ mediaId: id, sourceNode: nodeId(result) }); addMeter(result, 'decoded-music', id); return result;
    };
    const oscillator = prototype.createOscillator;
    prototype.createOscillator = function (...args) {
      const result = oscillator.apply(this, args), start = result.start;
      result.start = function (...values) { oscillators.push({ at: now(), node: nodeId(result), contextState: result.context.state }); return start.apply(this, values); };
      return result;
    };
    const Context = new Proxy(NativeContext, { construct(Target, args, newTarget) {
      const context = Reflect.construct(Target, args, newTarget); contexts.push(context); return context;
    } });
    window.AudioContext = Context;
    if (window.webkitAudioContext === NativeContext) window.webkitAudioContext = Context;
  }
  const snapshot = () => {
    const samples = new Float32Array(512);
    return {
      at: now(), visibility: document.visibilityState,
      contextStates: contexts.map((context, index) => ({ id: index + 1, state: context.state, currentTime: context.currentTime, sampleRate: context.sampleRate })),
      media: elements.map(media => ({ id: mediaId(media), src: media.src, currentSrc: media.currentSrc, srcAttribute: media.getAttribute('src'),
        currentTime: media.currentTime, duration: Number.isFinite(media.duration) ? media.duration : null, paused: media.paused, ended: media.ended,
        readyState: media.readyState, networkState: media.networkState, preload: media.preload, muted: media.muted, volume: media.volume,
        buffered: Array.from({ length: media.buffered.length }, (_, i) => [media.buffered.start(i), media.buffered.end(i)]),
        played: Array.from({ length: media.played.length }, (_, i) => [media.played.start(i), media.played.end(i)]), error: media.error ? { code: media.error.code, message: media.error.message } : null })),
      nodes: nodes.map((node, index) => ({ id: index + 1, kind: node.constructor.name, gain: node.gain?.value ?? null })),
      edges: edges.filter(edge => edge.active), mediaSources: [...mediaSources],
      meters: meters.map(meter => {
        meter.analyser.getFloatTimeDomainData(samples); let sum = 0; for (const value of samples) sum += value * value;
        return { kind: meter.kind, mediaId: meter.mediaId, sourceNode: meter.sourceNode, contextState: meter.analyser.context.state, rms: Math.sqrt(sum / samples.length) };
      }), events: [...events], playCalls: playCalls.map(call => ({ ...call })), oscillators: [...oscillators],
    };
  };
  Object.defineProperty(window, '__crownfallAudioProbe', { configurable: true, value: { elements, contexts, snapshot,
    documentToken: crypto.randomUUID(), installedURL: location.href, installedAt: performance.timeOrigin + performance.now(),
    method: 'Test-only transparent native constructor/play observation and parallel unconnected PCM analyser taps; no autoplay bypass or production hook.' } });
}
