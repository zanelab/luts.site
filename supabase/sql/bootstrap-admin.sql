-- Bootstrap an admin user
--
-- Run AFTER the user has logged in at least once via magic link
-- (so auth.users has a row + the trigger has mirrored it into public.users).
--
-- Steps:
--   1. Get the user's auth.users.id from Dashboard → Authentication → Users
--      (click the user, copy the "User UID" field).
--   2. Substitute the values below and run in SQL editor.
--
-- Or in a single shot, if you know the email:
--
--   update public.users
--   set role = 'admin'
--   where email = 'admin@example.com';
--
-- Verify:
--   select id, email, role from public.users where role = 'admin';

-- Option A: set by id (preferred — id never changes)
update public.users
set role = 'admin'
where id = '00000000-0000-0000-0000-000000000000';

-- Option B: set by email (above is equivalent)
-- update public.users
-- set role = 'admin'
-- where email = 'admin@example.com';

-- To revoke admin later:
-- update public.users
-- set role = 'user'
-- where email = 'admin@example.com';
