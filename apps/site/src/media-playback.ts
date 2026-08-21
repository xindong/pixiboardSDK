export type MediaPlayback = {
  isLoading(): boolean;
  isPlaying(): boolean;
  duration(): number;
  currentTime(): number;
  toggle(): Promise<void>;
  seek(seconds: number): void;
  subscribe(listener: () => void): () => void;
};

export type MediaPlaybackController = {
  controls: MediaPlayback;
  destroy(): void;
};

type MediaPlaybackControllerOptions = {
  createElement: () => Promise<HTMLMediaElement | undefined>;
  destroyElement: (element: HTMLMediaElement) => void;
  durationFallback?: number;
};

const MEDIA_EVENTS = [
  "canplay",
  "durationchange",
  "ended",
  "loadedmetadata",
  "pause",
  "play",
  "seeked",
  "timeupdate",
] as const;

export function createMediaPlaybackController(options: MediaPlaybackControllerOptions): MediaPlaybackController {
  const listeners = new Set<() => void>();
  let element: HTMLMediaElement | undefined;
  let loading: Promise<HTMLMediaElement | undefined> | undefined;
  let requestedPlaying = false;
  let destroyed = false;

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const onMediaEvent = (event: Event) => {
    if (event.type === "ended") requestedPlaying = false;
    notify();
  };
  const bind = (next: HTMLMediaElement) => {
    if (destroyed) {
      options.destroyElement(next);
      return;
    }
    element = next;
    for (const eventName of MEDIA_EVENTS) next.addEventListener(eventName, onMediaEvent);
  };
  const unbind = () => {
    if (!element) return;
    for (const eventName of MEDIA_EVENTS) element.removeEventListener(eventName, onMediaEvent);
    options.destroyElement(element);
    element = undefined;
  };
  const ensureElement = async () => {
    if (destroyed) return undefined;
    if (element) return element;
    if (!loading) {
      loading = options.createElement().then((next) => {
        if (destroyed) {
          if (next) options.destroyElement(next);
          return undefined;
        }
        if (next) bind(next);
        return next;
      }).finally(() => {
        loading = undefined;
        notify();
      });
      notify();
    }
    return loading;
  };

  const controls: MediaPlayback = {
    isLoading: () => Boolean(loading),
    isPlaying: () => Boolean(element && !element.paused && !element.ended),
    duration: () => element && Number.isFinite(element.duration) && element.duration > 0 ? element.duration : options.durationFallback ?? 0,
    currentTime: () => element?.currentTime ?? 0,
    toggle: async () => {
      if (destroyed) return;
      if (requestedPlaying || controls.isPlaying()) {
        requestedPlaying = false;
        element?.pause();
        notify();
        return;
      }
      requestedPlaying = true;
      notify();
      const next = await ensureElement();
      if (!next || !requestedPlaying) return;
      if (next.ended) next.currentTime = 0;
      try {
        await next.play();
      } catch (error) {
        requestedPlaying = false;
        throw error;
      } finally {
        notify();
      }
    },
    seek: (seconds) => {
      if (destroyed) return;
      if (element) element.currentTime = seconds;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    controls,
    destroy: () => {
      destroyed = true;
      requestedPlaying = false;
      loading = undefined;
      unbind();
      listeners.clear();
    },
  };
}
