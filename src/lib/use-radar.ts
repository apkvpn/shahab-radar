"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicSignal, Snapshot } from "./shared";

// ---- user preferences (client-only, no secrets) ---------------------------------------
export interface Prefs {
  soundOn: boolean;
  soundId: number;
  volume: number;
  desktopOn: boolean;
}
const DEFAULT_PREFS: Prefs = { soundOn: true, soundId: 1, volume: 0.8, desktopOn: true };
const PREFS_KEY = "shr_prefs_v1";

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const n = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  }, []);
  return [prefs, update];
}

// ---- realtime stream (SSE) ------------------------------------------------------------
const SEEN_KEY = "shr_seen_v1";
const SEEN_INIT = "shr_seen_init";
const ALERT_MAX_AGE = 10 * 60_000;

function loadSeen(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveSeen(s: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-300)));
  } catch {
    /* ignore */
  }
}

export function useRadarStream(onAlert: (s: PublicSignal) => void) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [signals, setSignals] = useState<PublicSignal[]>([]);
  const [freshSignals, setFreshSignals] = useState<PublicSignal[]>([]);
  const [online, setOnline] = useState(false);
  const lastEvent = useRef(0);
  const alertRef = useRef(onAlert);

  useEffect(() => {
    alertRef.current = onAlert;
  }, [onAlert]);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const seen = loadSeen();
    let firstHello = !localStorage.getItem(SEEN_INIT);

    const merge = (list: PublicSignal[]) =>
      setSignals((prev) => {
        const map = new Map(prev.map((s) => [s.id, s]));
        for (const s of list) map.set(s.id, s);
        return [...map.values()]
          .sort((a, b) => b.createdAt - a.createdAt || b.signalTime - a.signalTime)
          .slice(0, 40);
      });

    // Each signal id alerts at most once per browser, even across reconnects/reloads.
    const ingest = (list: PublicSignal[], allowAlert: boolean) => {
      merge(list);
      if (list.length) {
        setFreshSignals((prev) => {
          const map = new Map(prev.map((s) => [s.id, s]));
          for (const s of list) map.set(s.id, s);
          return [...map.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
        });
      }
      for (const s of [...list].sort((a, b) => a.createdAt - b.createdAt)) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        if (allowAlert && Date.now() - s.createdAt < ALERT_MAX_AGE) alertRef.current(s);
      }
      saveSeen(seen);
    };

    const touch = () => {
      lastEvent.current = Date.now();
      setOnline(true);
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/stream");
      es.onopen = () => touch();
      es.onerror = () => {
        setOnline(false);
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, 3000);
        }
      };
      es.addEventListener("hello", (ev) => {
        touch();
        try {
          const d = JSON.parse((ev as MessageEvent).data) as { snapshot: Snapshot; signals: PublicSignal[] };
          setSnapshot(d.snapshot);
          ingest(d.signals ?? [], !firstHello);
          if (firstHello) {
            firstHello = false;
            localStorage.setItem(SEEN_INIT, "1");
          }
        } catch {
          /* ignore malformed event */
        }
      });
      es.addEventListener("snapshot", (ev) => {
        touch();
        try {
          setSnapshot(JSON.parse((ev as MessageEvent).data) as Snapshot);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("signal", (ev) => {
        touch();
        try {
          ingest([JSON.parse((ev as MessageEvent).data) as PublicSignal], true);
        } catch {
          /* ignore */
        }
      });
    };
    connect();

    const watchdog = setInterval(() => {
      if (lastEvent.current && Date.now() - lastEvent.current > 20_000) setOnline(false);
    }, 3000);

    return () => {
      stopped = true;
      clearInterval(watchdog);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

  return { snapshot, signals, freshSignals, online };
}
