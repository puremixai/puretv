function canResumeRoom(room, username, ownerToken) {
  return (
    !!ownerToken &&
    ownerToken === room.ownerToken &&
    username === room.ownerName
  );
}

function roomForList(room) {
  const { ownerToken: _ownerToken, password, ...publicRoom } = room;
  // Existing clients use password truthiness to display the password prompt.
  return { ...publicRoom, password: password ? '********' : undefined };
}

module.exports = { canResumeRoom, roomForList };
