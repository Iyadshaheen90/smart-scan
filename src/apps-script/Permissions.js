// Employee permissions: what the owner lets one employee do beyond Close Day and viewing Slots.

// What the owner can let one employee do, toggled on Manage employees (owner's request 2026-10-08, e.g.
// while travelling). Saved as a comma list in Users.permissions. The owner can always do all of it, and an
// employee never sees dollar amounts whatever is on.
// ticket_order (2026-10-08): set a slot (while empty) or all slots to descending/ascending.
const PERMISSIONS = ['load_packs', 'return_packs', 'receive_shipments', 'count_stock', 'full_pack_sale', 'ticket_order'];

// An employee's permissions as a list (empty for a Users row from before the column existed).
function permissionsOf(user) {
  return String(user.permissions || '').split(',').map((p) => p.trim()).filter((p) => PERMISSIONS.includes(p));
}

// The owner can do everything; an employee only what the owner turned on for them.
function can(user, permission) {
  return user.role === 'owner' || (user.permissions || []).includes(permission);
}

function requirePermission(user, permission, message) {
  if (!can(user, permission)) throw new ApiError('forbidden', message);
}
