-- credit_ledger is an append-only journal: a balance is always SUM(delta), and
-- history must never be rewritten. Application code can be careless, so the
-- rule is enforced by the database itself.
--
-- The trigger raises on any row-level UPDATE or DELETE. An org's credits can be
-- corrected by appending an 'adjustment' or 'refund' entry, never by editing.

CREATE OR REPLACE FUNCTION credit_ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'credit_ledger is append-only: % is not allowed. Append an adjustment or refund entry instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_update
  BEFORE UPDATE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_delete
  BEFORE DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_reject_mutation();
--> statement-breakpoint
-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level guard.
CREATE TRIGGER credit_ledger_no_truncate
  BEFORE TRUNCATE ON credit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION credit_ledger_reject_mutation();
