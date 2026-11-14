// Structured report attributes (project.md §4.4). Public, non-sensitive fields: identifying
// details such as serial numbers or engravings belong in the private claim proof instead.

/** The colours the report form offers. Anything else is "other". */
export const LOST_FOUND_COLORS = [
  'black', 'white', 'grey', 'silver', 'gold', 'red', 'orange',
  'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'other',
] as const;
export type LostFoundColor = (typeof LOST_FOUND_COLORS)[number];

/** A time window (itemDate to itemDateTo) spans at most this many days. */
export const MAX_ITEM_WINDOW_DAYS = 30;

/**
 * Item dates may run this many days past the server's UTC date: a user in UTC+6 is already on
 * the next calendar day for six hours after UTC midnight.
 */
export const ITEM_DATE_GRACE_DAYS = 1;
