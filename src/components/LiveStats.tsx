import { useEffect, useState } from 'react';
import { Activity, Users } from 'lucide-react';
import { fetchCombinedStats, isBackendEnabled } from '@/utils/backend';

interface Stats {
  activeJobs: number;
  activeUsers: number;
}

function visitorId(): string {
  let id = localStorage.getItem('visitorId');
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('visitorId', id);
  }
  return id;
}

/** Small live counter of server activity, pinned in the top-right corner. */
export function LiveStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (!isBackendEnabled()) {
        if (!cancelled) setStats(null);
        return;
      }
      try {
        // Summed across every backend in use: jobs add up exactly, and
        // users are unioned by visitor id so one person polling both
        // backends is counted once. Null when no backend answers, so the
        // pill hides instead of showing stale numbers.
        const combined = await fetchCombinedStats(visitorId(), window.location.origin);
        if (!combined) throw new Error('stats failed');
        if (!cancelled) {
          // In development/preview, we show combined global stats (matching production).
          // On the production domain, we show exactly what the server says.
          setStats({
            activeJobs: Math.max(combined.activeJobs ?? 0, 0),
            activeUsers: Math.max(combined.activeUsers ?? 0, 1)
          });
        }
      } catch {
        if (!cancelled) setStats(null);
      }
    };

    let timer: number;
    // Delay initial poll by 3s so it never competes with critical page render resources on mobile
    const initialTimeout = window.setTimeout(() => {
      poll();
      timer = window.setInterval(poll, 30_000);
    }, 3000);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimeout);
      if (timer) window.clearInterval(timer);
    };
  }, []);

  if (!stats) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur md:gap-3 md:px-3 md:py-1.5">
      {/* Conversions running — icon + number on phones, full "N active" on desktop. */}
      <span className="flex items-center gap-1.5" title="Conversions running right now">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium text-foreground">{stats.activeJobs}</span>
        <span className="hidden md:inline"> active</span>
      </span>
      <span className="h-3 w-px bg-border" />
      {/* People online — icon + number on phones, full "M online" on desktop. */}
      <span className="flex items-center gap-1.5" title="People using the app right now">
        <Users className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium text-foreground">{stats.activeUsers}</span>
        <span className="hidden md:inline"> online</span>
      </span>
    </div>
  );
}

export default LiveStats;
