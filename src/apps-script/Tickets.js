// Ticket order: which way a pack's tickets are sold. Every count that depends on it goes through here.
//
// - Descending (Route 66 Liquor, and every pack from before the setting existed): the top ticket goes from
//   the last ticket (size − 1) down to 000. A pack whose top ticket is N has N + 1 left.
// - Ascending: 000 up to the last ticket. A pack whose top ticket is N has size − N left, so it needs the
//   game's pack size (ReserveInventory.tickets_per_pack).
// The "top ticket" is always the next unsold ticket showing, in either order, and 000 is a real ticket.
//
// Each slot has its setting (SlotConfig.ticket_order), copied onto a pack when it's activated
// (SlotState.ticket_order, then PackHistory). All counting uses the pack's own order, so a slot's setting
// only changes while it's empty, or (Set all slots) from its next pack.

const TICKET_ORDERS = ['descending', 'ascending'];

// A row's order. Anything but 'ascending' (including a blank cell or a sheet without the column) is descending.
function orderOf(row) {
  return row && String(row.ticket_order) === 'ascending' ? 'ascending' : 'descending';
}

function ticketsLeft(order, top, size) {
  return order === 'ascending' ? size - top : top + 1;
}

function ticketsSold(order, last, now) {
  return order === 'ascending' ? now - last : last - now;
}

// True for a ticket already sold: above the last top ticket when descending, below it when ascending.
function alreadySold(order, last, ticket) {
  return order === 'ascending' ? ticket < last : ticket > last;
}

// "above" / "below" the last top ticket, for refusal messages.
function soldSide(order) {
  return order === 'ascending' ? 'below' : 'above';
}

// Finds a game's pack size, reading ReserveInventory at most once and only when first asked, so a request
// over descending packs (which never need it) reads nothing extra. `rows` reuses a copy already read.
function packSizeFinder(rows) {
  return (gameNumber, price) => {
    rows = rows || readTable(monthSheet('ReserveInventory'));
    const reserve = rows.find((r) => String(r.game_number) === String(gameNumber));
    return (reserve && Number(reserve.tickets_per_pack)) || STANDARD_PACK_SIZES[Number(price)] || null;
  };
}

// The pack size a count needs: only ascending packs ask for it.
function sizeFor(order, state, findSize) {
  return order === 'ascending' ? findSize(state.game_number, state.price_per_ticket) : null;
}
