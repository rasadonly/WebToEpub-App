import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ExternalLink, Globe } from 'lucide-react';

const siteExamples = [
  {
    name: 'Novelhall',
    domain: 'novelhall.com',
    examples: [
      'https://www.novelhall.com/Against-the-Gods-0',
      'https://www.novelhall.com/Martial-God-Asura-0'
    ]
  },
  {
    name: 'Novelfull',
    domain: 'novelfull.com',
    examples: [
      'https://novelfull.com/against-the-gods.html',
      'https://novelfull.com/martial-god-asura.html'
    ]
  },
  {
    name: 'NovelBin',
    domain: 'novelbin.com',
    examples: [
      'https://novelbin.com/b/against-the-gods-novel',
      'https://novelbin.com/b/martial-god-asura'
    ]
  },
  {
    name: 'NovelBin ME',
    domain: 'novelbin.me',
    examples: [
      'https://novelbin.me/b/against-the-gods-novel',
      'https://novelbin.me/b/martial-god-asura'
    ]
  },
  {
    name: 'NovGo',
    domain: 'novgo.me',
    examples: [
      'https://novgo.me/novel/against-the-gods',
      'https://novgo.me/novel/martial-god-asura'
    ]
  },
  {
    name: 'WTR-LAB',
    domain: 'wtr-lab.com',
    examples: [
      'https://wtr-lab.com/en/series/against-the-gods',
      'https://wtr-lab.com/en/series/martial-god-asura'
    ]
  }
];

export function SupportedSites() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Globe className="mr-2 h-4 w-4" />
          Supported Sites
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Supported Novel Websites</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {siteExamples.map((site) => (
            <Card key={site.domain}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" />
                  {site.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">{site.domain}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm font-medium">Example novels:</p>
                {site.examples.map((url, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto p-2 justify-start text-left"
                      onClick={() => window.open(url, '_blank')}
                    >
                      <ExternalLink className="mr-2 h-3 w-3 flex-shrink-0" />
                      <span className="text-xs truncate">
                        {url.replace('https://', '').replace('www.', '')}
                      </span>
                    </Button>
                  </div>
                ))}
                <div className="pt-2 text-xs text-muted-foreground">
                  Click any link to visit the site and find novels to convert
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 p-4 bg-muted rounded-lg">
          <h3 className="font-medium mb-2">How to use:</h3>
          <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
            <li>Visit any of the supported sites above</li>
            <li>Find a novel you want to convert</li>
            <li>Copy the novel's main page URL (not individual chapters)</li>
            <li>Paste the URL in the conversion form</li>
            <li>Click "Convert to EPUB" and wait for the process to complete</li>
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}