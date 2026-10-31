-- Approved documents are locked: their content and hash can never change silently.
-- Deletes are still allowed (application delete / "delete all my data").
CREATE OR REPLACE FUNCTION document_approved_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'document % v% is approved and immutable', OLD.kind, OLD.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_approved_immutable
  BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION document_approved_immutable();
