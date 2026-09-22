import { useEffect, useState } from "react";
import styles from "./NowPlaying.module.css";

const ENDPOINT = "https://spotify-now-playing.xthehacker2000x.workers.dev/";
const TRACK_END_DELAY = 3000;
const IDLE_RETRY_DELAY = 15_000;
const ERROR_RETRY_DELAY = 30_000;
const REQUEST_TIMEOUT = 10_000;

interface Track {
  title: string;
  artists: string;
  duration: number;
  progress: number;
  url?: string;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function spotifyUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "open.spotify.com") return url.href;
  } catch {
    // A missing or invalid link should not hide an otherwise valid track.
  }
}

async function fetchTrack(signal: AbortSignal): Promise<Track | null> {
  const response = await fetch(ENDPOINT, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`Spotify returned HTTP ${response.status}; expected a successful response.`);
  const data = response.status === 204 ? null : await response.json();
  if (!data?.title) return null;

  if (typeof data.title !== "string" || !Number.isFinite(data.duration_ms)
    || data.duration_ms <= 0 || !Number.isFinite(data.progress_ms)) {
    throw new Error(`Invalid Spotify track: ${JSON.stringify(data)}; expected a title, positive duration_ms, and finite progress_ms.`);
  }

  return {
    title: data.title,
    artists: typeof data.artists === "string" ? data.artists : "",
    duration: data.duration_ms,
    progress: Math.max(0, Math.min(data.progress_ms, data.duration_ms)),
    url: spotifyUrl(data.url),
  };
}

export default function NowPlaying() {
  const [track, setTrack] = useState<Track | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout>;
    let progressTimer: ReturnType<typeof setInterval>;
    let request: AbortController;

    function startProgress(next: Track) {
      const startedAt = Date.now() - next.progress;
      setElapsed(next.progress);
      if (next.progress >= next.duration) return;

      progressTimer = setInterval(() => {
        const current = Math.min(Math.max(0, Date.now() - startedAt), next.duration);
        setElapsed(current);
        if (current >= next.duration) clearInterval(progressTimer);
      }, 1000);
    }

    async function refresh() {
      clearInterval(progressTimer);
      request = new AbortController();
      const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT);
      let delay = ERROR_RETRY_DELAY;

      try {
        const next = await fetchTrack(request.signal);
        if (disposed) return;
        setTrack(next);
        delay = IDLE_RETRY_DELAY;
        if (next) {
          startProgress(next);
          // Fetch once, three seconds after the estimated end of this track.
          delay = next.duration - next.progress + TRACK_END_DELAY;
        }
      } catch {
        if (!disposed) setTrack(null);
      } finally {
        clearTimeout(timeout);
        if (!disposed) refreshTimer = setTimeout(refresh, delay);
      }
    }

    void refresh();
    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      clearInterval(progressTimer);
      request?.abort();
    };
  }, []);

  /* An empty fragment rather than `null`: @astrojs/react decides a component
     is React by calling it once and checking the result is an element, so a
     null first render makes it hand the island to the MDX renderer, which
     invokes the component outside React and trips "Invalid hook call". */
  if (!track) return <></>;
  const percent = elapsed / track.duration * 100;

  return (
    <div className={styles.widget}>
      <div className={styles.label}>
        Currently listening to:
        <span className={styles.equalizer} aria-hidden="true"><i /><i /><i /></span>
      </div>
      <a className={`${styles.link} link-outline`} href={track.url} target="_blank" rel="noopener noreferrer">
        <div className={styles.track} aria-live="polite" aria-atomic="true">
          <span className={styles.title}>{track.title}</span>
          <span className={styles.separator}>—</span>
          <span className={styles.artist}>{track.artists}</span>
        </div>
      </a>
      <div className={styles.progressRow}>
        <span className={`${styles.time} ${styles.timeCurrent}`}>{formatTime(elapsed)}</span>
        <div
          className={styles.progressBar}
          role="progressbar"
          aria-label="Song progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-valuetext={`${formatTime(elapsed)} of ${formatTime(track.duration)}`}
        >
          <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        </div>
        <span className={`${styles.time} ${styles.timeDuration}`}>{formatTime(track.duration)}</span>
      </div>
    </div>
  );
}
