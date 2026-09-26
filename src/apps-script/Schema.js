// Tab names and column headers for every spreadsheet the app uses.
// The Template spreadsheet is built from MONTHLY_TABS; each month's spreadsheet is a copy of it.

const CONTROL_TABS = {
  Months: ['month_label', 'spreadsheet_id', 'created_date', 'status'],
};

const MONTHLY_TABS = {
  Users: ['username', 'password_hash', 'salt', 'role', 'active', 'created_date'],
  Sessions: ['token', 'username', 'issued_at', 'expires_at'],
  SlotConfig: ['box', 'slot_number', 'price_per_ticket'],
  SlotState: [
    'box', 'slot_number', 'pack_key', 'game_number', 'pack_number', 'price_per_ticket',
    'current_exposed_ticket_number', 'remaining_count', 'activation_date', 'last_close_date',
    // Kept so a pack activated into the wrong slot can be undone exactly.
    'price_before_activation', 'took_from_reserve',
    // The game of the last pack that sold out or was returned here, kept after the slot empties
    // so an out-of-stock slot can show how many packs of that game are in back stock.
    'last_game_number',
  ],
  ReserveInventory: [
    'game_number', 'price_per_ticket', 'tickets_per_pack', 'packs_in_reserve', 'tickets_in_reserve',
    // Set when the owner marks the game ended (CA Lottery stopped it): hidden from back stock, row kept
    // for its price and pack size. Cleared if a pack of it is received or put in a slot again.
    'ended_date',
  ],
  Shipments: [
    'shipment_date', 'game_number', 'price_per_ticket', 'tickets_per_pack', 'packs_received',
    'tickets_received', 'source', 'notes', 'performed_by',
  ],
  ReserveAdjustments: ['adjustment_date', 'game_number', 'packs_removed', 'tickets_removed', 'reason', 'notes', 'performed_by'],
  DailyCloseLog: [
    'close_date', 'box', 'slot_number', 'pack_key', 'previous_exposed_ticket_number',
    'current_exposed_ticket_number', 'tickets_sold', 'price_per_ticket', 'dollars_sold',
    'remaining_after_close', 'close_type', 'late_activation', 'performed_by',
    // The pack's last close before this row, so undoing it restores that even across months.
    'previous_close_date',
  ],
  DailySummary: [
    'close_date', 'total_tickets_sold', 'total_dollars_sold', 'occupied_slot_count', 'total_inventory_value',
    // Made by the phone for each close it submits, so a close sent twice (after a dropped connection) is saved once.
    'close_id',
  ],
  PackHistory: [
    'game_number', 'pack_number', 'box', 'slot_number', 'price_per_ticket', 'activation_date',
    'end_date', 'end_reason', 'final_tickets_sold_total', 'remaining_at_return', 'total_dollars_sold', 'performed_by',
  ],
};

// Start New Month copies the whole spreadsheet, so these carry into the next month as they are
// (Sessions too, so nobody is signed out mid-shift).
const CARRIED_FORWARD_TABS = ['Users', 'Sessions', 'SlotConfig', 'SlotState', 'ReserveInventory'];
// The log tabs start each month empty, except rows already dated in the new month (the date
// column is given here): those move from the old month's spreadsheet into the new one.
const MONTHLY_LOG_DATE_COLUMNS = {
  Shipments: 'shipment_date',
  ReserveAdjustments: 'adjustment_date',
  DailyCloseLog: 'close_date',
  DailySummary: 'close_date',
  PackHistory: 'end_date',
};

// Tickets in a pack by ticket price (owner's rule of thumb, 2026-09-24). Packs count down, so a
// 30-ticket pack is numbered 29 to 0. Used to fill in a new game's pack size.
const STANDARD_PACK_SIZES = { 40: 30, 30: 30, 20: 30, 10: 50, 5: 80, 3: 100, 2: 100, 1: 240 };

// Price tier of each slot, slots 1-24 in order, taken from the SEP LOTTO 2026 workbook
// (layout as of 2026-09-22). Only used to seed the very first month; edit in-app afterwards.
const INITIAL_SLOT_PRICES = {
  1: [40, 20, 20, 20, 20, 20, 20, 20, 10, 10, 10, 10, 5, 5, 5, 5, 3, 3, 3, 2, 2, 2, 2, 1],
  2: [40, 30, 30, 30, 20, 20, 20, 20, 10, 10, 10, 10, 5, 5, 5, 5, 5, 5, 5, 3, 2, 2, 2, 2],
};
