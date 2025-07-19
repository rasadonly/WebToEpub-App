import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Eraser, Plus, X, Save, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface TextCleaner {
  id: string;
  name: string;
  pattern: string;
  replacement: string;
  isGlobal: boolean;
  author?: string;
}

interface TextCleanerProps {
  onCleanersChange: (cleaners: TextCleaner[]) => void;
}

export function TextCleaner({ onCleanersChange }: TextCleanerProps) {
  const [cleaners, setCleaners] = useState<TextCleaner[]>([]);
  const [globalCleaners, setGlobalCleaners] = useState<TextCleaner[]>([]);
  const [newCleaner, setNewCleaner] = useState({
    name: '',
    pattern: '',
    replacement: ''
  });
  const { toast } = useToast();

  useEffect(() => {
    // Load user's personal cleaners
    const saved = localStorage.getItem('textCleaners');
    if (saved) {
      setCleaners(JSON.parse(saved));
    }

    // Load global community cleaners
    const savedGlobal = localStorage.getItem('globalTextCleaners');
    if (savedGlobal) {
      setGlobalCleaners(JSON.parse(savedGlobal));
    } else {
      // Initialize with some default community cleaners
      const defaultGlobal: TextCleaner[] = [
        {
          id: 'default-1',
          name: 'Remove "Previous Chapter" text',
          pattern: 'Previous Chapter|Next Chapter',
          replacement: '',
          isGlobal: true,
          author: 'System'
        },
        {
          id: 'default-2',
          name: 'Clean chapter navigation',
          pattern: '<<\\s*Previous|Next\\s*>>',
          replacement: '',
          isGlobal: true,
          author: 'System'
        },
        {
          id: 'default-3',
          name: 'Remove donation links',
          pattern: 'Support the author|Donate|Patreon|Ko-fi',
          replacement: '',
          isGlobal: true,
          author: 'System'
        }
      ];
      setGlobalCleaners(defaultGlobal);
      localStorage.setItem('globalTextCleaners', JSON.stringify(defaultGlobal));
    }
  }, []);

  useEffect(() => {
    const allCleaners = [...cleaners, ...globalCleaners];
    onCleanersChange(allCleaners);
  }, [cleaners, globalCleaners, onCleanersChange]);

  const saveCleaners = (newCleaners: TextCleaner[]) => {
    setCleaners(newCleaners);
    localStorage.setItem('textCleaners', JSON.stringify(newCleaners));
  };

  const saveGlobalCleaners = (newGlobalCleaners: TextCleaner[]) => {
    setGlobalCleaners(newGlobalCleaners);
    localStorage.setItem('globalTextCleaners', JSON.stringify(newGlobalCleaners));
  };

  const addCleaner = () => {
    if (!newCleaner.name || !newCleaner.pattern) {
      toast({ title: "Name and pattern are required", variant: "destructive" });
      return;
    }

    const cleaner: TextCleaner = {
      id: Date.now().toString(),
      name: newCleaner.name,
      pattern: newCleaner.pattern,
      replacement: newCleaner.replacement,
      isGlobal: false
    };

    saveCleaners([...cleaners, cleaner]);
    setNewCleaner({ name: '', pattern: '', replacement: '' });
    toast({ title: "Text cleaner added" });
  };

  const removeCleaner = (id: string) => {
    saveCleaners(cleaners.filter(c => c.id !== id));
    toast({ title: "Text cleaner removed" });
  };

  const shareToGlobal = (cleaner: TextCleaner) => {
    const globalCleaner = {
      ...cleaner,
      id: `global-${Date.now()}`,
      isGlobal: true,
      author: 'Community'
    };

    saveGlobalCleaners([...globalCleaners, globalCleaner]);
    toast({ title: "Shared with community!", description: "Other users can now use your text cleaner" });
  };

  const removeGlobalCleaner = (id: string) => {
    saveGlobalCleaners(globalCleaners.filter(c => c.id !== id));
    toast({ title: "Global cleaner removed" });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Eraser className="mr-2 h-4 w-4" />
          Text Cleaners ({cleaners.length + globalCleaners.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Text Cleaners - Remove unwanted text patterns</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add New Cleaner */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Add New Text Cleaner</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="cleanerName">Name</Label>
                <Input
                  id="cleanerName"
                  value={newCleaner.name}
                  onChange={(e) => setNewCleaner({...newCleaner, name: e.target.value})}
                  placeholder="e.g., Remove ads text"
                />
              </div>
              <div>
                <Label htmlFor="cleanerPattern">Pattern (Regex supported)</Label>
                <Input
                  id="cleanerPattern"
                  value={newCleaner.pattern}
                  onChange={(e) => setNewCleaner({...newCleaner, pattern: e.target.value})}
                  placeholder="e.g., Advertisement|AD_PLACEHOLDER"
                />
              </div>
              <div>
                <Label htmlFor="cleanerReplacement">Replacement (leave empty to remove)</Label>
                <Input
                  id="cleanerReplacement"
                  value={newCleaner.replacement}
                  onChange={(e) => setNewCleaner({...newCleaner, replacement: e.target.value})}
                  placeholder="Optional replacement text"
                />
              </div>
              <Button onClick={addCleaner} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Add Cleaner
              </Button>
            </CardContent>
          </Card>

          {/* Personal Cleaners */}
          {cleaners.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Your Personal Cleaners</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cleaners.map((cleaner) => (
                  <div key={cleaner.id} className="flex items-center justify-between p-3 border rounded">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{cleaner.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Pattern: <code className="bg-muted px-1 rounded">{cleaner.pattern}</code>
                        {cleaner.replacement && (
                          <span> → Replace with: <code className="bg-muted px-1 rounded">{cleaner.replacement}</code></span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => shareToGlobal(cleaner)}
                        title="Share with community"
                      >
                        <Users className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeCleaner(cleaner.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Community Cleaners */}
          {globalCleaners.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Community Cleaners
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {globalCleaners.map((cleaner) => (
                  <div key={cleaner.id} className="flex items-center justify-between p-3 border rounded bg-muted/30">
                    <div className="flex-1">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {cleaner.name}
                        <Badge variant="secondary" className="text-xs">
                          {cleaner.author}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pattern: <code className="bg-muted px-1 rounded">{cleaner.pattern}</code>
                        {cleaner.replacement && (
                          <span> → Replace with: <code className="bg-muted px-1 rounded">{cleaner.replacement}</code></span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeGlobalCleaner(cleaner.id)}
                      title="Remove from your list"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}