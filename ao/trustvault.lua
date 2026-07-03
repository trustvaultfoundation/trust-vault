-- trustvault.lua
-- A per-wallet, ENCRYPTED key/value store for every TrustVault module — the durable,
-- cache-independent source of truth that replaces localStorage.
--
-- Security model:
--   • The process NEVER sees plaintext. Clients send CIPHERTEXT (encrypted with the
--     owner's vault master key); confidentiality is entirely client-side.
--   • Writes are authenticated: AO verifies the data-item signature, so msg.From is the
--     real wallet address and a caller can only write its OWN space.
--   • Reads (dryrun) are PUBLIC — never put anything sensitive here unencrypted.
--
-- State.users[address][module][key] = { v = <ciphertext>, u = <updatedAt ms> }

local json = require("json")

State = State or { users = {} }

-- Modules the store accepts (so a typo can't create junk namespaces).
local MODULES = {
  vault = true, boards = true, boardstate = true, docs = true,
  chats = true, chatstate = true, calendar = true, keys = true,
  settings = true, dashboard = true, keywrap = true, grants = true,
}

local function userOf(addr)
  State.users[addr] = State.users[addr] or {}
  return State.users[addr]
end

local function reply(msg, action, data)
  ao.send({ Target = msg.From, Action = action, Data = data or "ok" })
end

-- PUT  Tags: Module, Key   Data: ciphertext   → upsert into caller's own space.
Handlers.add("Put", Handlers.utils.hasMatchingTag("Action", "Put"), function(msg)
  local m, k = msg.Tags.Module, msg.Tags.Key
  assert(MODULES[m], "unknown module: " .. tostring(m))
  assert(k ~= nil and #k > 0, "missing Key")
  local u = userOf(msg.From)
  u[m] = u[m] or {}
  u[m][k] = { v = msg.Data or "", u = tonumber(msg.Timestamp) or 0 }
  reply(msg, "Result", "ok")
end)

-- DELETE  Tags: Module, Key
Handlers.add("Delete", Handlers.utils.hasMatchingTag("Action", "Delete"), function(msg)
  local u = userOf(msg.From)
  if u[msg.Tags.Module] then u[msg.Tags.Module][msg.Tags.Key] = nil end
  reply(msg, "Result", "ok")
end)

-- GET-STATE  Tags: Address?  → the whole blob for one wallet (used on app load via
-- dryrun; unsigned — the Address tag says whose state to return, content is encrypted).
Handlers.add("Get-State", Handlers.utils.hasMatchingTag("Action", "Get-State"), function(msg)
  local addr = msg.Tags.Address or msg.From
  reply(msg, "State", json.encode(State.users[addr] or {}))
end)

-- GET  Tags: Address?, Module, Key  → one record (for cross-wallet shared reads).
Handlers.add("Get", Handlers.utils.hasMatchingTag("Action", "Get"), function(msg)
  local u = State.users[msg.Tags.Address or msg.From] or {}
  local rec = (u[msg.Tags.Module] or {})[msg.Tags.Key]
  reply(msg, "Record", rec and rec.v or "")
end)

-- INFO  → quick health/size check (handy from `aos`).
Handlers.add("Info", Handlers.utils.hasMatchingTag("Action", "Info"), function(msg)
  local n = 0
  for _ in pairs(State.users) do n = n + 1 end
  reply(msg, "Info", json.encode({ name = "TrustVault Store", users = n }))
end)
