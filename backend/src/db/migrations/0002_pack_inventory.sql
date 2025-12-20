ALTER TABLE medications ADD COLUMN pack_count integer NOT NULL DEFAULT 1;
ALTER TABLE medications ADD COLUMN strips_per_pack integer NOT NULL DEFAULT 1;
ALTER TABLE medications ADD COLUMN tabs_per_strip integer NOT NULL DEFAULT 1;
ALTER TABLE medications ADD COLUMN loose_tablets integer NOT NULL DEFAULT 0;

-- Backfill from previous fields where possible
UPDATE medications
SET
  pack_count = COALESCE(pack_count, 1),
  strips_per_pack = CASE WHEN strips IS NOT NULL THEN strips ELSE 1 END,
  tabs_per_strip = CASE WHEN strip_size IS NOT NULL THEN strip_size ELSE 1 END,
  loose_tablets = CASE
    WHEN strip_size IS NOT NULL AND strips IS NOT NULL THEN MAX(count - (strips * strip_size), 0)
    ELSE 0
  END;
