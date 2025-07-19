import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { SUPPORTED_SITES, getSiteConfig, extractDomain } from '@/utils/siteConfigs';
import { NovelSite, EpubMetadata } from '@/types';
import { BookOpen, Globe, Settings } from 'lucide-react';
import { AdminPanel } from './AdminPanel';
import { TextCleaner } from './TextCleaner';
import { SupportedSites } from './SupportedSites';

interface ConversionFormProps {
  onSubmit: (data: ConversionFormData) => void;
  isConverting: boolean;
}

export interface ConversionFormData {
  tocUrl: string;
  tocSelector: string;
  contentSelector: string;
  metadata: EpubMetadata;
  textCleaners: Array<{
    id: string;
    name: string;
    pattern: string;
    replacement: string;
    isGlobal: boolean;
  }>;
}

export default function ConversionForm({ onSubmit, isConverting }: ConversionFormProps) {
  const { toast } = useToast();
  const [tocUrl, setTocUrl] = useState('');
  const [tocSelector, setTocSelector] = useState('');
  const [contentSelector, setContentSelector] = useState('');
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [textCleaners, setTextCleaners] = useState<Array<{
    id: string;
    name: string;
    pattern: string;
    replacement: string;
    isGlobal: boolean;
  }>>([]);
  const [metadata, setMetadata] = useState<EpubMetadata>({
    title: '',
    author: 'Unknown Author',
    language: 'en',
    description: ''
  });

  // Load saved settings from localStorage
  useEffect(() => {
    const domain = extractDomain(tocUrl);
    if (domain) {
      const saved = localStorage.getItem(`epub-converter-${domain}`);
      if (saved) {
        const config = JSON.parse(saved);
        setTocSelector(config.tocSelector || '');
        setContentSelector(config.contentSelector || '');
      }
    }
  }, [tocUrl]);

  // Auto-detect site and apply config
  useEffect(() => {
    if (tocUrl) {
      const config = getSiteConfig(tocUrl);
      if (config) {
        setSelectedSite(config.name);
        setTocSelector(config.tocSelector);
        setContentSelector(config.contentSelector);
        
        // Extract title from URL if possible
        const urlTitle = extractTitleFromUrl(tocUrl);
        if (urlTitle && !metadata.title) {
          setMetadata(prev => ({ ...prev, title: urlTitle }));
        }
      }
    }
  }, [tocUrl]);

  const handleSiteSelect = (siteName: string) => {
    const site = SUPPORTED_SITES.find(s => s.name === siteName);
    if (site) {
      setSelectedSite(siteName);
      setTocSelector(site.tocSelector);
      setContentSelector(site.contentSelector);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tocUrl || !tocSelector || !contentSelector || !metadata.title) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive"
      });
      return;
    }

    // Save settings to localStorage
    const domain = extractDomain(tocUrl);
    if (domain) {
      localStorage.setItem(`epub-converter-${domain}`, JSON.stringify({
        tocSelector,
        contentSelector
      }));
    }

    onSubmit({
      tocUrl,
      tocSelector,
      contentSelector,
      metadata,
      textCleaners
    });
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Control Buttons */}
      <div className="flex flex-wrap gap-2 justify-center">
        <SupportedSites />
        <TextCleaner onCleanersChange={setTextCleaners} />
        <AdminPanel />
      </div>
      
      <Card className="p-6 bg-gradient-card shadow-card border-0">
        <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-primary">
            <BookOpen className="w-8 h-8" />
            <h1 className="text-2xl font-bold">Web2EPUB Converter</h1>
          </div>
          <p className="text-muted-foreground">
            Convert web novels into beautiful EPUB files
          </p>
        </div>

        {/* Site Selection */}
        <div className="space-y-2">
          <Label htmlFor="site-select" className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Supported Sites (Optional)
          </Label>
          <Select value={selectedSite} onValueChange={handleSiteSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Select a site for auto-configuration" />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_SITES.map(site => (
                <SelectItem key={site.domain} value={site.name}>
                  {site.name} ({site.domain})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* TOC URL */}
        <div className="space-y-2">
          <Label htmlFor="toc-url">Table of Contents URL *</Label>
          <Input
            id="toc-url"
            type="url"
            value={tocUrl}
            onChange={(e) => setTocUrl(e.target.value)}
            placeholder="https://example.com/novel/table-of-contents"
            required
            className="transition-smooth focus:shadow-glow"
          />
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="toc-selector" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Chapter Links Selector *
            </Label>
            <Input
              id="toc-selector"
              value={tocSelector}
              onChange={(e) => setTocSelector(e.target.value)}
              placeholder="a[href*='chapter']"
              required
              className="transition-smooth focus:shadow-glow"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-selector">Chapter Content Selector *</Label>
            <Input
              id="content-selector"
              value={contentSelector}
              onChange={(e) => setContentSelector(e.target.value)}
              placeholder=".chapter-content"
              required
              className="transition-smooth focus:shadow-glow"
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Book Metadata
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={metadata.title}
                onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Novel Title"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author">Author</Label>
              <Input
                id="author"
                value={metadata.author}
                onChange={(e) => setMetadata(prev => ({ ...prev, author: e.target.value }))}
                placeholder="Author Name"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={metadata.description}
              onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Brief description of the novel..."
              rows={3}
            />
          </div>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={isConverting}
          className="w-full bg-gradient-primary hover:shadow-glow transition-smooth text-lg py-6"
        >
          {isConverting ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Converting...
            </div>
          ) : (
            'Convert to EPUB'
          )}
        </Button>
        </form>
      </Card>
    </div>
  );
}

function extractTitleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    
    // Clean up the segment
    return lastSegment
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}