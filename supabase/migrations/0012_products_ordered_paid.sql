-- Inventory: how many of a thing are on order from the vendor right now, and
-- whether that order has been paid for (16 Sep 2026, Cory: "two new columns
-- on the Inventory page - ordered and paid").
--
-- Deliberately separate from stock_qty (what the kiosk decrements as things
-- sell) and from daily_count_lines.ordered (what was put out on one day).
-- This is the standing order against a vendor and the state of that bill.
alter table products add column if not exists ordered_qty numeric;
alter table products add column if not exists paid boolean not null default false;
