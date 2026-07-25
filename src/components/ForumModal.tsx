import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  ArrowUp,
} from 'lucide-react';

interface ForumModalProps {
  open: boolean;
  onClose: () => void;
}

type Category = 'report_error' | 'new_site' | 'general';

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
}

interface Comment {
  id: string;
  thread_id: string;
  body: string;
  author_name: string;
  avatar_url: string | null;
  created_at: string;
}

const CATEGORY_META: Record<Category, { label: string; icon: any; color: string }> = {
  report_error: { label: 'Site Error', icon: Bug, color: 'text-red-500' },
  new_site: { label: 'New Site', icon: Globe, color: 'text-blue-500' },
  general: { label: 'Discussion', icon: MessagesSquare, color: 'text-emerald-500' },
};

const TOKENS_KEY = 'forum-edit-tokens';
const PROFILE_KEY = 'forum-profile';

function getTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}');
  } catch {
    return {};
  }
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
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
  } catch {
    return { name: '', avatar_url: '' };
  }
}
function saveProfile(name: string, avatar_url: string) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, avatar_url }));
}
function newToken() {
  return crypto.randomUUID();
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const hue = (letter.charCodeAt(0) * 37) % 360;
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="w-8 h-8 rounded-full object-cover bg-muted shrink-0"
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
      style={{ background: `hsl(${hue}, 55%, 45%)` }}
    >
      {letter}
    </div>
  );
}

