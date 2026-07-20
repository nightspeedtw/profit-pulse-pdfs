
SET LOCAL app.allow_live_assets_override = 'on';
UPDATE public.ebooks_kids
   SET listing_status = 'unlisted',
       sellable = false,
       blocker_reason = 'owner_removed'
 WHERE id IN (
   '83ffcf21-3106-4045-b2f0-995ffed4c171',
   '53883c93-f504-4846-bbd2-245075f8218d',
   'd4e77e5b-7ad6-4628-ae84-906c3423c4cb',
   'e86fe400-6cd6-49b6-8c6a-9041310425ef'
 );
