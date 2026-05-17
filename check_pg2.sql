SELECT pid, application_name, state, wait_event_type, wait_event, now() - state_change AS idle_for, left(query,200) AS last_q
FROM pg_stat_activity
WHERE datname = 'stratus' AND pid <> pg_backend_pid()
ORDER BY state_change DESC LIMIT 30;
