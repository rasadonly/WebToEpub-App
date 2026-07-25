import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Settings, Plus, Edit, Save, Trash2 } from 'lucide-react';
import { NovelSite } from '@/types';
import { SUPPORTED_SITES } from '@/utils/siteConfigs';
import { useToast } from '@/hooks/use-toast';

export function AdminPanel({ open, onOpenChange, hideTrigger }: { open?: boolean; onOpenChange?: (o: boolean) => void; hideTrigger?: boolean } = {}) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [sites, setSites] = useState<NovelSite[]>(SUPPORTED_SITES);
  const [editingSite, setEditingSite] = useState<NovelSite | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const saved = localStorage.getItem('customSites');
    if (saved) {
      setSites(JSON.parse(saved));
    }
  }, []);

  const handleLogin = () => {
    if (password === 'prasadonly') {
      setIsAuthenticated(true);
      setPassword('');
      toast({ title: "Admin access granted" });
    } else {
      toast({ title: "Invalid password", variant: "destructive" });
    }
  };

  const saveSites = (newSites: NovelSite[]) => {
    setSites(newSites);
    localStorage.setItem('customSites', JSON.stringify(newSites));
    // Update the global config
    (window as any).customSiteConfigs = newSites;
    toast({ title: "Sites updated successfully" });
  };

  const handleSaveSite = (site: NovelSite) => {
    if (isAddingNew) {
      saveSites([...sites, site]);
    } else {
      saveSites(sites.map(s => s.domain === editingSite?.domain ? site : s));
    }
    setEditingSite(null);
    setIsAddingNew(false);
  };

  const handleDeleteSite = (domain: string) => {
    saveSites(sites.filter(s => s.domain !== domain));
  };

  const SiteForm = ({ site, onSave }: { site?: NovelSite; onSave: (site: NovelSite) => void }) => {
    const [formData, setFormData] = useState(site || {
      name: '',
      domain: '',
      tocSelector: '',
      contentSelector: '',
      titleSelector: '',
      removeSelectors: []
    });

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      onSave({
        ...formData,
        removeSelectors: formData.removeSelectors
      });
    };

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Site Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
        </div>
        <div>
          <Label htmlFor="domain">Domain</Label>
          <Input
            id="domain"
            value={formData.domain}
            onChange={(e) => setFormData({...formData, domain: e.target.value})}
            placeholder="example.com"
            required
          />
        </div>
        <div>
          <Label htmlFor="tocSelector">TOC Selector</Label>
          <Input
            id="tocSelector"
            value={formData.tocSelector}
            onChange={(e) => setFormData({...formData, tocSelector: e.target.value})}
            placeholder=".chapter-list a"
            required
          />
        </div>
        <div>
          <Label htmlFor="contentSelector">Content Selector</Label>
          <Input
            id="contentSelector"
            value={formData.contentSelector}
            onChange={(e) => setFormData({...formData, contentSelector: e.target.value})}
            placeholder=".chapter-content"
            required
          />
        </div>
        <div>
          <Label htmlFor="titleSelector">Title Selector</Label>
          <Input
            id="titleSelector"
            value={formData.titleSelector}
            onChange={(e) => setFormData({...formData, titleSelector: e.target.value})}
            placeholder="h1"
            required
          />
        </div>
        <div>
          <Label htmlFor="removeSelectors">Remove Selectors (comma separated)</Label>
          <Textarea
            id="removeSelectors"
            value={Array.isArray(formData.removeSelectors) ? formData.removeSelectors.join(', ') : ''}
            onChange={(e) => setFormData({
              ...formData, 
              removeSelectors: e.target.value.split(',').map(s => s.trim()).filter(s => s)
            })}
            placeholder=".ads, .advertisement, script, style"
          />
        </div>
        <Button type="submit" className="w-full">
          <Save className="mr-2 h-4 w-4" />
          Save Site
        </Button>
      </form>
    );
  };

  if (!isAuthenticated) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {!hideTrigger && (
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Admin
            </Button>
          </DialogTrigger>
        )}

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin Access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="adminPassword">Password</Label>
              <Input
                id="adminPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            <Button onClick={handleLogin} className="w-full">
              Login
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Admin Panel
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-4xl w-[calc(100vw-1rem)] max-h-[90dvh] sm:max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Site Configuration Management</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <Button
            onClick={() => setIsAddingNew(true)}
            className="w-full"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add New Site
          </Button>

          <div className="grid gap-4">
            {sites.map((site) => (
              <Card key={site.domain}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex justify-between items-center">
                    {site.name} ({site.domain})
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingSite(site)}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteSite(site.domain)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <div>TOC: {site.tocSelector}</div>
                  <div>Content: {site.contentSelector}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {(editingSite || isAddingNew) && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {isAddingNew ? 'Add New Site' : `Edit ${editingSite?.name}`}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SiteForm
                  site={editingSite || undefined}
                  onSave={handleSaveSite}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}