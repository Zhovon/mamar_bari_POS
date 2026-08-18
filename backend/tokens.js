const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_mamar_bari_key';

// --- Printed table code -----------------------------------------------------
// The QR taped to a table encodes a short, random, opaque code that lives in
// restaurant_tables.qr_code. It is PERMANENT: it never expires, so a printed
// sticker keeps working forever, and it survives a JWT_SECRET rotation (which
// would have killed every printed sticker back when the QR held a JWT).
//
// It is an identity, not an authorisation: it only names a table. A device must
// exchange it for a session, and the table id is only ever read from a verified
// server-side lookup -- never from a URL query or a request body.

// Crockford-style base32, minus I/L/O/U: those get misread off printed paper.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

function generateTableCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

// Cheap shape check so we know whether to try a DB lookup or a JWT verify.
function looksLikeTableCode(value) {
  return typeof value === 'string'
    && value.length === CODE_LENGTH
    && /^[0-9A-HJKMNP-TV-Z]+$/i.test(value);
}

// --- Legacy table QR token --------------------------------------------------
// Stickers printed before migration 05 encode this signed JWT. Kept so nothing
// already on a table stops working. New codes are never issued in this format.
function makeTableToken(tableId) {
  return jwt.sign({ tid: tableId, typ: 'table' }, JWT_SECRET);
}

function readTableToken(token) {
  const payload = jwt.verify(token, JWT_SECRET); // throws on tamper/bad sig
  if (payload.typ !== 'table') throw new Error('wrong token type');
  return payload.tid;
}

// --- Customer device session ------------------------------------------------
// Issued after a valid table code is presented. The token is only a POINTER to
// the table_sessions / session_devices rows -- those rows decide whether it is
// still live, which is what makes per-device revocation instant. The expiry
// here is just a backstop for a phone that never talks to us again.
function makeTableSession({ sessionId, deviceRowId, tableId }) {
  return jwt.sign(
    { sid: sessionId, did: deviceRowId, tid: tableId, typ: 'table_session' },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function readTableSession(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.typ !== 'table_session') throw new Error('wrong token type');
  return { sessionId: payload.sid, deviceRowId: payload.did, tableId: payload.tid };
}

module.exports = {
  generateTableCode,
  looksLikeTableCode,
  makeTableToken,
  readTableToken,
  makeTableSession,
  readTableSession,
};
