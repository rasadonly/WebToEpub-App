import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ExternalLink, Globe, Loader2, RefreshCw } from 'lucide-react';
import { engineListSupportedHosts } from '@/utils/webtoepub/bridge';
import {
  SiteHealth,
  SiteStatus,
  STATUS_RANK,
  checkSites,
  loadCache,
  saveCache,
  loadRemoteHealth,
  saveRemoteHealth,
  resetDownHostsCache,
} from '@/utils/siteHealth';

const STATUS_LABEL: Record<SiteStatus, string> = {
  up: 'Up',
  parked: 'Parked',
  down: 'Down',
  unknown: 'Unchecked',
};

function StatusDot({ status }: { status: SiteStatus }) {
  const color =
    status === 'up'
      ? 'bg-green-500'
      : status === 'parked'
        ? 'bg-amber-500'
        : status === 'down'
          ? 'bg-destructive'
          : 'bg-muted-foreground/40';
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${color}`} />;
}

export function SupportedSites({ open, onOpenChange, hideTrigger }: { open?: boolean; onOpenChange?: (o: boolean) => void; hideTrigger?: boolean } = {}) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);
  const [health, setHealth] = useState<Record<string, SiteHealth>>(() => loadCache());
  const [checking, setChecking] = useState(false);
  const [checkedCount, setCheckedCount] = useState(0);
  const stopRef = useRef(false);

  const isOpen = open ?? opened;

  useEffect(() => {
    if (!isOpen || hosts.length > 0) return;
    setLoading(true);
    engineListSupportedHosts()
      .then(list => setHosts(list.sort()))
      .catch(() => setHosts([]))
      .finally(() => setLoading(false));
  }, [isOpen, hosts.length]);

  // Stop any in-flight scan when the dialog closes.
  useEffect(() => {
    if (!isOpen) stopRef.current = true;
  }, [isOpen]);

  const statusOf = (host: string): SiteStatus => health[host]?.status ?? 'unknown';

  const sorted = useMemo(() => {
    return [...hosts].sort((a, b) => {
      const d = STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)];
      return d !== 0 ? d : a.localeCompare(b);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, health]);

  const counts = useMemo(() => {
    const c = { up: 0, parked: 0, down: 0, unknown: 0 } as Record<SiteStatus, number>;
    hosts.forEach(h => { c[statusOf(h)]++; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosts, health]);

  const runCheck = async (onlyUnchecked: boolean) => {
    if (checking) { stopRef.current = true; return; }
    const targets = onlyUnchecked ? hosts.filter(h => !health[h]) : hosts;
    if (targets.length === 0) return;
    stopRef.current = false;
    setChecking(true);
    setCheckedCount(0);
    const next: Record<string, SiteHealth> = { ...health };
    await checkSites(
      targets,
      (result) => {
        next[result.host] = result;
        setHealth({ ...next });
        setCheckedCount(n => n + 1);
      },
      8,
      () => stopRef.current
    );
    saveCache(next);
    setChecking(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpened(o); onOpenChange?.(o); }}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Globe className="mr-2 h-4 w-4" />
            Supported Sites
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-none w-screen h-[100dvh] sm:rounded-none p-4 sm:p-6 overflow-y-auto" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <DialogHeader>
          <DialogTitle>
            Supported Novel Websites{hosts.length ? ` (${hosts.length} sites)` : ''}
          </DialogTitle>
        </DialogHeader>

        {hosts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusDot status="up" /> Up {counts.up}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusDot status="parked" /> Parked/fake {counts.parked}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusDot status="down" /> Down {counts.down}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusDot status="unknown" /> Unchecked {counts.unknown}</span>

            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={() => runCheck(true)}>
                {checking ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                {checking ? `Checking… ${checkedCount} (tap to stop)` : 'Check status'}
              </Button>
              {!checking && counts.unknown === 0 && (
                <Button size="sm" variant="ghost" onClick={() => runCheck(false)}>Recheck all</Button>
              )}
            </div>
          </div>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground">Loading the engine…</p>
        )}

        {!loading && hosts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Site list will appear here after the engine loads. Try again in a moment.
          </p>
        )}

        {hosts.length > 0 && (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            {sorted.map(host => {
              const status = statusOf(host);
              return (
                <Card key={host} className={`border-border/60 ${status === 'down' || status === 'parked' ? 'opacity-70' : ''}`}>
                  <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <StatusDot status={status} />
                      <span className="truncate">{host}</span>
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">
                        {STATUS_LABEL[status]}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-1 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-1 text-xs"
                      onClick={() => window.open(`https://${host}`, '_blank')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Visit
                    </Button>
                    {health[host]?.note && (
                      <span className="text-[10px] text-muted-foreground truncate">{health[host].note}</span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h3 className="font-medium mb-2">How to use:</h3>
          <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
            <li>Visit any of the supported sites above</li>
            <li>Find a novel you want to convert</li>
            <li>Copy the novel's main page URL (not individual chapters)</li>
            <li>Paste the URL in the conversion form</li>
            <li>Click "Fetch Chapters" and then "Generate EPUB"</li>
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
