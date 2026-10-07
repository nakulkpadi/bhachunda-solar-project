-- Enum changes precede approval policies so the new values are committed.
alter type public.app_role add value if not exists 'editor';
alter type public.app_role add value if not exists 'commenter';
