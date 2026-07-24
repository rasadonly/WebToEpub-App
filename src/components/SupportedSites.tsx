import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ExternalLink, Globe } from 'lucide-react';
import { engineListSupportedHosts } from '@/utils/webtoepub/bridge';

export function SupportedSites({ open, onOpenChange, hideTrigger }: { open?: boolean; onOpenChange?: (o: boolean) => void; hideTrigger?: boolean } = {}) {
  const [hosts, setHosts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const isOpen = open ?? opened;
    if (!isOpen || hosts.length > 0) return;
    setLoading(true);
    engineListSupportedHosts()
      .then(list => setHosts(list.sort()))
      .catch(() => setHosts([]))
      .finally(() => setLoading(false));
  }, [open, opened, hosts.length]);

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

      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Supported Novel Websites{hosts.length ? ` (${hosts.length} sites)` : ''}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground">Loading the engine…</p>
        )}

        {!loading && hosts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Site list will appear here after the engine loads. Try again in a moment.
          </p>
        )}

        {hosts.length > 0 && (
          <div className="grid gap-2 md:grid-cols-3">
            {hosts.map(host => (
              <Card key={host} className="border-border/60">
                <CardHeader className="p-3 pb-1">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    {host}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-1 text-xs"
                    onClick={() => window.open(`https://${host}`, '_blank')}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Visit
                  </Button>
                </CardContent>
              </Card>
            ))}
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
