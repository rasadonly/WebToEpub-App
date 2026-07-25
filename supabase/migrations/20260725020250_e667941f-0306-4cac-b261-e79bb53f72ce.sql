
-- Hide edit_token from public/authenticated SELECT (column-level privilege).
-- INSERT still needs to write edit_token, so keep INSERT on all columns.
REVOKE SELECT ON public.forum_threads FROM anon, authenticated;
REVOKE SELECT ON public.forum_comments FROM anon, authenticated;

GRANT SELECT (id, title, body, category, author_name, avatar_url, is_pinned, comment_count, created_at, updated_at)
  ON public.forum_threads TO anon, authenticated;

GRANT SELECT (id, thread_id, body, author_name, avatar_url, created_at, updated_at)
  ON public.forum_comments TO anon, authenticated;

-- Lock down internal trigger functions so they cannot be executed via the API.
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.forum_bump_comment_count() FROM PUBLIC, anon, authenticated;
