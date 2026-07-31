CREATE OR REPLACE FUNCTION public.is_forum_admin(p_admin text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT p_admin IS NOT NULL
     AND encode(sha256(convert_to(p_admin, 'UTF8')), 'hex')
         = 'd498205a99bf24c3f0ff5da7b5b81a1ca41517bc6f33f1a7db1e97e23c47dfcb';
$$;

REVOKE ALL ON FUNCTION public.is_forum_admin(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_forum_comment(p_id uuid, p_token text, p_admin text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  DELETE FROM public.forum_comments
   WHERE id = p_id
     AND (edit_token = p_token OR public.is_forum_admin(p_admin));
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Not authorized to delete this comment';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_forum_thread(p_id uuid, p_token text, p_admin text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
BEGIN
  DELETE FROM public.forum_threads
   WHERE id = p_id
     AND (edit_token = p_token OR public.is_forum_admin(p_admin));
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Not authorized to delete this thread';
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_forum_comment(p_id uuid, p_token text, p_body text, p_admin text DEFAULT NULL::text)
RETURNS forum_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  row public.forum_comments;
BEGIN
  UPDATE public.forum_comments
     SET body = p_body
   WHERE id = p_id
     AND (edit_token = p_token OR public.is_forum_admin(p_admin))
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to edit this comment';
  END IF;

  RETURN row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_forum_thread(p_id uuid, p_token text, p_title text, p_body text, p_category forum_category, p_admin text DEFAULT NULL::text)
RETURNS forum_threads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  row public.forum_threads;
BEGIN
  UPDATE public.forum_threads
     SET title = p_title,
         body = p_body,
         category = p_category
   WHERE id = p_id
     AND (edit_token = p_token OR public.is_forum_admin(p_admin))
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized to edit this thread';
  END IF;

  RETURN row;
END;
$function$;