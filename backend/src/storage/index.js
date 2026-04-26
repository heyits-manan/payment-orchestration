const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { LOCAL_STORE_PATH, STORAGE_DRIVER } = require("../config");
const { createId, nowIso } = require("../utils/ids");

const schema = {
  payment_attempts: [],
  fraud_decisions: [],
  gateway_evaluations: [],
  gateway_transactions: [],
  audit_logs: [],
};

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

let supabase = null;
let supabaseLoadError = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && STORAGE_DRIVER !== "local") {
  try {
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

function ensureLocalStore() {
  const dir = path.dirname(LOCAL_STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_STORE_PATH)) {
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(schema, null, 2));
  }
}

function readLocalStore() {
  ensureLocalStore();
  const raw = fs.readFileSync(LOCAL_STORE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...schema,
    ...parsed,
  };
}

function writeLocalStore(data) {
  ensureLocalStore();
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2));
}

function getStorageStatus() {
  return {
    configured_driver: STORAGE_DRIVER,
    active_driver: supabase ? "supabase" : "local",
    supabase_configured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    supabase_connected: Boolean(supabase),
    local_store_path: LOCAL_STORE_PATH,
    load_error: supabaseLoadError ? supabaseLoadError.message : null,
  };
}

async function useSupabase(operation, fallback) {
  if (!supabase) {
    return fallback();
  }

  try {
    return await operation();
  } catch (_error) {
    return fallback();
  }
}

async function insertRecord(table, record) {
  const enriched = {
    id: record.id || createId(table.slice(0, -1)),
    created_at: record.created_at || nowIso(),
    ...record,
  };

  return useSupabase(
    async () => {
      const { error } = await supabase.from(table).insert(enriched);
      if (error) {
        throw error;
      }
      return { source: "supabase", record: enriched };
    },
    async () => {
      const store = readLocalStore();
      store[table].push(enriched);
      writeLocalStore(store);
      return { source: "local", record: enriched };
    }
  );
}

async function updateRecord(table, id, patch) {
  return useSupabase(
    async () => {
      const { data, error } = await supabase
        .from(table)
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        throw error;
      }
      return { source: "supabase", record: data };
    },
    async () => {
      const store = readLocalStore();
      const index = store[table].findIndex((item) => item.id === id);
      if (index === -1) {
        return { source: "local", record: null };
      }
      store[table][index] = {
        ...store[table][index],
        ...patch,
        updated_at: nowIso(),
      };
      writeLocalStore(store);
      return { source: "local", record: store[table][index] };
    }
  );
}

async function listRecords(table) {
  return useSupabase(
    async () => {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        throw error;
      }
      return { source: "supabase", records: data || [] };
    },
    async () => {
      const store = readLocalStore();
      return { source: "local", records: store[table] || [] };
    }
  );
}

async function getRecordById(table, id) {
  return useSupabase(
    async () => {
      const { data, error } = await supabase.from(table).select("*").eq("id", id).single();
      if (error) {
        throw error;
      }
      return { source: "supabase", record: data };
    },
    async () => {
      const store = readLocalStore();
      return {
        source: "local",
        record: (store[table] || []).find((item) => item.id === id) || null,
      };
    }
  );
}

async function findPaymentAttemptByOrderReference(orderReference) {
  const { records } = await listRecords("payment_attempts");
  return (
    records.find(
      (item) =>
        item.order_reference === orderReference &&
        !["failed", "cancelled", "success"].includes(item.status)
    ) || null
  );
}

async function listPaymentAttempts(limit = 50) {
  const { records, source } = await listRecords("payment_attempts");
  const sorted = [...records].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
  return { source, records: sorted.slice(0, limit) };
}

async function fetchUserTransactionSummary(userId) {
  const { records } = await listRecords("payment_attempts");
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const userRecords = records
    .filter((record) => record.user_id === userId)
    .filter((record) => new Date(record.created_at).getTime() >= since);

  const totalAmount = userRecords.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const successful = userRecords.filter((row) => row.status === "success");

  return {
    source: supabase ? "supabase_or_local_fallback" : "local",
    transactions24h: userRecords.length,
    blocked24h: userRecords.filter((row) => row.status === "blocked").length,
    failed24h: userRecords.filter((row) => row.status === "failed").length,
    avgAmount: userRecords.length ? totalAmount / userRecords.length : 0,
    successfulAvgAmount: successful.length
      ? successful.reduce((sum, row) => sum + Number(row.amount || 0), 0) / successful.length
      : 0,
    lastTransactionAmount: userRecords.length ? Number(userRecords[0].amount || 0) : 0,
    billingCountries: [...new Set(userRecords.map((row) => String(row.billing_country || "").toUpperCase()).filter(Boolean))],
    ipCountries: [...new Set(userRecords.map((row) => String(row.ip_country || "").toUpperCase()).filter(Boolean))],
    paymentMethods: [...new Set(userRecords.map((row) => row.payment_method).filter(Boolean))],
    devices: [...new Set(userRecords.map((row) => row.device_id).filter(Boolean))],
  };
}

