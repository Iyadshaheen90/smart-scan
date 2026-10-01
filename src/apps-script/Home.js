// The owner's home page in one request. Each request to the Web App costs about 2 seconds however
// little it does, so home asks for everything at once instead of one request per number.

// { today, closed, slots } as closeStatus gives them, plus:
// month: monthStatus(); monthDollars: sold this month so far; backValue: $ of packs in the back;
// fullPacks: { count, dollars } of full packs sold this month;
// lastClose: this month's last closed day, or last month's when none yet (null when there's none).
function ownerHome(user) {
  const status = closeStatus(user);
  const month = monthStatus();
  const summary = monthSummary(month.current);
  let lastClose = summary.days.length ? summary.days[summary.days.length - 1] : null;
  if (!lastClose) {
    const earlier = listMonths().find((m) => m.label < month.current);
    const before = earlier ? monthSummary(earlier.label) : null;
    lastClose = before && before.days.length ? before.days[before.days.length - 1] : null;
  }
  const backValue = readTable(monthSheet('ReserveInventory'))
    .reduce((sum, r) => sum + packsInBack(r) * (Number(r.tickets_per_pack) || 0) * (Number(r.price_per_ticket) || 0), 0);
  return { ...status, month, monthDollars: summary.dollarsSold, fullPacks: summary.fullPacks, lastClose, backValue };
}
