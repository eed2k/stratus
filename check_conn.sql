SELECT count(*), state FROM pg_stat_activity WHERE datname='stratus' GROUP BY state;
SHOW max_connections;
