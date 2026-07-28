ALTER TABLE "GtmNote"
ADD COLUMN "title" VARCHAR(120);

ALTER TABLE "GtmNote"
ADD CONSTRAINT "GtmNote_title_length_check"
CHECK (
  "title" IS NULL
  OR char_length("title") BETWEEN 1 AND 120
) NOT VALID;
