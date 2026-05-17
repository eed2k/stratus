SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='shares';
SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.shares'::regclass;
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='shares';
