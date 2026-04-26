create table if not exists public.payment_attempts (
  id text primary key,
  order_reference text not null,
  user_id text not null,
  customer_name text not null,
  customer_email text,
  amount numeric not null,
  currency text not null default 'INR',
  payment_method text not null,
  billing_country text,
  ip_country text,
  device_id text,
  card_network text,
  card_last4 text,
  masked_card text,
  status text not null,
  final_risk_score numeric,
  ml_risk_score numeric,
  rule_risk_score numeric,
  fraud_decision_id text,
  selected_gateway text,
  fallback_gateways jsonb default '[]'::jsonb,
  current_gateway_index integer,
  decision_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists payment_attempts_order_reference_idx
  on public.payment_attempts (order_reference);

create index if not exists payment_attempts_user_id_created_at_idx
  on public.payment_attempts (user_id, created_at desc);

create table if not exists public.fraud_decisions (
  id text primary key,
  payment_attempt_id text not null,
  model_score numeric not null,
  rule_score numeric not null,
  final_risk_score numeric not null,
  model_prediction integer not null,
  model_service_status text not null,
  decision_action text not null,
  decision_reason text not null,
  rule_reasons jsonb default '[]'::jsonb,
  history_summary jsonb default '{}'::jsonb,
  hard_threshold numeric not null,
  review_threshold numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists fraud_decisions_payment_attempt_id_idx
  on public.fraud_decisions (payment_attempt_id);

create table if not exists public.gateway_evaluations (
  id text primary key,
  payment_attempt_id text not null,
  gateway_key text not null,
  gateway_name text not null,
  success_rate numeric not null,
  avg_latency_ms integer not null,
  fee_bps numeric not null,
  health_score numeric not null,
  route_score numeric not null,
  supports_international boolean not null default false,
  selected boolean not null default false,
  fallback_rank integer not null,
  routing_reason text,
  created_at timestamptz not null default now()
);

create index if not exists gateway_evaluations_payment_attempt_id_idx
  on public.gateway_evaluations (payment_attempt_id);

create table if not exists public.gateway_transactions (
  id text primary key,
  payment_attempt_id text not null,
  gateway_key text not null,
  gateway_name text not null,
  gateway_reference text not null,
  status text not null,
  fallback_rank integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists gateway_transactions_payment_attempt_id_idx
  on public.gateway_transactions (payment_attempt_id);

create table if not exists public.audit_logs (
  id text primary key,
  payment_attempt_id text,
  event_type text not null,
  event_message text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_payment_attempt_id_idx
  on public.audit_logs (payment_attempt_id, created_at desc);
