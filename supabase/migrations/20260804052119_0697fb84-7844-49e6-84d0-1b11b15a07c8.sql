CREATE OR REPLACE FUNCTION public.sync_forum_comment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.forum_threads SET comment_count = comment_count + 1 WHERE id = NEW.thread_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.forum_threads SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.thread_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS forum_comments_count_trigger ON public.forum_comments;
CREATE TRIGGER forum_comments_count_trigger
AFTER INSERT OR DELETE ON public.forum_comments
FOR EACH ROW EXECUTE FUNCTION public.sync_forum_comment_count();

UPDATE public.forum_threads t
SET comment_count = COALESCE((SELECT count(*) FROM public.forum_comments c WHERE c.thread_id = t.id), 0);