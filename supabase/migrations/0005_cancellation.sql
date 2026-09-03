-- Tracks a scheduled-but-not-yet-effective cancellation, set via Stripe's own
-- `cancel_at` (an arbitrary future timestamp, not just end-of-period) so a
-- member who cancels mid-cycle still gets one more renewal charge whenever
-- their 30-day notice period runs past the current period end - Stripe
-- handles that billing automatically, this column just mirrors it for display.
alter table subscriptions add column cancel_at timestamptz;
