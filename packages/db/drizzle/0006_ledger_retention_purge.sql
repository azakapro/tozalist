-- Three-year accounting retention completion (roadmap 7.1).
--
-- credit_ledger stays append-only for the application: UPDATE and TRUNCATE are
-- always rejected, and so is any ordinary DELETE. The single sanctioned
-- exception is the scheduled retention sweep, which must satisfy BOTH gates:
--
--   1. the transaction-local setting tozalist.allow_ledger_purge = 'on'
--      (set with SET LOCAL inside the sweep's transaction only), AND
--   2. the row itself is at least three years old by the database clock.
--
-- A compromised or careless code path that merely sets the flag still cannot
-- touch younger rows, and nothing that forgets the flag can delete anything.

CREATE OR REPLACE FUNCTION credit_ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Nested IF: OLD is only referenced for row-level DELETE, never for the
  -- statement-level TRUNCATE trigger where it is not assigned.
  IF TG_OP = 'DELETE' THEN
    IF current_setting('tozalist.allow_ledger_purge', true) = 'on'
       AND OLD.created_at <= now() - interval '3 years'
    THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION
    'credit_ledger is append-only: % is not allowed. Append an adjustment or refund entry instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
