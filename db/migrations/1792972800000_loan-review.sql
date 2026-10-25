-- Up Migration
ALTER TABLE loan_applications DROP CONSTRAINT loan_applications_status_check;
ALTER TABLE loan_applications
  ADD COLUMN reviewed_by UUID REFERENCES users(id),
  ADD COLUMN review_reason TEXT,
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD CONSTRAINT loan_applications_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD CONSTRAINT loan_applications_review_check CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND review_reason IS NULL AND reviewed_at IS NULL)
    OR
    (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL
      AND reviewed_by <> user_id AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL
      AND char_length(btrim(review_reason)) BETWEEN 10 AND 500)
  );

-- Down Migration
-- Never silently destroy decisions to roll back the schema.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM loan_applications WHERE status <> 'pending') THEN
    RAISE EXCEPTION 'Cannot undo loan review migration while reviewed applications exist';
  END IF;
END $$;
ALTER TABLE loan_applications
  DROP CONSTRAINT loan_applications_review_check,
  DROP CONSTRAINT loan_applications_status_check,
  DROP COLUMN reviewed_by,
  DROP COLUMN review_reason,
  DROP COLUMN reviewed_at,
  ADD CONSTRAINT loan_applications_status_check CHECK (status = 'pending');