async function logAudit(event) {
  return insertRecord("audit_logs", event);
}

async function getDashboardSnapshot() {
  const [{ records: attempts }, { records: evaluations }, { records: decisions }, { records: gatewayTxns }] =
    await Promise.all([
      listRecords("payment_attempts"),
      listRecords("gateway_evaluations"),
      listRecords("fraud_decisions"),
      listRecords("gateway_transactions"),
    ]);

  const approved = attempts.filter((row) => ["approved", "routed", "processing", "success"].includes(row.status));
  const blocked = attempts.filter((row) => row.status === "blocked");
  const review = attempts.filter((row) => row.status === "review_required");
  const success = attempts.filter((row) => row.status === "success");
  const failed = attempts.filter((row) => row.status === "failed");

  const summary = {
    total_transactions: attempts.length,
    blocked_transactions: blocked.length,
    review_transactions: review.length,
    successful_transactions: success.length,
    failed_transactions: failed.length,
    approval_rate: attempts.length ? Number((approved.length / attempts.length).toFixed(4)) : 0,
    success_rate: attempts.length ? Number((success.length / attempts.length).toFixed(4)) : 0,
    average_risk_score: attempts.length
      ? Number(
          (
            attempts.reduce((sum, row) => sum + Number(row.final_risk_score || 0), 0) / attempts.length
          ).toFixed(4)
        )
      : 0,
    total_volume: Number(
      attempts.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)
    ),
  };

  const gatewayPerformanceMap = {};
  for (const row of evaluations) {
    if (!gatewayPerformanceMap[row.gateway_key]) {
      gatewayPerformanceMap[row.gateway_key] = {
        gateway_key: row.gateway_key,
        gateway_name: row.gateway_name,
        evaluated_count: 0,
        selected_count: 0,
        total_latency_ms: 0,
        total_success_rate: 0,
      };
    }
    gatewayPerformanceMap[row.gateway_key].evaluated_count += 1;
    gatewayPerformanceMap[row.gateway_key].selected_count += row.selected ? 1 : 0;
    gatewayPerformanceMap[row.gateway_key].total_latency_ms += Number(row.avg_latency_ms || 0);
    gatewayPerformanceMap[row.gateway_key].total_success_rate += Number(row.success_rate || 0);
  }

  const gatewayPerformance = Object.values(gatewayPerformanceMap).map((item) => ({
    gateway_key: item.gateway_key,
    gateway_name: item.gateway_name,
    evaluated_count: item.evaluated_count,
    selected_count: item.selected_count,
    avg_latency_ms: item.evaluated_count
      ? Math.round(item.total_latency_ms / item.evaluated_count)
      : 0,
    avg_success_rate: item.evaluated_count
      ? Number((item.total_success_rate / item.evaluated_count).toFixed(2))
      : 0,
  }));

  const fraudReasonsMap = {};
  for (const decision of decisions) {
    for (const reason of decision.rule_reasons || []) {
      fraudReasonsMap[reason] = (fraudReasonsMap[reason] || 0) + 1;
    }
  }

  const topFraudReasons = Object.entries(fraudReasonsMap)
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  return {
    summary,
    recent_attempts: attempts
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice(0, 20),
    gateway_performance: gatewayPerformance.sort((left, right) => right.selected_count - left.selected_count),
    top_fraud_reasons: topFraudReasons,
    gateway_transactions: gatewayTxns
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice(0, 20),
  };
}

module.exports = {
  getStorageStatus,
  insertRecord,
  updateRecord,
  getRecordById,
  listRecords,
  listPaymentAttempts,
  findPaymentAttemptByOrderReference,
  fetchUserTransactionSummary,
  logAudit,
  getDashboardSnapshot,
};
