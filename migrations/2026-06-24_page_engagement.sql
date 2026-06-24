-- Add Page Engagement as a stored ad metric (renders as its own KPI card). Safe + idempotent.
alter table kpi_monthly add column if not exists page_engagement numeric;
