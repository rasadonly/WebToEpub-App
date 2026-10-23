import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getBackendUrl } from '@/utils/backend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  X,
  ArrowLeft,
  Loader2,
  MessageSquare,
  Send,
  Pin,
  Bug,
  Globe,
  MessagesSquare,
  Pencil,
  Trash2,
  ShieldCheck,
  Search,
  User,
  Plus,
  Clock,
  Filter,
  Info,
  BookMarked,
  BookUp,
  CheckCircle2,
  Upload,
  Trophy,
  Check,
  BookmarkPlus,
} from 'lucide-react';

interface ForumModalProps {
  open: boolean;
  onClose: () => void;
  /** Deep-link entry point: open straight into a view (e.g. from /rankings). */
  initialView?: 'list' | 'rankings';
  /** Deep-link entry point: preselect a category filter (e.g. book_request from /requests). */
  initialCategory?: Category;
}

type Category = 'report_error' | 'new_site' | 'general' | 'book_request';

interface Thread {
  id: string;
  title: string;
  body: string;
  category: Category;
  author_name: string;
  avatar_url: string | null;
  is_pinned: boolean;
  comment_count: number;
  created_at: string;
  updated_at: string;
  upvotes?: number;
}

interface Comment {
  id: string;
  thread_id: string;
  body: string;
  author_name: string;
  avatar_url: string | null;
  created_at: string;
  upvotes?: number;
}

