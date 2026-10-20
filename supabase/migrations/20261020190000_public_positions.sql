-- Every team's positions and their performance are public, during the challenge too.
-- (Policies are OR-ed: this one makes the older own-or-final policy irrelevant.)
create policy public_read on public.positions for select to anon, authenticated using (true);
