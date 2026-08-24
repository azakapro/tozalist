CREATE TYPE "public"."batch_status" AS ENUM('pending', 'validating', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('grant', 'single_check', 'batch_check', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."email_verdict" AS ENUM('valid', 'invalid', 'risky', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('landing_pilot', 'landing_contact', 'landing_checklist');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"smtp_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"mfa_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"reference_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"email_hash" text NOT NULL,
	"verdict" "email_verdict" NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"checks_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"e164" text,
	"input_hash" text NOT NULL,
	"valid" boolean NOT NULL,
	"country" text,
	"line_type_guess" text,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"status" "batch_status" DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"error" text,
	"input_object_key" text NOT NULL,
	"result_object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"actor_api_key_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"phone" text,
	"message" text,
	"source" "lead_source" NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_checks" ADD CONSTRAINT "email_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_checks" ADD CONSTRAINT "phone_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_api_key_id_api_keys_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_deleted_at_idx" ON "organizations" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "users_deleted_at_idx" ON "users" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "api_keys_org_id_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "api_keys_revoked_at_idx" ON "api_keys" USING btree ("revoked_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_id_created_at_idx" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_org_id_reference_id_uniq" ON "credit_ledger" USING btree ("org_id","reference_id") WHERE "credit_ledger"."reference_id" is not null;--> statement-breakpoint
CREATE INDEX "email_checks_org_id_email_hash_created_at_idx" ON "email_checks" USING btree ("org_id","email_hash","created_at");--> statement-breakpoint
CREATE INDEX "email_checks_email_hash_idx" ON "email_checks" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "email_checks_expires_at_idx" ON "email_checks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "phone_checks_org_id_input_hash_idx" ON "phone_checks" USING btree ("org_id","input_hash");--> statement-breakpoint
CREATE INDEX "phone_checks_expires_at_idx" ON "phone_checks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "batches_org_id_created_at_idx" ON "batches" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "batches_expires_at_idx" ON "batches" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "batches_status_idx" ON "batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_id_idx" ON "webhook_endpoints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_deleted_at_idx" ON "webhook_endpoints" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_id_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_expires_at_idx" ON "webhook_deliveries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_events_org_id_created_at_idx" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_api_key_id_idx" ON "audit_events" USING btree ("actor_api_key_id");--> statement-breakpoint
CREATE INDEX "audit_events_expires_at_idx" ON "audit_events" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_expires_at_idx" ON "leads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "leads_deleted_at_idx" ON "leads" USING btree ("deleted_at");