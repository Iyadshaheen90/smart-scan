// The store's CA Lottery retailer number (owner 2026-10-26): the lottery's account number for the store, printed on the
// Theft Report. It's sensitive, so it's kept in the script's private settings (Script Properties, which only the
// script's owner account can open; Google keeps them encrypted), never in a sheet (more people can open those) and never
// in the code (public on GitHub). Only the owner can see or change it in the app (More → Retailer Number). The Theft
// Report shows it in full to whoever makes it, employees with Theft Report too (owner's choice).

const RETAILER_NUMBER_PROPERTY = 'RETAILER_NUMBER';

function retailerNumber() {
  return PropertiesService.getScriptProperties().getProperty(RETAILER_NUMBER_PROPERTY) || null;
}

function getRetailerNumber() {
  return { retailerNumber: retailerNumber() };
}

// Digits only; spaces and dashes typed with it are dropped.
function setRetailerNumber(value) {
  const number = String(value == null ? '' : value).replace(/[\s-]/g, '');
  if (!/^\d{4,12}$/.test(number)) {
    throw new ApiError('bad_retailer_number', 'Enter the retailer number: digits only, as on your lottery terminal.');
  }
  PropertiesService.getScriptProperties().setProperty(RETAILER_NUMBER_PROPERTY, number);
  return { retailerNumber: number };
}
