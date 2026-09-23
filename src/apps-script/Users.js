// Owner-only employee management, plus changing your own password.

function addUser(username, password, role) {
  if (findUser(username)) throw new ApiError('user_exists', `The username "${username}" is already taken.`);
  const salt = Utilities.getUuid();
  const user = {
    username,
    password_hash: hashPassword(password, salt),
    salt,
    role,
    active: true,
    created_date: new Date(),
  };
  appendObject(monthSheet('Users'), user);
  return user;
}

function listUsers() {
  return readTable(monthSheet('Users')).map((u) => ({
    username: u.username,
    role: u.role,
    active: u.active === true,
    createdDate: u.created_date ? new Date(u.created_date).toISOString() : null,
  }));
}

function createUser(username, password, role = 'employee') {
  username = normalizeUsername(username);
  if (!ROLES.includes(role)) throw new ApiError('bad_role', 'Unknown role.');
  validateNewCredentials(username, password);
  withLock(() => addUser(username, password, role));
  return listUsers();
}

function setUserActive(currentUser, username, active) {
  username = normalizeUsername(username);
  if (username === currentUser.username) throw new ApiError('self', "You can't deactivate your own account.");
  withLock(() => {
    if (!updateRowsWhere(monthSheet('Users'), (u) => u.username === username, { active: active === true })) {
      throw new ApiError('no_user', 'No such user.');
    }
    if (active !== true) endSessionsFor(username);
  });
  return listUsers();
}

function resetPassword(username, newPassword) {
  username = normalizeUsername(username);
  validateNewPassword(newPassword);
  withLock(() => {
    const salt = Utilities.getUuid();
    const changes = { salt, password_hash: hashPassword(newPassword, salt) };
    if (!updateRowsWhere(monthSheet('Users'), (u) => u.username === username, changes)) {
      throw new ApiError('no_user', 'No such user.');
    }
    endSessionsFor(username);
  });
  return listUsers();
}

function changeOwnPassword(currentUser, currentPassword, newPassword) {
  const user = findUser(currentUser.username);
  if (!verifyPassword(String(currentPassword || ''), user.salt, user.password_hash)) {
    throw new ApiError('bad_password', 'Your current password is wrong.');
  }
  validateNewPassword(newPassword);
  withLock(() => {
    const salt = Utilities.getUuid();
    updateRowsWhere(monthSheet('Users'), (u) => u.username === user.username, { salt, password_hash: hashPassword(newPassword, salt) });
  });
  return {};
}
