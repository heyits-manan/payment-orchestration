const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_TABLE = process.env.SUPABASE_TRANSACTIONS_TABLE || "transactions";

let supabase = null;
let supabaseLoadError = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = require("@supabase/supabase-js");
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  } catch (error) {
    supabaseLoadError = error;
  }
}

function getSupabaseStatus() {
  return {
    configured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    connected: Boolean(supabase),
    table: SUPABASE_TABLE,
    load_error: supabaseLoadError ? supabaseLoadError.message : null,
  };
}

async function fetchUserTransactionSummary(userId) {
  if (!supabase) {
    return {
      source: "disabled",
      transactions24h: 0,
      blocked24h: 0,
      avgAmount: 0,
      lastTransactionAmount: 0,
      billingCountries: [],
      ipCountries: [],
    };
  }

  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("amount,status,billing_country,ip_country,created_at")
    .eq("user_id", userId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const rows = data || [];
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return {
    source: "supabase",
    transactions24h: rows.length,
    blocked24h: rows.filter((row) => row.status === "blocked").length,
    avgAmount: rows.length ? totalAmount / rows.length : 0,
    lastTransactionAmount: rows.length ? Number(rows[0].amount || 0) : 0,
    billingCountries: [...new Set(rows.map((row) => String(row.billing_country || "").toUpperCase()).filter(Boolean))],
    ipCountries: [...new Set(rows.map((row) => String(row.ip_country || "").toUpperCase()).filter(Boolean))],
  };
}

async function insertTransaction(record) {
  if (!supabase) {
    return { persisted: false, source: "disabled" };
  }

  const { error } = await supabase.from(SUPABASE_TABLE).insert(record);
  if (error) {
    throw error;
  }

  return { persisted: true, source: "supabase" };
}

module.exports = {
  fetchUserTransactionSummary,
  getSupabaseStatus,
  insertTransaction,
};
