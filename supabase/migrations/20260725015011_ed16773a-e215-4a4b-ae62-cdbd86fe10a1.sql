
-- Categories for threads
CREATE TYPE public.forum_category AS ENUM ('report_error', 'new_site', 'general');

-- Threads
CREATE TABLE public.forum_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  category public.forum_category NOT NULL DEFAULT 'general',
  author_name text NOT NULL DEFAULT 'Anonymous',
  avatar_url text,
  edit_token text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  comment_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.forum_threads TO anon, authenticated;
GRANT ALL ON public.forum_threads TO service_role;

ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read threads"
  ON public.forum_threads FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create threads"
  ON public.forum_threads FOR INSERT
  WITH CHECK (true);

-- No direct UPDATE/DELETE policy: edits go through the security-definer
-- RPC functions below so the edit_token stays server-checked.

-- Comments
CREATE TABLE public.forum_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.forum_threads(id) ON DELETE CASCADE,
  body text NOT NULL,
  author_name text NOT NULL DEFAULT 'Anonymous',
  avatar_url text,
  edit_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.forum_comments TO anon, authenticated;
GRANT ALL ON public.forum_comments TO service_role;

ALTER TABLE public.forum_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read comments"
  ON public.forum_comments FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create comments"
  ON public.forum_comments FOR INSERT
  WITH CHECK (true);

CREATE INDEX forum_comments_thread_idx ON public.forum_comments(thread_id, created_at);
CREATE INDEX forum_threads_created_idx ON public.forum_threads(is_pinned DESC, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER forum_threads_updated_at
  BEFORE UPDATE ON public.forum_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER forum_comments_updated_at
  BEFORE UPDATE ON public.forum_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Maintain comment_count on threads
CREATE OR REPLACE FUNCTION public.forum_bump_comment_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.forum_threads
      SET comment_count = comment_count + 1
      WHERE id = NEW.thread_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.forum_threads
      SET comment_count = GREATEST(comment_count - 1, 0)
      WHERE id = OLD.thread_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER forum_comments_count_ins
  AFTER INSERT ON public.forum_comments
  FOR EACH ROW EXECUTE FUNCTION public.forum_bump_comment_count();

CREATE TRIGGER forum_comments_count_del
  AFTER DELETE ON public.forum_comments
  FOR EACH ROW EXECUTE FUNCTION public.forum_bump_comment_count();

-- === Token-guarded edit/delete RPCs ===
-- Admin password is intentionally hard-coded to match the existing app-wide
-- admin panel password ("prasadonly").

CREATE OR REPLACE FUNCTION public.update_forum_thread(
  p_id uuid,
  p_token text,
  p_title text,
  p_body text,
  p_category public.forum_category,
  p_admin text DEFAULT NULL
)
RETURNS public.forum_threads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.forum_threads;
BEGIN
  UPDATE public.forum_threads
     SET title = p_title,
         body = p_body,
         category = p_category
   WHERE id = p_id
     AND (edit_token = p_token OR p_admin = 'prasadonly')
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to edit this thread';
  END IF;

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_forum_thread(
  p_id uuid,
  p_token text,
  p_admin text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM public.forum_threads
   WHERE id = p_id
     AND (edit_token = p_token OR p_admin = 'prasadonly');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Not authorized to delete this thread';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_forum_comment(
  p_id uuid,
  p_token text,
  p_body text,
  p_admin text DEFAULT NULL
)
RETURNS public.forum_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.forum_comments;
BEGIN
  UPDATE public.forum_comments
     SET body = p_body
   WHERE id = p_id
     AND (edit_token = p_token OR p_admin = 'prasadonly')
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to edit this comment';
  END IF;

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_forum_comment(
  p_id uuid,
  p_token text,
  p_admin text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM public.forum_comments
   WHERE id = p_id
     AND (edit_token = p_token OR p_admin = 'prasadonly');
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Not authorized to delete this comment';
  END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_forum_thread(uuid, text, text, text, public.forum_category, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_forum_thread(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_forum_comment(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_forum_comment(uuid, text, text) TO anon, authenticated;

-- Seed the two starter (pinned, admin-owned) threads
INSERT INTO public.forum_threads (title, body, category, author_name, edit_token, is_pinned)
VALUES
  (
    '🐞 Report a site error',
    'Found a bug or a site that stopped working? Reply below with the URL and what happened so we can fix it.',
    'report_error',
    'Admin',
    'seed-' || gen_random_uuid()::text,
    true
  ),
  (
    '🌐 Request a new site',
    'Want a novel site added? Post the site URL and one example novel URL here — we''ll add support.',
    'new_site',
    'Admin',
    'seed-' || gen_random_uuid()::text,
    true
  );
