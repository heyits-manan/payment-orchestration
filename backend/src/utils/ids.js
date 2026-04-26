const crypto = require("crypto");

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  createId,
  nowIso,
};
