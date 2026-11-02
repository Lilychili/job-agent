-- An Indeed job is now known by its jk alone. Where one jk has several rows, the dismissed one takes the
-- new key, so it keeps the job out; the other row keeps its old key rather than being changed or removed.
WITH keyed AS (
  SELECT id,
         'https://indeed.com/viewjob?jk=' || (regexp_match(canonical_url, '[?&]jk=([^&]+)'))[1] AS new_key,
         row_number() OVER (PARTITION BY (regexp_match(canonical_url, '[?&]jk=([^&]+)'))[1] ORDER BY archived DESC, created_at) AS rank
    FROM job
   WHERE canonical_url ~ '^https://([a-z0-9-]+\.)*indeed\.[a-z.]+/.*[?&]jk='
)
UPDATE job
   SET canonical_url = keyed.new_key
  FROM keyed
 WHERE job.id = keyed.id
   AND keyed.rank = 1
   AND NOT EXISTS (SELECT 1 FROM job other WHERE other.canonical_url = keyed.new_key);
--> statement-breakpoint
UPDATE discovered_company SET reason = 'From an Indeed alert.' WHERE reason = 'From a Indeed alert.';
