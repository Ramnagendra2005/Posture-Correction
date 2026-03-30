import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useNotifications Hook
 * 
 * Polls the Python posture service for sustained flaw notifications
 * and manages a queue of in-app toast messages.
 * 
 * Usage:
 *   const { notifications, dismiss, clearAll } = useNotifications({ enabled: true });
 */

const FLASK_BASE = "http://localhost:5001";
const POLL_INTERVAL_MS = 3000; // Check every 3 seconds

export function useNotifications({ enabled = true } = {}) {
  const [notifications, setNotifications] = useState([]);
  const seenIdsRef = useRef(new Set());
  const nextIdRef = useRef(1);

  // Poll Python service for sustained flaw notifications
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${FLASK_BASE}/session_data`);
        if (!res.ok) return;
        const data = await res.json();

        if (!data.active) return;

        // Check for new notifications from sustained flaws
        const sentNotifs = data.notifications_sent || [];
        for (const notif of sentNotifs) {
          const key = `${notif.flaw_type}_${Math.floor(notif.timestamp)}`;
          if (!seenIdsRef.current.has(key)) {
            seenIdsRef.current.add(key);
            const id = nextIdRef.current++;
            setNotifications((prev) => [
              ...prev,
              {
                id,
                type: "warning",
                title: getFlawTitle(notif.flaw_type),
                message: notif.message,
                flawType: notif.flaw_type,
                durationSeconds: notif.duration_seconds,
                timestamp: Date.now(),
                autoDismiss: true,
              },
            ]);
          }
        }

        // Check for active sustained flaws approaching threshold
        const activeFlaws = data.active_sustained_flaws || [];
        for (const flaw of activeFlaws) {
          if (flaw.percentage_to_threshold >= 75 && !flaw.notified) {
            const key = `approaching_${flaw.flaw_type}`;
            if (!seenIdsRef.current.has(key)) {
              seenIdsRef.current.add(key);
              const id = nextIdRef.current++;
              setNotifications((prev) => [
                ...prev,
                {
                  id,
                  type: "info",
                  title: "Posture Warning",
                  message: `${getFlawTitle(flaw.flaw_type)} detected for ${Math.floor(flaw.duration_seconds)}s — threshold approaching.`,
                  flawType: flaw.flaw_type,
                  timestamp: Date.now(),
                  autoDismiss: true,
                },
              ]);
              // Remove approaching warning after it triggers the real one
              setTimeout(() => {
                seenIdsRef.current.delete(key);
              }, 60000);
            }
          }
        }

        // Also check for low blink rate warnings from feedback
        const feedback = data.scores_history?.slice(-1)?.[0]?.scores;
        if (feedback && data.blink_rate > 0 && data.blink_rate < 15) {
          const key = `blink_${Math.floor(Date.now() / 60000)}`;
          if (!seenIdsRef.current.has(key)) {
            seenIdsRef.current.add(key);
            const id = nextIdRef.current++;
            setNotifications((prev) => [
              ...prev,
              {
                id,
                type: "info",
                title: "Eye Health",
                message: `Your blink rate is low (${data.blink_rate}/min). Remember to blink more often!`,
                flawType: "low_blink_rate",
                timestamp: Date.now(),
                autoDismiss: true,
              },
            ]);
          }
        }
      } catch {
        // Service might not be running — fail silently
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled]);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    const timers = notifications
      .filter((n) => n.autoDismiss)
      .map((n) =>
        setTimeout(() => {
          setNotifications((prev) => prev.filter((x) => x.id !== n.id));
        }, 10000)
      );
    return () => timers.forEach(clearTimeout);
  }, [notifications]);

  const dismiss = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Push a manual notification
  const push = useCallback((notif) => {
    const id = nextIdRef.current++;
    setNotifications((prev) => [
      ...prev,
      { id, timestamp: Date.now(), autoDismiss: true, ...notif },
    ]);
  }, []);

  return { notifications, dismiss, clearAll, push };
}

function getFlawTitle(flawType) {
  const titles = {
    head_tilt: "Neck Posture",
    shoulder_misalignment: "Shoulder Alignment",
    forward_lean: "Forward Lean",
    too_close: "Screen Distance",
    low_blink_rate: "Eye Health",
  };
  return titles[flawType] || "Posture Alert";
}

export default useNotifications;
