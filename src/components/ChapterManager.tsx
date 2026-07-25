import { useMemo, useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ChapterItem } from '@/hooks/useEpubConverter';
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  FlipVertical,
  CheckSquare,
  Square,
  ListFilter,
  BookOpen,
  Loader2,
} from 'lucide-react';

interface ChapterManagerProps {
  chapters: ChapterItem[];
  onChange: (chapters: ChapterItem[]) => void;
  onGenerate: (selected: ChapterItem[]) => void;
  isGenerating: boolean;
  /** True while chapters are still streaming in from the TOC fetch. */
  isStreaming?: boolean;
}

export default function ChapterManager({
  chapters,
  onChange,
  onGenerate,
  isGenerating,
  isStreaming = false,
}: ChapterManagerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(chapters.map(c => c.id))
  );
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(chapters.length);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldFollowStreamRef = useRef(true);

  const isNearBottom = (el: HTMLDivElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < 80;

  const handleListScroll = () => {
    const el = listRef.current;
    if (!el || !isStreaming) return;
    shouldFollowStreamRef.current = isNearBottom(el);
  };

  // Follow newly streamed chapters only while the user is already at the bottom.
  // If they scroll upward to review chapters, don't force them back down.
  useEffect(() => {
    const el = listRef.current;
    if (isStreaming && el && shouldFollowStreamRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [chapters.length, isStreaming]);

  useEffect(() => {
    if (!isStreaming) shouldFollowStreamRef.current = true;
  }, [isStreaming]);

  // Keep newly streamed chapters selected by default.
  useEffect(() => {
    setSelected(prev => {
      const next = new Set(prev);
      chapters.forEach(c => { if (!next.has(c.id)) next.add(c.id); });
      return next;
    });
  }, [chapters]);

  // Keep selected in sync when chapters change externally
  const syncSelected = (next: ChapterItem[], keep: Set<string>) => {
    const ids = new Set(next.map(c => c.id));
    const filtered = new Set<string>();
    keep.forEach(id => ids.has(id) && filtered.add(id));
    return filtered;
  };

  const update = (next: ChapterItem[], nextSel?: Set<string>) => {
    const sel = nextSel ?? syncSelected(next, selected);
    setSelected(sel);
    onChange(next);
    if (rangeEnd > next.length) setRangeEnd(next.length);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(chapters.map(c => c.id)));
  const selectNone = () => setSelected(new Set());
  const invertSelection = () => {
    const next = new Set<string>();
    chapters.forEach(c => !selected.has(c.id) && next.add(c.id));
    setSelected(next);
  };

  const applyRange = () => {
    const s = Math.max(1, Math.min(rangeStart, chapters.length));
    const e = Math.max(s, Math.min(rangeEnd, chapters.length));
    const next = new Set<string>();
    chapters.slice(s - 1, e).forEach(c => next.add(c.id));
    setSelected(next);
  };

  const deleteChapter = (id: string) => {
    update(chapters.filter(c => c.id !== id));
  };

  const deleteUnselected = () => {
    update(chapters.filter(c => selected.has(c.id)));
  };

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = chapters.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    update(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= chapters.length - 1) return;
    const next = chapters.slice();
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    update(next);
  };

  const reverseAll = () => {
    update(chapters.slice().reverse());
  };

  const selectedList = useMemo(
    () => chapters.filter(c => selected.has(c.id)),
    [chapters, selected]
  );

  return (
    <Card className="w-full max-w-2xl mx-auto p-4 sm:p-6 bg-gradient-card shadow-card border-0 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Chapters ({selectedList.length}/{chapters.length} selected)
            {isStreaming && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary animate-pulse">
                <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                fetching…
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isStreaming
              ? 'Chapters are loading live — more may still appear below.'
              : 'Reorder, remove or reverse before generating.'}
          </p>
        </div>
        <Button
          onClick={() => onGenerate(selectedList)}
          disabled={isGenerating || isStreaming || selectedList.length === 0}
          className="bg-gradient-primary hover:shadow-glow transition-smooth"
        >
          {isGenerating ? (
            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating…</>
          ) : isStreaming ? (
            <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Fetching chapters…</>
          ) : (
            `Generate EPUB (${selectedList.length})`
          )}
        </Button>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={selectAll}>
          <CheckSquare className="w-4 h-4 mr-1" /> All
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={selectNone}>
          <Square className="w-4 h-4 mr-1" /> None
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={invertSelection}>
          Invert
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={reverseAll}>
          <FlipVertical className="w-4 h-4 mr-1" /> Reverse order
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={deleteUnselected}
          disabled={selected.size === chapters.length}
        >
          <Trash2 className="w-4 h-4 mr-1" /> Remove unselected
        </Button>
      </div>

      {/* Range apply */}
      <div className="flex flex-wrap items-end gap-2 p-3 bg-muted/40 rounded-lg">
        <ListFilter className="w-4 h-4 text-muted-foreground mb-2" />
        <div className="space-y-1">
          <Label htmlFor="range-start" className="text-xs">From</Label>
          <Input
            id="range-start"
            type="number"
            min={1}
            max={chapters.length}
            value={rangeStart}
            onChange={e => setRangeStart(parseInt(e.target.value) || 1)}
            className="w-24 h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="range-end" className="text-xs">To</Label>
          <Input
            id="range-end"
            type="number"
            min={1}
            max={chapters.length}
            value={rangeEnd}
            onChange={e => setRangeEnd(parseInt(e.target.value) || chapters.length)}
            className="w-24 h-8"
          />
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={applyRange}>
          Select range
        </Button>
      </div>

      {/* List */}
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="max-h-[420px] overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40"
      >
        {chapters.map((c, idx) => {
          const isSelected = selected.has(c.id);
          return (
            <div
              key={c.id}
              className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200 ${
                isSelected ? 'bg-background' : 'bg-muted/30 opacity-60'
              }`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggle(c.id)}
                aria-label={`Select chapter ${idx + 1}`}
              />
              <span className="w-10 text-xs text-muted-foreground tabular-nums">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{c.title}</div>
                <div className="truncate text-xs text-muted-foreground">{c.url}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  aria-label="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => moveDown(idx)}
                  disabled={idx === chapters.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => deleteChapter(c.id)}
                  aria-label="Delete chapter"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
