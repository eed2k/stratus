SELECT pid, now() - pg_stat_activity.query_start AS duration, state, wait_event_type, wait_event, left(query,300) AS q
FROM pg_stat_activity
WHERE state != 'idle' AND query NOT ILIKE '%pg_stat_activity%'
ORDER BY duration DESC LIMIT 30;
SELECT relation::regclass, mode, granted, pid FROM pg_locks WHERE NOT granted;
