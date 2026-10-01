// Full pack sales — owner only. A customer buys a whole sealed pack straight from the back; it never
// goes into a slot. The owner scans a ticket from it, so the game and pack number are known.
//
// - One pack comes off the game's back stock at once (never below 0: a game with none in the back is refused).
// - The sale is a DailyCloseLog row (close_type 'full_pack', no box or slot) dated salesDate(), so it is in
//   that day's totals like a mid-day sold out, and is listed on its own on the owner's Full packs page.
// - A PackHistory row (end_reason 'full_pack_sale') makes activatePack refuse that pack later.
// - Each month's list starts empty (the log rows stay in the month they were sold); back stock carries over.

const FULL_PACK_TYPE = 'full_pack';

function sellFullPack(user, req) {
  const gameNumber = String(req.gameNumber || '');
  const packNumber = String(req.packNumber || '');
  if (!/^\d{4}$/.test(gameNumber) || !/^\d+$/.test(packNumber)) {
    throw new ApiError('bad_request', 'Scan a ticket from the pack (the game and pack number are needed).');
  }
  const packKey = `${gameNumber}-${packNumber}`;
  return withLock(() => {
    const reserve = findReserve(gameNumber);
    if (!reserve) throw new ApiError('unknown_game', `Game ${gameNumber} isn't in back stock. Receive the shipment first.`);
    const before = packsInBack(reserve);
    if (before < 1) throw new ApiError('none_in_back', `There are no packs of game ${gameNumber} in the back. Receive the shipment first.`);
    const live = readTable(monthSheet('SlotState')).find((s) => s.pack_key === packKey);
    if (live) throw new ApiError('pack_in_use', `Pack ${packKey} is live in box ${live.box}, slot ${live.slot_number}.`);
    if (readTable(monthSheet('PackHistory')).some((p) => `${p.game_number}-${p.pack_number}` === packKey)) {
      throw new ApiError('pack_ended', `Pack ${packKey} was already sold out, returned or sold as a full pack.`);
    }

    const size = Number(reserve.tickets_per_pack);
    const price = Number(reserve.price_per_ticket);
    const date = salesDate();
    updateRowsWhere(monthSheet('ReserveInventory'), (r) => String(r.game_number) === gameNumber, {
      packs_in_reserve: before - 1,
      tickets_in_reserve: (before - 1) * size,
    });
    appendObject(closeLogSheet(), {
      close_date: date,
      box: '',
      slot_number: '',
      pack_key: packKey,
      previous_exposed_ticket_number: size - 1,
      current_exposed_ticket_number: '',
      tickets_sold: size,
      price_per_ticket: price,
      dollars_sold: size * price,
      remaining_after_close: 0,
      close_type: FULL_PACK_TYPE,
      late_activation: false,
      performed_by: user.username,
      previous_close_date: '',
      logged_at: nowStamp(),
    });
    appendObject(monthSheet('PackHistory'), {
      game_number: gameNumber,
      pack_number: packNumber,
      box: '',
      slot_number: '',
      price_per_ticket: price,
      activation_date: date,
      end_date: date,
      end_reason: 'full_pack_sale',
      final_tickets_sold_total: size,
      remaining_at_return: 0,
      total_dollars_sold: size * price,
      performed_by: user.username,
    });
    return { packKey, gameNumber, packNumber, date, price, ticketsPerPack: size, dollars: size * price,
      before, after: before - 1, backStock: listBackStock() };
  });
}

// Puts a full pack sale back (pack returns to the back), while its sales day isn't closed yet.
function undoFullPackSale(req) {
  const packKey = String(req.packKey || '');
  return withLock(() => {
    const isSale = (r) => r.pack_key === packKey && r.close_type === FULL_PACK_TYPE;
    const sale = readTable(monthSheet('DailyCloseLog')).find(isSale);
    if (!sale) throw new ApiError('nothing_to_undo', `Pack ${packKey} wasn't sold as a full pack this month.`);
    if (summaryOn(dateLabel(sale.close_date))) {
      throw new ApiError('already_closed', "That day's close already counted this sale, so it can't be undone.");
    }
    const gameNumber = packKey.split('-')[0];
    const reserve = findReserve(gameNumber);
    const after = packsInBack(reserve) + 1;
    updateRowsWhere(monthSheet('ReserveInventory'), (r) => String(r.game_number) === gameNumber, {
      packs_in_reserve: after,
      tickets_in_reserve: after * Number(reserve.tickets_per_pack),
    });
    deleteRowsWhere(monthSheet('DailyCloseLog'), isSale);
    deleteRowsWhere(monthSheet('PackHistory'),
      (p) => `${p.game_number}-${p.pack_number}` === packKey && p.end_reason === 'full_pack_sale');
    return { packKey, after, sales: listFullPackSales() };
  });
}

// This month's full pack sales, newest first, with the month's count and $ total.
function listFullPackSales() {
  const rows = readTable(monthSheet('DailyCloseLog')).filter((r) => r.close_type === FULL_PACK_TYPE);
  const sales = rows.map((r) => {
    const [gameNumber, packNumber] = String(r.pack_key).split('-');
    const date = dateLabel(r.close_date);
    return {
      date,
      packKey: String(r.pack_key),
      gameNumber,
      packNumber,
      price: Number(r.price_per_ticket),
      ticketsPerPack: Number(r.tickets_sold),
      dollars: Number(r.dollars_sold),
      soldBy: String(r.performed_by || ''),
      canUndo: !summaryOn(date),
    };
  }).reverse().sort((a, b) => b.date.localeCompare(a.date));
  return { ...fullPackTotals(rows), sales };
}

// { count, dollars } of the full pack sale rows in a DailyCloseLog.
function fullPackTotals(logRows) {
  const sales = logRows.filter((r) => r.close_type === FULL_PACK_TYPE);
  return { count: sales.length, dollars: sales.reduce((sum, r) => sum + (Number(r.dollars_sold) || 0), 0) };
}
