// Back stock (the packs in the back, not yet in a slot) — owner only.
// The owner scans one ticket per game and types how many packs, instead of scanning every pack.
//
// - Shipment received: adds packs, and logs each game in Shipments.
// - Count the back: sets the packs on hand to what was counted, and logs any difference in
//   ReserveAdjustments (reason "count").
// - Remove packs: takes packs out (returned, damaged…), logged in ReserveAdjustments.
// A game's price and pack size are entered once; the pack size defaults to the standard one.

const REMOVE_REASONS = ['returned', 'damaged', 'stolen', 'other'];

function listBackStock() {
  const live = readTable(monthSheet('SlotState')).filter((s) => s.pack_key);
  return readTable(monthSheet('ReserveInventory'))
    .map((r) => {
      const price = Number(r.price_per_ticket);
      const size = Number(r.tickets_per_pack);
      const packs = packsInBack(r);
      return {
        gameNumber: String(r.game_number),
        price,
        ticketsPerPack: size,
        standardPackSize: STANDARD_PACK_SIZES[price] || null,
        packsInBack: packs,
        ticketsInBack: packs * size,
        valueInBack: packs * size * price,
        liveSlots: live.filter((s) => String(s.game_number) === String(r.game_number)).length,
      };
    })
    .sort((a, b) => b.price - a.price || a.gameNumber.localeCompare(b.gameNumber));
}

// lines: [{ gameNumber, packs, gamePrice?, ticketsPerPack? }] — price (and optionally pack size)
// only for a game not set up yet.
function saveBackStock(user, mode, lines, notes) {
  if (!['shipment', 'count'].includes(mode)) throw new ApiError('bad_request', 'Unknown back stock action.');
  if (!Array.isArray(lines) || lines.length === 0) throw new ApiError('bad_request', 'Scan at least one game.');
  return withLock(() => {
    // Check every line before writing anything.
    const seen = new Set();
    const checked = lines.map((line) => {
      const gameNumber = String(line.gameNumber || '');
      if (!/^\d{4}$/.test(gameNumber)) throw new ApiError('bad_request', `"${gameNumber}" isn't a game number.`);
      if (seen.has(gameNumber)) throw new ApiError('bad_request', `Game ${gameNumber} is listed twice.`);
      seen.add(gameNumber);
      const packs = Number(line.packs);
      const ok = Number.isInteger(packs) && (mode === 'shipment' ? packs > 0 : packs >= 0) && packs <= 999;
      if (!ok) throw new ApiError('bad_count', `Game ${gameNumber}: enter a number of packs${mode === 'shipment' ? ' above 0' : ''}.`);
      const reserve = findReserve(gameNumber);
      if (!reserve) {
        const price = Number(line.gamePrice);
        if (!(price > 0)) throw new ApiError('unknown_game', `Game ${gameNumber} is new. Enter its ticket price.`);
        const size = line.ticketsPerPack === '' || line.ticketsPerPack == null ? STANDARD_PACK_SIZES[price] : Number(line.ticketsPerPack);
        if (!Number.isInteger(size) || size <= 0) throw new ApiError('unknown_game', `Game ${gameNumber}: enter how many tickets are in a pack.`);
      }
      return { gameNumber, packs, line };
    });

    const today = todayLabel();
    const reserveSheet = monthSheet('ReserveInventory');
    const results = checked.map(({ gameNumber, packs, line }) => {
      const reserve = findReserve(gameNumber) || addGameToReserve(user, gameNumber, line.gamePrice, line.ticketsPerPack);
      const size = Number(reserve.tickets_per_pack);
      const price = Number(reserve.price_per_ticket);
      const before = packsInBack(reserve);
      const after = mode === 'shipment' ? before + packs : packs;
      updateRowsWhere(reserveSheet, (r) => String(r.game_number) === gameNumber, {
        packs_in_reserve: after,
        tickets_in_reserve: after * size,
      });
      if (mode === 'shipment') {
        appendObject(monthSheet('Shipments'), {
          shipment_date: today,
          game_number: gameNumber,
          price_per_ticket: price,
          tickets_per_pack: size,
          packs_received: packs,
          tickets_received: packs * size,
          source: 'delivery',
          notes: String(notes || ''),
          performed_by: user.username,
        });
      } else if (after !== before) {
        appendObject(monthSheet('ReserveAdjustments'), {
          adjustment_date: today,
          game_number: gameNumber,
          packs_removed: before - after, // negative when the count found more
          tickets_removed: (before - after) * size,
          reason: 'count',
          notes: String(notes || ''),
          performed_by: user.username,
        });
      }
      return { gameNumber, before, after };
    });
    return { results, backStock: listBackStock() };
  });
}

function removeBackStock(user, req) {
  const gameNumber = String(req.gameNumber || '');
  const packs = Number(req.packs);
  if (!REMOVE_REASONS.includes(req.reason)) throw new ApiError('bad_request', 'Pick a reason.');
  if (!Number.isInteger(packs) || packs <= 0) throw new ApiError('bad_count', 'Enter how many packs to remove.');
  return withLock(() => {
    const reserve = findReserve(gameNumber);
    if (!reserve) throw new ApiError('unknown_game', `Game ${gameNumber} isn't in back stock.`);
    const before = packsInBack(reserve);
    if (packs > before) throw new ApiError('bad_count', `There ${before === 1 ? 'is' : 'are'} only ${before} pack${before === 1 ? '' : 's'} of game ${gameNumber} in the back.`);
    const size = Number(reserve.tickets_per_pack);
    updateRowsWhere(monthSheet('ReserveInventory'), (r) => String(r.game_number) === gameNumber, {
      packs_in_reserve: before - packs,
      tickets_in_reserve: (before - packs) * size,
    });
    appendObject(monthSheet('ReserveAdjustments'), {
      adjustment_date: todayLabel(),
      game_number: gameNumber,
      packs_removed: packs,
      tickets_removed: packs * size,
      reason: req.reason,
      notes: String(req.notes || ''),
      performed_by: user.username,
    });
    return listBackStock();
  });
}