export function ForumModal({ open, onClose }: ForumModalProps) {
  const { toast } = useToast();
  const [view, setView] = useState<'list' | 'thread' | 'new'>('list');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [filter, setFilter] = useState<'all' | Category>('all');

  // Compose state (new thread + edit thread)
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

  const loadThreads = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('forum_threads')
      .select('id,title,body,category,author_name,avatar_url,is_pinned,comment_count,created_at,updated_at')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) toast({ title: 'Failed to load forum', description: error.message, variant: 'destructive' });
    else setThreads((data as Thread[]) || []);
    setLoading(false);
  }, [toast]);

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
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
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
    const name = authorName.trim() || 'Anonymous';
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
      toast({ title: 'Failed to post', description: error?.message, variant: 'destructive' });
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
      toast({ title: 'Failed to comment', description: error?.message, variant: 'destructive' });
      return;
    }
    saveToken(data.id, token);
    setCommentBody('');
    setComments((prev) => [...prev, data as Comment]);
    setActiveThread({ ...activeThread, comment_count: activeThread.comment_count + 1 });
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
    if (activeThread) setActiveThread({ ...activeThread, comment_count: Math.max(0, activeThread.comment_count - 1) });
  };

  const filteredThreads = useMemo(
    () => (filter === 'all' ? threads : threads.filter((t) => t.category === filter)),
    [threads, filter]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80 sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {view !== 'list' && (
            <Button variant="ghost" size="sm" onClick={() => setView('list')} className="gap-1">
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          )}
          <MessagesSquare className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm sm:text-base truncate">
            {view === 'list' && 'Community Forum'}
            {view === 'thread' && (activeThread?.title || 'Thread')}
            {view === 'new' && 'New Discussion'}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {view === 'list' && (
          <div className="max-w-3xl mx-auto p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 flex-wrap">
                {(['all', 'report_error', 'new_site', 'general'] as const).map((f) => {
                  const label = f === 'all' ? 'All' : CATEGORY_META[f].label;
                  return (
                    <Button
                      key={f}
                      size="sm"
                      variant={filter === f ? 'default' : 'outline'}
                      onClick={() => setFilter(f)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
              <Button
                className="ml-auto gap-1"
                size="sm"
                onClick={() => {
                  setNewTitle('');
                  setNewBody('');
                  setNewCategory('general');
                  setView('new');
                }}
              >
                <Send className="w-4 h-4" /> New Thread
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading discussions…
              </div>
            ) : filteredThreads.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No threads yet. Start one!</p>
            ) : (
              <ul className="space-y-2">
                {filteredThreads.map((t) => {
                  const meta = CATEGORY_META[t.category];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={t.id}
                      className="border border-border rounded-lg p-3 bg-card hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => openThread(t)}
                    >
                      <div className="flex items-start gap-3">
                        <Avatar name={t.author_name} url={t.avatar_url} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                            <span className={`inline-flex items-center gap-1 ${meta.color}`}>
                              <Icon className="w-3.5 h-3.5" /> {meta.label}
                            </span>
                            <span>· by {t.author_name}</span>
                            <span>· {timeAgo(t.created_at)}</span>
                            {t.is_pinned && (
                              <span className="inline-flex items-center gap-1 text-amber-500">
                                <Pin className="w-3 h-3" /> Pinned
                              </span>
                            )}
                            {isMine(t.id) && (
                              <span className="inline-flex items-center gap-1 text-primary">
                                <ShieldCheck className="w-3 h-3" /> yours
                              </span>
                            )}
                          </div>
                          <h3 className="font-semibold text-sm sm:text-base mt-1 break-words">{t.title}</h3>
                          {t.body && (
                            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-1 break-words">
                              {t.body}
                            </p>
                          )}
                          <div className="text-xs text-muted-foreground mt-2 flex items-center gap-3">
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="w-3.5 h-3.5" /> {t.comment_count}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {view === 'new' && (
          <div className="max-w-2xl mx-auto p-4 space-y-4">
            <ProfileFields
              name={authorName}
              avatar={authorAvatar}
              onName={setAuthorName}
              onAvatar={setAuthorAvatar}
            />
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={newCategory} onValueChange={(v) => setNewCategory(v as Category)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">💬 Discussion</SelectItem>
                  <SelectItem value="report_error">🐞 Report site error</SelectItem>
                  <SelectItem value="new_site">🌐 Request new site</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={200}
                placeholder="Short summary of your topic"
              />
            </div>
            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                maxLength={5000}
                rows={8}
                placeholder="Details, links, steps to reproduce, etc."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setView('list')} disabled={posting}>
                Cancel
              </Button>
              <Button onClick={createThread} disabled={posting || !newTitle.trim()} className="gap-1">
                {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Post
              </Button>
            </div>
          </div>
        )}

        {view === 'thread' && activeThread && (
          <div className="max-w-3xl mx-auto p-4 space-y-4">
            {/* Thread body */}
            <div className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-start gap-3">
                <Avatar name={activeThread.author_name} url={activeThread.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    {(() => {
                      const meta = CATEGORY_META[activeThread.category];
                      const Icon = meta.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 ${meta.color}`}>
                          <Icon className="w-3.5 h-3.5" /> {meta.label}
                        </span>
                      );
                    })()}
                    <span>· by {activeThread.author_name}</span>
                    <span>· {timeAgo(activeThread.created_at)}</span>
                    {activeThread.is_pinned && (
                      <span className="inline-flex items-center gap-1 text-amber-500">
                        <Pin className="w-3 h-3" /> Pinned
                      </span>
                    )}
                  </div>

                  {editingThread ? (
                    <div className="space-y-2 mt-2">
                      <Select value={newCategory} onValueChange={(v) => setNewCategory(v as Category)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">💬 Discussion</SelectItem>
                          <SelectItem value="report_error">🐞 Report site error</SelectItem>
                          <SelectItem value="new_site">🌐 Request new site</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200} />
                      <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={6} maxLength={5000} />
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => setEditingThread(false)}>Cancel</Button>
                        <Button size="sm" onClick={saveThreadEdit}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="font-display text-lg sm:text-xl font-bold mt-1 break-words">
                        {activeThread.title}
                      </h2>
                      {activeThread.body && (
                        <p className="text-sm mt-2 whitespace-pre-wrap break-words">{activeThread.body}</p>
                      )}
                    </>
                  )}

                  {!editingThread && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="ghost" onClick={() => setEditingThread(true)} className="gap-1">
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteThread(activeThread)}
                        className="gap-1 text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Comments */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {activeThread.comment_count} {activeThread.comment_count === 1 ? 'Comment' : 'Comments'}
              </h3>

              {loadingComments ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.id} className="border border-border rounded-lg p-3 bg-card/70">
                      <div className="flex items-start gap-3">
                        <Avatar name={c.author_name} url={c.avatar_url} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{c.author_name}</span>
                            <span>· {timeAgo(c.created_at)}</span>
                            {isMine(c.id) && (
                              <span className="inline-flex items-center gap-1 text-primary">
                                <ShieldCheck className="w-3 h-3" /> yours
                              </span>
                            )}
                          </div>
                          {editingCommentId === c.id ? (
                            <div className="space-y-2 mt-2">
                              <Textarea
                                value={editCommentBody}
                                onChange={(e) => setEditCommentBody(e.target.value)}
                                rows={3}
                                maxLength={3000}
                              />
                              <div className="flex gap-2 justify-end">
                                <Button size="sm" variant="outline" onClick={() => setEditingCommentId(null)}>
                                  Cancel
                                </Button>
                                <Button size="sm" onClick={() => saveCommentEdit(c)}>Save</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                              <div className="flex gap-1 mt-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-xs"
                                  onClick={() => {
                                    setEditingCommentId(c.id);
                                    setEditCommentBody(c.body);
                                  }}
                                >
                                  <Pencil className="w-3 h-3" /> Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1 text-xs text-red-500 hover:text-red-600"
                                  onClick={() => deleteComment(c)}
                                >
                                  <Trash2 className="w-3 h-3" /> Delete
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Composer */}
            <div className="border border-border rounded-lg p-3 bg-card/50 space-y-2 sticky bottom-0">
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
                placeholder="Add a comment…"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={postComment}
                  disabled={postingComment || !commentBody.trim()}
                  className="gap-1"
                >
                  {postingComment ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                  Post
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
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${compact ? '' : ''}`}>
      <div>
        {!compact && <Label className="text-xs">Display name</Label>}
        <Input
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={40}
          placeholder="Display name (e.g. NovelFan)"
        />
      </div>
      <div>
        {!compact && <Label className="text-xs">Avatar URL (optional)</Label>}
        <Input
          value={avatar}
          onChange={(e) => onAvatar(e.target.value)}
          maxLength={500}
          placeholder="https://... (optional avatar image URL)"
        />
      </div>
    </div>
  );
}
