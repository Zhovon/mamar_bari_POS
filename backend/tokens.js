const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_mamar_bari_key';

// --- Table QR token ---------------------------------------------------------
// Signed, NO expiry: it is printed once and taped to the table. Safe because it
// only names a table; it never grants ordering by itself. A customer must
// exchange it for a short-lived session, and the table id is only ever read
// from these verified payloads -- never from a URL query or request body.
function makeTableToken(tableId) {
  return jwt.sign({ tid: tableId, typ: 'table' }, JWT_SECRET);
}

function readTableToken(token) {
  const payload = jwt.verify(token, JWT_SECRET); // throws on tamper/bad sig
  if (payload.typ !== 'table') throw new Error('wrong token type');
  return payload.tid;
}

// --- Customer table session -------------------------------------------------
// Short-lived. Issued after a valid table token is presented. Carries the
// table id so the order endpoint can trust it without the client supplying one.
function makeTableSession(tableId, sessionVersion) {
  return jwt.sign({ tid: tableId, sv: sessionVersion, typ: 'table_session' }, JWT_SECRET, {
    expiresIn: '3h',
  });
}

function readTableSession(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.typ !== 'table_session') throw new Error('wrong token type');
  return { tableId: payload.tid, sessionVersion: payload.sv };
}

module.exports = {
  makeTableToken,
  readTableToken,
  makeTableSession,
  readTableSession,
};