const CATEGORY_META: Record<Category, { label: string; icon: any; bg: string; color: string; border: string }> = {
  report_error: { label: 'Site Error', icon: Bug, bg: 'bg-red-500/10 dark:bg-red-500/20', color: 'text-red-600 dark:text-red-400', border: 'border-red-500/20' },
  new_site: { label: 'New Site Request', icon: Globe, bg: 'bg-blue-500/10 dark:bg-blue-500/20', color: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20' },
  general: { label: 'General Chat', icon: MessagesSquare, bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', color: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  book_request: { label: 'Book Request', icon: BookMarked, bg: 'bg-violet-500/10 dark:bg-violet-500/20', color: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/20' },
};

/* Book-request sharing: when a reader uploads the requested EPUB, the share
   flow posts a marker comment in the request thread. The first marker wins —
   it tells both the list and the thread that the request was fulfilled, and
   who to thank. */
const SHARE_MARKER = '📚 SHARED';
interface ShareInfo {
  by: string;
  at: string;
}
function shareFromComment(c: { body: string; author_name: string; created_at: string }): ShareInfo | null {
  if (!c.body || !c.body.startsWith(SHARE_MARKER)) return null;
  return { by: c.author_name, at: c.created_at };
}

/* Top Rankings: novels the community ranks by marking them Read / Will Read. */
interface RankedNovel {
  id: string;
  title: string;
  author: string | null;
  category: string;
  added_by: string;
  created_at: string;
}
interface NovelMark {
  novel_id: string;
  user_name: string;
  mark: 'read' | 'will_read';
}

/* Rankings are split by GENRE (Xianxia, Wuxia, …), not by origin/language. */
const GENRE_SUGGESTIONS = [
  'Xianxia',
  'Xuanhuan',
  'Wuxia',
  'Fantasy',
  'Modern Fantasy',
  'Sci-Fi',
  'Game / LitRPG',
  'Kingdom Building',
  'Time Loop',
  'Apocalypse',
  'Supernatural',
  'Superhero',
  'Comedy',
  'Romance',
  'Horror',
  'Mystery',
];

const TOKENS_KEY = 'forum-edit-tokens';
const PROFILE_KEY = 'forum-profile';

function getTokens(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch { return {}; }
}
function saveToken(id: string, token: string) {
  const t = getTokens();
  t[id] = token;
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
}
function removeToken(id: string) {
  const t = getTokens();
  delete t[id];
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
}
function getProfile(): { name: string; avatar_url: string } {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch { return { name: '', avatar_url: '' }; }
}
function saveProfile(name: string, avatar_url: string) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, avatar_url }));
}
function newToken() { return crypto.randomUUID(); }

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.round(diff / (86400 * 30))}mo ago`;
  return `${Math.round(diff / (86400 * 365))}y ago`;
}

function fullDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Avatar({ name, url, className = "w-8 h-8" }: { name: string; url?: string | null; className?: string }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const hue = (letter.charCodeAt(0) * 37) % 360;
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`${className} rounded-full object-cover bg-muted shrink-0 shadow-2xs border border-border/50`}
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
    );
  }
  return (
    <div
      className={`${className} rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-2xs border border-white/20`}
      style={{ background: `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue + 40) % 360}, 70%, 40%))` }}
    >
      {letter}
    </div>
  );
}

function ThreadRow({ t, mine, onOpen, share }: { t: Thread; mine: boolean; onOpen: () => void; share?: ShareInfo | null }) {
  const meta = CATEGORY_META[t.category];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
    >
      <span className={`hidden sm:grid w-9 h-9 shrink-0 place-items-center rounded-lg border ${meta.bg} ${meta.border}`}>
        <Icon className={`w-4 h-4 ${meta.color}`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm text-foreground truncate">{t.title}</span>
          {t.is_pinned && <OfficialBadge />}
          {mine && (
            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
              <ShieldCheck className="w-3 h-3" /> You
            </span>
          )}
          {t.category === 'book_request' &&
            (share ? (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" /> Shared by {share.by}
              </span>
            ) : (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                <Clock className="w-3 h-3" /> Waiting for a share
              </span>
            ))}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
          <Avatar name={t.author_name} url={t.avatar_url} className="w-4 h-4" />
          <span className="font-medium truncate">{t.author_name}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{meta.label}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{timeAgo(t.created_at)}</span>
        </span>
      </span>
      <span className="hidden md:flex flex-col items-end gap-0.5 shrink-0 w-32 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
          <MessageSquare className="w-3.5 h-3.5 text-primary" />
          {t.comment_count} {t.comment_count === 1 ? 'reply' : 'replies'}
        </span>
        <span>Last activity {timeAgo(t.updated_at)}</span>
      </span>
      <span className="md:hidden shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        <MessageSquare className="w-3.5 h-3.5 text-primary" />
        {t.comment_count}
      </span>
    </button>
  );
}

/* Official posts are the ones the team pins (pinning requires the admin
   password server-side). Badges never come from a display name — anyone can
   type any name, so a name-based "admin" badge would be trivially fakeable. */
function OfficialBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
      <ShieldCheck className="w-3 h-3" /> Official
    </span>
  );
}

export function ForumModal({ open, onClose, initialView, initialCategory }: ForumModalProps) {
  const { toast } = useToast();
  const [view, setView] = useState<'list' | 'thread' | 'new' | 'rankings'>(
    initialView === 'rankings' ? 'rankings' : 'list'
  );
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [filter, setFilter] = useState<'all' | Category>(initialCategory ?? 'all');
  const [searchQuery, setSearchQuery] = useState('');

  // Profile
  const initialProfile = useMemo(() => getProfile(), []);
  const [authorName, setAuthorName] = useState(initialProfile.name || '');
  const [authorAvatar, setAuthorAvatar] = useState(initialProfile.avatar_url || '');
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('general');
  const [posting, setPosting] = useState(false);
  const [editingThread, setEditingThread] = useState(false);

  // Comment compose
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');

  const [shares, setShares] = useState<Record<string, ShareInfo>>({});

  const loadShares = useCallback(async (list: Thread[]) => {
    const ids = list.filter((t) => t.category === 'book_request').map((t) => t.id);
    if (!ids.length) {
      setShares({});
      return;
    }
    const { data } = await supabase
      .from('forum_comments')
      .select('thread_id,body,author_name,created_at')
      .in('thread_id', ids)
      .order('created_at', { ascending: true });
    const map: Record<string, ShareInfo> = {};
    for (const c of (data as { thread_id: string; body: string; author_name: string; created_at: string }[]) || []) {
      if (map[c.thread_id]) continue;
      const s = shareFromComment(c);
      if (s) map[c.thread_id] = s;
    }
    setShares(map);
  }, []);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('forum_threads')
      .select('id,title,body,category,author_name,avatar_url,is_pinned,comment_count,created_at,updated_at')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast({ title: 'Failed to load forum', description: error.message, variant: 'destructive' });
    else {
      setThreads((data as Thread[]) || []);
      void loadShares((data as Thread[]) || []);
    }
    setLoading(false);
  }, [toast, loadShares]);

  const loadComments = useCallback(
    async (threadId: string) => {
      setLoadingComments(true);
      const { data, error } = await supabase
        .from('forum_comments')
        .select('id,thread_id,body,author_name,avatar_url,created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });
      if (error) toast({ title: 'Failed to load comments', description: error.message, variant: 'destructive' });
      else setComments((data as Comment[]) || []);
      setLoadingComments(false);
    },
    [toast]
  );

  useEffect(() => {
    if (!open) return;
    void loadThreads();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (view === 'list' ? onClose() : setView('list'));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, view, onClose, loadThreads]);

  const openThread = async (t: Thread) => {
    setActiveThread(t);
    setView('thread');
    setEditingThread(false);
    setNewTitle(t.title);
    setNewBody(t.body);
    setNewCategory(t.category);
    setCommentBody('');
    setEditingCommentId(null);
    await loadComments(t.id);
  };

  const isMine = (id: string) => !!getTokens()[id];

  const requireProfile = () => {
    const name = authorName.trim() || 'Reader';
    saveProfile(name, authorAvatar.trim());
    return { name, avatar_url: authorAvatar.trim() || null };
  };

  const promptAdmin = () => {
    const p = window.prompt('Admin password (leave empty to cancel):') || '';
    return p.trim();
  };

  const createThread = async () => {
    if (!newTitle.trim()) {
      toast({ title: 'Title required', variant: 'destructive' });
      return;
    }
    setPosting(true);
    const { name, avatar_url } = requireProfile();
    const token = newToken();
    const { data, error } = await supabase
      .from('forum_threads')
      .insert({
        title: newTitle.trim().slice(0, 200),
        body: newBody.trim().slice(0, 5000),
        category: newCategory,
        author_name: name,
        avatar_url,
        edit_token: token,
      })
      .select()
      .single();
    setPosting(false);
    if (error || !data) {
      toast({ title: 'Failed to post thread', description: error?.message || 'Permission error', variant: 'destructive' });
      return;
    }
    saveToken(data.id, token);
    setNewTitle('');
    setNewBody('');
    setNewCategory('general');
    await loadThreads();
    setView('list');
    toast({ title: 'Thread posted' });
  };

  const saveThreadEdit = async () => {
    if (!activeThread) return;
    const token = getTokens()[activeThread.id];
    const admin = token ? '' : promptAdmin();
    if (!token && !admin) return;
    const { data, error } = await supabase.rpc('update_forum_thread', {
      p_id: activeThread.id,
      p_token: token || '',
      p_title: newTitle.trim().slice(0, 200),
      p_body: newBody.trim().slice(0, 5000),
      p_category: newCategory,
      p_admin: admin || null,
    });
    if (error) {
      toast({ title: 'Edit failed', description: error.message, variant: 'destructive' });
      return;
    }
    const updated = data as unknown as Thread;
    setActiveThread(updated);
    setEditingThread(false);
    await loadThreads();
    toast({ title: 'Thread updated' });
  };

  const deleteThread = async (t: Thread) => {
    if (!confirm(`Delete thread "${t.title}"?`)) return;
    const token = getTokens()[t.id];
    const admin = token ? '' : promptAdmin();
    if (!token && !admin) return;
    const { error } = await supabase.rpc('delete_forum_thread', {
      p_id: t.id,
      p_token: token || '',
      p_admin: admin || null,
    });
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }
    removeToken(t.id);
    if (activeThread?.id === t.id) setView('list');
    await loadThreads();
    toast({ title: 'Thread deleted' });
  };

  const bumpCount = (threadId: string, delta: number) => {
    setActiveThread((prev) =>
      prev && prev.id === threadId
        ? { ...prev, comment_count: Math.max(0, prev.comment_count + delta) }
        : prev
    );
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, comment_count: Math.max(0, t.comment_count + delta) } : t
      )
    );
  };

  const postComment = async () => {
    if (!activeThread || !commentBody.trim()) return;
    setPostingComment(true);
    const { name, avatar_url } = requireProfile();
    const token = newToken();
    const { data, error } = await supabase
      .from('forum_comments')
      .insert({
        thread_id: activeThread.id,
        body: commentBody.trim().slice(0, 3000),
        author_name: name,
        avatar_url,
        edit_token: token,
      })
      .select()
      .single();
    setPostingComment(false);
    if (error || !data) {
      toast({ title: 'Failed to post comment', description: error?.message || 'Error', variant: 'destructive' });
      return;
    }
    saveToken(data.id, token);
    setCommentBody('');
    setComments((prev) => [...prev, data as Comment]);
    bumpCount(activeThread.id, 1);
  };

  // --- Book-request sharing -------------------------------------------------
  const [shareUploading, setShareUploading] = useState(false);
  const shareFileRef = useRef<HTMLInputElement>(null);

  const activeShare = useMemo(() => {
    for (const c of comments) {
      const s = shareFromComment(c);
      if (s) return s;
    }
    return activeThread ? shares[activeThread.id] || null : null;
  }, [comments, shares, activeThread]);

  const handleShareFile = async (file: File) => {
    if (!activeThread) return;
    if (!/\.epub$/i.test(file.name)) {
      toast({ title: 'Please choose an .epub file', variant: 'destructive' });
      return;
    }
    setShareUploading(true);
    const { name, avatar_url } = requireProfile();
    try {
      const resp = await fetch(`${getBackendUrl()}/api/library/share`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/epub+zip',
          'x-book-title': encodeURIComponent(activeThread.title),
          'x-shared-by': encodeURIComponent(name),
        },
        body: file,
      });
      const data = (await resp.json().catch(() => ({}))) as { error?: string };
      if (!resp.ok) throw new Error(data.error || `Upload failed (${resp.status})`);

      const token = newToken();
      const body = `${SHARE_MARKER} by ${name}\n\n\u201C${activeThread.title}\u201D is now in the Community Library \u2014 open the Library and search \u201C${activeThread.title}\u201D to download it.\n\nThank you, ${name}, for sharing with the community! \uD83D\uDE4F`;
      const { data: cData, error } = await supabase
        .from('forum_comments')
        .insert({ thread_id: activeThread.id, body, author_name: name, avatar_url, edit_token: token })
        .select()
        .single();
      if (error || !cData) {
        throw new Error('The EPUB was saved to the library, but posting the thank-you note failed. Please add a comment so we can credit you.');
      }
      saveToken(cData.id, token);
      setComments((prev) => [...prev, cData as Comment]);
      bumpCount(activeThread.id, 1);
      setShares((prev) => ({ ...prev, [activeThread.id]: { by: name, at: new Date().toISOString() } }));
      toast({ title: 'Thank you for sharing! \uD83D\uDE4F', description: 'The EPUB is now in the Community Library.' });
    } catch (e) {
      toast({
        title: 'Share failed',
        description: e instanceof Error ? e.message : 'Upload failed',
        variant: 'destructive',
      });
    }
    setShareUploading(false);
  };

  // --- Top Rankings ---------------------------------------------------------
  const [rankedNovels, setRankedNovels] = useState<RankedNovel[]>([]);
  const [novelMarks, setNovelMarks] = useState<NovelMark[]>([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankCategory, setRankCategory] = useState('All');
  const [newNovelTitle, setNewNovelTitle] = useState('');
  const [newNovelAuthor, setNewNovelAuthor] = useState('');
  const [newNovelCategory, setNewNovelCategory] = useState('Xianxia');
  const [customCategory, setCustomCategory] = useState('');
  const [addingNovel, setAddingNovel] = useState(false);
  const [markBusy, setMarkBusy] = useState<string | null>(null);

  const loadRankings = useCallback(async () => {
    setRankingsLoading(true);
    const [novelsRes, marksRes] = await Promise.all([
      supabase
        .from('ranked_novels')
        .select('id,title,author,category,added_by,created_at')
        .order('created_at', { ascending: true })
        .limit(1000),
      supabase.from('novel_marks').select('novel_id,user_name,mark').limit(10000),
    ]);
    if (novelsRes.error)
      toast({ title: 'Failed to load rankings', description: novelsRes.error.message, variant: 'destructive' });
    else setRankedNovels((novelsRes.data as RankedNovel[]) || []);
    if (!marksRes.error) setNovelMarks((marksRes.data as NovelMark[]) || []);
    setRankingsLoading(false);
  }, [toast]);

  useEffect(() => {
    if (open && view === 'rankings') void loadRankings();
  }, [open, view, loadRankings]);

  const rankStats = useMemo(() => {
    const stats = new Map<string, { read: number; will: number }>();
    for (const m of novelMarks) {
      const s = stats.get(m.novel_id) || { read: 0, will: 0 };
      if (m.mark === 'read') s.read++;
      else s.will++;
      stats.set(m.novel_id, s);
    }
    return stats;
  }, [novelMarks]);

  const myMarks = useMemo(() => {
    const me = authorName.trim().toLowerCase();
    const map = new Map<string, 'read' | 'will_read'>();
    if (me) for (const m of novelMarks) if (m.user_name.toLowerCase() === me) map.set(m.novel_id, m.mark);
    return map;
  }, [novelMarks, authorName]);

  const rankCategories = useMemo(() => {
    const set = new Set<string>();
    for (const n of rankedNovels) if (n.category) set.add(n.category);
    return ['All', ...[...set].sort()];
  }, [rankedNovels]);

  const genreOptions = useMemo(() => {
    const set = new Set<string>(GENRE_SUGGESTIONS);
    for (const n of rankedNovels) if (n.category) set.add(n.category);
    return [...set].sort();
  }, [rankedNovels]);

  const rankedList = useMemo(() => {
    return rankedNovels
      .filter((n) => rankCategory === 'All' || n.category === rankCategory)
      .map((n) => ({ novel: n, ...(rankStats.get(n.id) || { read: 0, will: 0 }) }))
      .sort(
        (a, b) =>
          b.read - a.read ||
          b.will - a.will ||
          (a.novel.created_at < b.novel.created_at ? -1 : 1)
      );
  }, [rankedNovels, rankCategory, rankStats]);

  const getMarkToken = () => {
    let t = '';
    try {
      t = localStorage.getItem('ranking-mark-token') || '';
      if (!t) {
        t = newToken();
        localStorage.setItem('ranking-mark-token', t);
      }
    } catch {
      t = newToken();
    }
    return t;
  };

  const setMark = async (novel: RankedNovel, mark: 'read' | 'will_read' | null) => {
    const { name } = requireProfile();
    setMarkBusy(novel.id);
    if (mark === null) {
      const { data, error } = await supabase.rpc('remove_novel_mark', {
        p_novel_id: novel.id,
        p_user_name: name,
        p_token: getMarkToken(),
      });
      setMarkBusy(null);
      if (error) {
        toast({ title: 'Could not remove your mark', description: error.message, variant: 'destructive' });
        return;
      }
      if (data)
        setNovelMarks((prev) =>
          prev.filter((m) => !(m.novel_id === novel.id && m.user_name.toLowerCase() === name.toLowerCase()))
        );
      return;
    }
    const { data, error } = await supabase.rpc('set_novel_mark', {
      p_novel_id: novel.id,
      p_user_name: name,
      p_mark: mark,
      p_token: getMarkToken(),
    });
    setMarkBusy(null);
    if (error || !data) {
      toast({ title: 'Could not save your mark', description: error?.message || 'Error', variant: 'destructive' });
      return;
    }
    const row = data as unknown as NovelMark;
    if (row.mark !== mark) {
      toast({
        title: 'That name already marked this novel',
        description:
          'Marks are tied to the browser that first used this display name. Use the same browser, or a different display name.',
        variant: 'destructive',
      });
      return;
    }
    setNovelMarks((prev) => [
      ...prev.filter((m) => !(m.novel_id === novel.id && m.user_name.toLowerCase() === name.toLowerCase())),
      row,
    ]);
  };

  const addNovel = async () => {
    const title = newNovelTitle.trim();
    if (!title) {
      toast({ title: 'Novel title required', variant: 'destructive' });
      return;
    }
    const category = (newNovelCategory === '__custom' ? customCategory.trim() : newNovelCategory).slice(0, 40);
    if (!category) {
      toast({ title: 'Category required', variant: 'destructive' });
      return;
    }
    setAddingNovel(true);
    const { name } = requireProfile();
    const { data, error } = await supabase
      .from('ranked_novels')
      .insert({
        title: title.slice(0, 200),
        author: newNovelAuthor.trim().slice(0, 120) || null,
        category,
        added_by: name,
        edit_token: newToken(),
      })
      .select()
      .single();
    setAddingNovel(false);
    if (error || !data) {
      const dup = (error as { code?: string } | null)?.code === '23505';
      toast({
        title: dup ? 'Already on the list' : 'Failed to add novel',
        description: dup
          ? 'That title is already ranked — find it below and add your mark instead.'
          : error?.message || 'Error',
        variant: 'destructive',
      });
      return;
    }
    setRankedNovels((prev) => [...prev, data as RankedNovel]);
    setNewNovelTitle('');
    setNewNovelAuthor('');
    setCustomCategory('');
    setRankCategory(category);
    toast({ title: 'Added to the rankings', description: 'Now mark it Read or Will Read to cast your vote.' });
  };

  const saveCommentEdit = async (c: Comment) => {
    const token = getTokens()[c.id];
    const admin = token ? '' : promptAdmin();
    if (!token && !admin) return;
    const { data, error } = await supabase.rpc('update_forum_comment', {
      p_id: c.id,
      p_token: token || '',
      p_body: editCommentBody.trim().slice(0, 3000),
      p_admin: admin || null,
    });
    if (error) {
      toast({ title: 'Edit failed', description: error.message, variant: 'destructive' });
      return;
    }
    setComments((prev) => prev.map((x) => (x.id === c.id ? (data as unknown as Comment) : x)));
    setEditingCommentId(null);
  };

  const deleteComment = async (c: Comment) => {
    if (!confirm('Delete this comment?')) return;
    const token = getTokens()[c.id];
    const admin = token ? '' : promptAdmin();
    if (!token && !admin) return;
    const { error } = await supabase.rpc('delete_forum_comment', {
      p_id: c.id,
      p_token: token || '',
      p_admin: admin || null,
    });
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }
    removeToken(c.id);
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    if (activeThread) bumpCount(activeThread.id, -1);
  };

  const filteredThreads = useMemo(() => {
    let result = threads;
    if (filter !== 'all') {
      result = result.filter((t) => t.category === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || t.author_name.toLowerCase().includes(q));
    }
    return result;
  }, [threads, filter, searchQuery]);

  const pinnedThreads = filteredThreads.filter((t) => t.is_pinned);
  const discussionThreads = filteredThreads.filter((t) => !t.is_pinned);
  // In the "all" view, book requests get their own board section so open
  // requests stay visible instead of sinking into general discussions.
  const requestThreads = filter === 'all' ? discussionThreads.filter((t) => t.category === 'book_request') : [];
  const plainDiscussions =
    filter === 'all' ? discussionThreads.filter((t) => t.category !== 'book_request') : discussionThreads;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-xl flex flex-col animate-in fade-in duration-200">
      {/* Modern Forum Top Header Bar */}
      <div className="sticky top-0 z-20 border-b border-border/80 bg-card/90 backdrop-blur-md shadow-xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            {view !== 'list' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('list')}
                className="gap-1.5 rounded-full hover:bg-muted font-medium text-xs -ml-1"
              >
                <ArrowLeft className="w-4 h-4" /> <span>Back</span>
              </Button>
            )}
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0 shadow-md font-bold">
              <MessagesSquare className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-extrabold text-base sm:text-lg truncate leading-none flex items-center gap-2">
                <span>{view === 'list' ? 'Community Forum' : view === 'thread' ? activeThread?.title : 'Create New Thread'}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {view === 'list'
                  ? 'Official support forum for LinkToEpub — report site errors, request new sites, get help'
                  : view === 'thread'
                  ? `Started by ${activeThread?.author_name} · ${fullDate(activeThread?.created_at || '')}`
                  : 'Start a discussion or request a new web novel site'}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full shrink-0 hover:bg-muted">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Main Forum Body */}
      <div className="flex-1 overflow-y-auto">
        {/* LIST VIEW */}
        {view === 'list' && (
          <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
            {/* Search & Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card border border-border/80 p-3 rounded-2xl shadow-xs">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search discussions or keywords…"
                  className="pl-9 h-9 text-xs rounded-xl bg-background border-border/60 focus-visible:ring-primary/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Button
                onClick={() => {
                  setNewTitle('');
                  setNewBody('');
                  setNewCategory('general');
                  setView('new');
                }}
                className="gap-2 rounded-xl h-9 px-4 font-bold text-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm shrink-0"
              >
                <Plus className="w-4 h-4" /> New Discussion
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewCategory('book_request');
                  setView('new');
                }}
                className="gap-2 rounded-xl h-9 px-4 font-bold text-xs shrink-0 border-violet-500/40 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
              >
                <BookMarked className="w-4 h-4" /> Request a Book
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setView('rankings')}
                className="gap-2 rounded-xl h-9 px-4 font-bold text-xs shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
              >
                <Trophy className="w-4 h-4" /> Top Rankings
              </Button>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              {(['all', 'report_error', 'new_site', 'book_request', 'general'] as const).map((catKey) => {
                const isSelected = filter === catKey;
                const meta = catKey === 'all' ? null : CATEGORY_META[catKey];
                const Icon = meta?.icon || Filter;
                const count = catKey === 'all' ? threads.length : threads.filter(t => t.category === catKey).length;

                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setFilter(catKey)}
                    className={`shrink-0 flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold border transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                        : 'bg-card text-muted-foreground border-border/70 hover:border-primary/40 hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{catKey === 'all' ? 'All Threads' : meta?.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Trust & safety note */}
            <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-px shrink-0 text-primary" />
              <p>
                Posts from the LinkToEpub team are <span className="font-semibold text-foreground">pinned</span> and carry the{' '}
                <span className="font-semibold text-foreground">Official</span> badge. Display names are not verified — anyone can
                choose any name, and the team will never ask for your password here.
              </p>
            </div>

            {/* Loading / Empty State / Threads List */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground">Fetching community threads…</p>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="text-center py-16 px-4 border-2 border-dashed border-border/80 rounded-2xl bg-card/50 space-y-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary grid place-items-center mx-auto">
                  <MessagesSquare className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-foreground">No discussions found</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {searchQuery ? `No topics match "${searchQuery}". Try another search term.` : 'Be the first member of the community to start a discussion or request a site!'}
                </p>
                <Button size="sm" className="rounded-xl font-bold text-xs gap-1.5" onClick={() => setView('new')}>
                  <Plus className="w-4 h-4" /> Start Discussion
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                {pinnedThreads.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <Pin className="w-3.5 h-3.5 text-amber-500" /> Official &amp; pinned
                    </h3>
                    <div className="rounded-2xl border border-amber-500/30 bg-card divide-y divide-border/60 overflow-hidden shadow-xs">
                      {pinnedThreads.map((t) => (
                        <ThreadRow key={t.id} t={t} mine={isMine(t.id)} onOpen={() => openThread(t)} />
                      ))}
                    </div>
                  </section>
                )}
                {requestThreads.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <BookMarked className="w-3.5 h-3.5 text-violet-500" /> Book Requests &amp; Sharing
                    </h3>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Ask for a book you cannot find. If you have a requested book as an EPUB, open the request and
                      upload it — it goes straight into the Community Library and you are credited as the sharer.
                    </p>
                    <div className="rounded-2xl border border-violet-500/30 bg-card divide-y divide-border/60 overflow-hidden shadow-xs">
                      {requestThreads.map((t) => (
                        <ThreadRow key={t.id} t={t} mine={isMine(t.id)} onOpen={() => openThread(t)} share={shares[t.id] || null} />
                      ))}
                    </div>
                  </section>
                )}
                {plainDiscussions.length > 0 && (
                  <section className="space-y-2">
                    {pinnedThreads.length > 0 && (
                      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        <MessagesSquare className="w-3.5 h-3.5" /> Discussions
                      </h3>
                    )}
                    <div className="rounded-2xl border border-border/80 bg-card divide-y divide-border/60 overflow-hidden shadow-xs">
                      {plainDiscussions.map((t) => (
                        <ThreadRow key={t.id} t={t} mine={isMine(t.id)} onOpen={() => openThread(t)} share={shares[t.id] || null} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        )}

        {/* TOP RANKINGS VIEW */}
        {view === 'rankings' && (
          <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5 w-full">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" /> Top Novel Rankings
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ranked by the community: a novel climbs when readers mark it{' '}
                <span className="font-semibold text-foreground">Already Read</span>. Mark your own reads and your{' '}
                <span className="font-semibold text-foreground">Will Read</span> list to shape the board — each genre
                (Xianxia, Wuxia, Fantasy…) has its own ranking.
              </p>
            </div>

            <ProfileFields
              name={authorName}
              avatar={authorAvatar}
              onName={setAuthorName}
              onAvatar={setAuthorAvatar}
              compact
            />

            {/* Category pills */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              {rankCategories.map((cat) => {
                const isSelected = rankCategory === cat;
                const count =
                  cat === 'All' ? rankedNovels.length : rankedNovels.filter((n) => n.category === cat).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setRankCategory(cat)}
                    className={`shrink-0 flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold border transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                        : 'bg-card text-muted-foreground border-border/70 hover:border-primary/40 hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    <span>{cat === 'All' ? 'All Genres' : cat}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Add a novel */}
            <div className="bg-card border border-border/80 rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" /> Add your favourite novel
              </h3>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input
                  value={newNovelTitle}
                  onChange={(e) => setNewNovelTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Novel title (exact)"
                  className="h-10 text-sm rounded-xl bg-background border-border/80"
                />
                <Input
                  value={newNovelAuthor}
                  onChange={(e) => setNewNovelAuthor(e.target.value)}
                  maxLength={120}
                  placeholder="Author (optional)"
                  className="h-10 text-sm rounded-xl bg-background border-border/80"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={newNovelCategory} onValueChange={setNewNovelCategory}>
                  <SelectTrigger className="h-10 rounded-xl bg-background border-border/80 sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[120]">
                    {genreOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom">New genre…</SelectItem>
                  </SelectContent>
                </Select>
                {newNovelCategory === '__custom' && (
                  <Input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. Wuxia, Horror, Romance…"
                    className="h-10 text-sm rounded-xl bg-background border-border/80 flex-1"
                  />
                )}
                <Button
                  type="button"
                  onClick={addNovel}
                  disabled={addingNovel || !newNovelTitle.trim()}
                  className="gap-2 rounded-xl text-xs font-bold h-10"
                >
                  {addingNovel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Novel
                </Button>
              </div>
            </div>

            {/* Ranked list */}
            {rankingsLoading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
                <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading rankings…
              </div>
            ) : rankedList.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-border/80 rounded-2xl bg-card/40 space-y-1">
                <p className="text-sm font-semibold text-muted-foreground">No novels here yet.</p>
                <p className="text-xs text-muted-foreground/70">Add the first one above and mark it Read.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/80 bg-card divide-y divide-border/60 overflow-hidden shadow-xs">
                {rankedList.map(({ novel, read, will }, idx) => {
                  const mine = myMarks.get(novel.id);
                  const busy = markBusy === novel.id;
                  return (
                    <div key={novel.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex items-start gap-3 min-w-0 sm:flex-1">
                        <span
                          className={`w-8 h-8 shrink-0 grid place-items-center rounded-lg text-sm font-extrabold border ${
                            idx === 0
                              ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                              : idx === 1
                                ? 'bg-slate-400/15 text-slate-400 border-slate-400/30'
                                : idx === 2
                                  ? 'bg-orange-700/15 text-orange-600 border-orange-700/30'
                                  : 'bg-muted text-muted-foreground border-border/60'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold text-sm text-foreground break-words sm:truncate">
                            {novel.title}
                          </span>
                          <span className="block text-[11px] text-muted-foreground break-words sm:truncate">
                            {novel.author || 'Unknown author'} · {novel.category} · added by {novel.added_by}
                          </span>
                        </span>
                      </div>
                      <span className="flex gap-1.5 shrink-0 pl-11 sm:pl-0">
                        <Button
                          type="button"
                          size="sm"
                          variant={mine === 'read' ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={() => void setMark(novel, mine === 'read' ? null : 'read')}
                          className="h-8 rounded-lg text-[11px] font-bold gap-1 flex-1 sm:flex-none"
                        >
                          <Check className="w-3.5 h-3.5" /> Read · {read}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={mine === 'will_read' ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={() => void setMark(novel, mine === 'will_read' ? null : 'will_read')}
                          className="h-8 rounded-lg text-[11px] font-bold gap-1 flex-1 sm:flex-none"
                        >
                          <BookmarkPlus className="w-3.5 h-3.5" /> Will Read · {will}
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Your marks are saved under your forum display name on this browser. Tap your active mark again to
              remove it, or tap the other button to switch.
            </p>
          </div>
        )}

        {/* CREATE NEW THREAD VIEW */}
        {view === 'new' && (
          <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
            <div className="bg-card border border-border/80 rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" /> Post a new discussion
              </h2>

              <div className="rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Posting guidelines:</span> for a site error, include the
                site name, the page URL you tried, and the exact error message. For a new site, include the site's
                homepage URL. One topic per thread helps the team answer faster.
              </div>

              {newCategory === 'book_request' && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Asking for a book:</span> use the book's exact title
                  as the topic. If another reader has the EPUB, they can upload it right from your request — it lands
                  in the Community Library for everyone, and the sharer is thanked here by name.
                </div>
              )}

              <ProfileFields
                name={authorName}
                avatar={authorAvatar}
                onName={setAuthorName}
                onAvatar={setAuthorAvatar}
              />

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground">Select Category</Label>
                <Select value={newCategory} onValueChange={(v) => setNewCategory(v as Category)}>
                  <SelectTrigger className="h-10 rounded-xl bg-background border-border/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[120]">
                    <SelectItem value="general">General Discussion & Novel Recommendations</SelectItem>
                    <SelectItem value="report_error">Report Site Error or Broken Chapters</SelectItem>
                    <SelectItem value="new_site">Request Support for a New Site</SelectItem>
                    <SelectItem value="book_request">Request a Book (ask the community for an EPUB)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground">Topic Title</Label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={200}
                  placeholder={newCategory === 'book_request' ? 'e.g. Mother of Learning — complete EPUB' : 'e.g. Please add support for LightNovelWorld or NovelBin error...'}
                  className="h-10 text-sm rounded-xl bg-background border-border/80"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground">Description & Details</Label>
                <Textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  maxLength={5000}
                  rows={7}
                  placeholder={newCategory === 'book_request' ? 'Which book exactly? Author, language, edition or chapter range if it matters…' : 'Include novel URLs, error messages, or details to help us fix/add it quickly...'}
                  className="text-sm rounded-xl bg-background border-border/80 resize-y"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setView('list')} disabled={posting} className="rounded-xl text-xs font-bold">
                  Cancel
                </Button>
                <Button onClick={createThread} disabled={posting || !newTitle.trim()} className="gap-2 rounded-xl text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground">
                  {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Publish Thread
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* THREAD DETAIL & COMMENTS VIEW */}
        {view === 'thread' && activeThread && (
          <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
            {/* Main OP Thread Post */}
            <div className="border border-border/80 rounded-2xl p-5 sm:p-6 bg-card shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Avatar name={activeThread.author_name} url={activeThread.avatar_url} className="w-10 h-10" />
                  <div>
                    <div className="font-bold text-sm sm:text-base text-foreground flex items-center gap-2">
                      <span>{activeThread.author_name}</span>
                      {activeThread.is_pinned && <OfficialBadge />}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{timeAgo(activeThread.created_at)}</span>
                      {(() => {
                        const meta = CATEGORY_META[activeThread.category];
                        const Icon = meta.icon;
                        return (
                          <span className={`inline-flex items-center gap-1 font-bold text-[10px] ${meta.color}`}>
                            <Icon className="w-3 h-3" /> {meta.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {activeThread.is_pinned && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                    <Pin className="w-3.5 h-3.5 fill-amber-500" /> Pinned
                  </span>
                )}
              </div>

              {editingThread ? (
                <div className="space-y-3 pt-2">
                  <Select value={newCategory} onValueChange={(v) => setNewCategory(v as Category)}>
                    <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent className="z-[120]">
                      <SelectItem value="general">General Discussion</SelectItem>
                      <SelectItem value="report_error">Report Site Error</SelectItem>
                      <SelectItem value="new_site">Request New Site</SelectItem>
                      <SelectItem value="book_request">Book Request</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200} className="rounded-xl font-bold" />
                  <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={6} maxLength={5000} className="rounded-xl" />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => setEditingThread(false)} className="rounded-xl">Cancel</Button>
                    <Button size="sm" onClick={saveThreadEdit} className="rounded-xl">Save Changes</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <h1 className="font-display text-xl sm:text-2xl font-extrabold text-foreground leading-tight break-words">
                    {activeThread.title}
                  </h1>
                  {activeThread.body && (
                    <p className="text-sm sm:text-base leading-relaxed text-foreground/90 whitespace-pre-wrap break-words font-normal">
                      {activeThread.body}
                    </p>
                  )}
                </div>
              )}

              {!editingThread && (
                <div className="pt-3 flex items-center justify-end border-t border-border/50">
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingThread(true)} className="gap-1 text-xs rounded-lg">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteThread(activeThread)} className="gap-1 text-xs text-red-500 hover:text-red-600 rounded-lg">
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Comments Section */}
            {activeThread.category === 'book_request' &&
              (activeShare ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:p-5 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-bold text-foreground">Shared by {activeShare.by} — thank you! 🙏</p>
                    <p className="text-muted-foreground mt-1">
                      This book is now in the <span className="font-semibold text-foreground">Community Library</span>.
                      Open the Library and search &ldquo;{activeThread.title}&rdquo; to download it.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 sm:p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    <BookUp className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-bold text-foreground">Have this book as an EPUB?</p>
                      <p className="text-muted-foreground mt-1">
                        Share it here — the file goes straight into the Community Library for everyone who is asking,
                        and you will be credited as the sharer in this request.
                      </p>
                    </div>
                  </div>
                  <input
                    ref={shareFileRef}
                    type="file"
                    accept=".epub,application/epub+zip"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void handleShareFile(f);
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => shareFileRef.current?.click()}
                    disabled={shareUploading}
                    className="gap-2 rounded-xl text-xs font-bold"
                  >
                    {shareUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {shareUploading ? 'Uploading to the library…' : 'Upload EPUB for this request'}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    EPUB only, 100 KB – 40 MB. It will be shared under your forum name:{' '}
                    <span className="font-semibold text-foreground">{authorName.trim() || 'Reader'}</span> (change it in
                    the reply box below).
                  </p>
                </div>
              ))}

            <div className="space-y-4">
              <div className="flex items-center justify-between font-bold text-sm text-foreground">
                <span className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  {activeThread.comment_count} {activeThread.comment_count === 1 ? 'Reply' : 'Replies'}
                </span>
              </div>

              {loadingComments ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading comments…
                </div>
              ) : comments.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border/80 rounded-2xl bg-card/40 space-y-1">
                  <p className="text-sm font-semibold text-muted-foreground">No replies yet.</p>
                  <p className="text-xs text-muted-foreground/70">Share your thoughts or answer the question below.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((c) => (
                    <div key={c.id} className="border border-border/80 rounded-2xl p-4 bg-card shadow-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={c.author_name} url={c.avatar_url} className="w-7 h-7" />
                          <span className="font-bold text-xs text-foreground">{c.author_name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">· {timeAgo(c.created_at)}</span>
                          {isMine(c.id) && (
                            <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.2 rounded border border-primary/20">
                              You
                            </span>
                          )}
                        </div>
                      </div>

                      {editingCommentId === c.id ? (
                        <div className="space-y-2 pt-1">
                          <Textarea
                            value={editCommentBody}
                            onChange={(e) => setEditCommentBody(e.target.value)}
                            rows={3}
                            maxLength={3000}
                            className="text-xs rounded-xl"
                          />
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => setEditingCommentId(null)} className="h-7 text-xs rounded-lg">
                              Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveCommentEdit(c)} className="h-7 text-xs rounded-lg">Save</Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xs sm:text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">{c.body}</p>
                          <div className="flex gap-2 mt-2 pt-2 border-t border-border/40 justify-end">
                            <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 px-2" onClick={() => { setEditingCommentId(c.id); setEditCommentBody(c.body); }}>
                              <Pencil className="w-3 h-3" /> Edit
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 px-2 text-red-500 hover:text-red-600" onClick={() => deleteComment(c)}>
                              <Trash2 className="w-3 h-3" /> Delete
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comment Composer */}
            <div className="border border-border/80 rounded-2xl p-4 bg-card shadow-md space-y-3 sticky bottom-3 backdrop-blur-lg">
              <ProfileFields
                name={authorName}
                avatar={authorAvatar}
                onName={setAuthorName}
                onAvatar={setAuthorAvatar}
                compact
              />
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={3}
                maxLength={3000}
                placeholder="Write a constructive reply…"
                className="rounded-xl text-xs sm:text-sm bg-background border-border/80 resize-none focus-visible:ring-primary/20"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground font-mono">{commentBody.length}/3000</span>
                <Button
                  size="sm"
                  onClick={postComment}
                  disabled={postingComment || !commentBody.trim()}
                  className="gap-1.5 rounded-xl font-bold text-xs bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                >
                  {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Post Reply
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileFields({
  name,
  avatar,
  onName,
  onAvatar,
  compact = false,
}: {
  name: string;
  avatar: string;
  onName: (v: string) => void;
  onAvatar: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${compact ? '' : 'pt-1'}`}>
      <div className="relative">
        {!compact && <Label className="text-xs font-bold text-foreground">Your Name</Label>}
        <div className="relative">
          <User className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={name}
            onChange={(e) => onName(e.target.value)}
            maxLength={40}
            placeholder="Display Name (e.g. Reader123)"
            className="pl-8 h-9 text-xs rounded-xl bg-background border-border/80"
          />
        </div>
      </div>
      <div>
        {!compact && <Label className="text-xs font-bold text-foreground">Avatar URL (Optional)</Label>}
        <Input
          value={avatar}
          onChange={(e) => onAvatar(e.target.value)}
          maxLength={500}
          placeholder="Avatar Image URL (https://...)"
          className="h-9 text-xs rounded-xl bg-background border-border/80"
        />
      </div>
    </div>
  );
}
