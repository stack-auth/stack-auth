import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

export const BULLDOZER_SORT_HELPERS_SQL = deindent`
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.bulldozer_side_effects (
    "note" text
  ) ON COMMIT DROP;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_path(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT groups_path || ARRAY[group_key]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_metadata_path(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.bulldozer_sort_group_path(groups_path, group_key) || ARRAY[to_jsonb('metadata'::text)]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_rows_path(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.bulldozer_sort_group_path(groups_path, group_key) || ARRAY[to_jsonb('rows'::text)]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_group_row_path(groups_path jsonb[], group_key jsonb, row_identifier text)
  RETURNS jsonb[] LANGUAGE sql IMMUTABLE AS $$
    SELECT pg_temp.bulldozer_sort_group_rows_path(groups_path, group_key) || ARRAY[to_jsonb(row_identifier)]::jsonb[]
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_nullable_text_jsonb(input_text text)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
      WHEN input_text IS NULL THEN 'null'::jsonb
      ELSE to_jsonb(input_text)
    END
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_make_group_metadata(root_row_identifier text, head_row_identifier text, tail_row_identifier text, row_count integer)
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
      'rootRowIdentifier', root_row_identifier,
      'headRowIdentifier', head_row_identifier,
      'tailRowIdentifier', tail_row_identifier,
      'rowCount', row_count
    )
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_make_row_value(
    row_sort_key jsonb,
    row_data jsonb,
    left_row_identifier text,
    right_row_identifier text,
    priority bigint,
    prev_row_identifier text,
    next_row_identifier text
  )
  RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
      'rowSortKey', row_sort_key,
      'rowData', row_data,
      'leftRowIdentifier', left_row_identifier,
      'rightRowIdentifier', right_row_identifier,
      'priority', priority,
      'prevRowIdentifier', prev_row_identifier,
      'nextRowIdentifier', next_row_identifier
    )
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_get_group_metadata(groups_path jsonb[], group_key jsonb)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key)
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_get_row(groups_path jsonb[], group_key jsonb, row_identifier text)
  RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT "value"
    FROM "BulldozerStorageEngine"
    WHERE "keyPath" = pg_temp.bulldozer_sort_group_row_path(groups_path, group_key, row_identifier)
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_compare_sort_keys(compare_sort_keys_sql text, left_sort_key jsonb, right_sort_key jsonb)
  RETURNS integer LANGUAGE plpgsql AS $$
  DECLARE
    cmp integer;
  BEGIN
    EXECUTE 'SELECT (' || compare_sort_keys_sql || ')::int'
      INTO cmp
      USING left_sort_key, right_sort_key;
    IF cmp < 0 THEN RETURN -1; END IF;
    IF cmp > 0 THEN RETURN 1; END IF;
    RETURN 0;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_compare_row_keys(
    compare_sort_keys_sql text,
    left_sort_key jsonb,
    left_row_identifier text,
    right_sort_key jsonb,
    right_row_identifier text
  )
  RETURNS integer LANGUAGE plpgsql AS $$
  DECLARE
    cmp integer;
  BEGIN
    cmp := pg_temp.bulldozer_sort_compare_sort_keys(compare_sort_keys_sql, left_sort_key, right_sort_key);
    IF cmp <> 0 THEN
      RETURN cmp;
    END IF;
    IF left_row_identifier < right_row_identifier THEN RETURN -1; END IF;
    IF left_row_identifier > right_row_identifier THEN RETURN 1; END IF;
    RETURN 0;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_put_group_metadata(groups_path jsonb[], group_key jsonb, root_row_identifier text, head_row_identifier text, tail_row_identifier text, row_count integer)
  RETURNS void LANGUAGE sql VOLATILE AS $$
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key),
      pg_temp.bulldozer_sort_make_group_metadata(root_row_identifier, head_row_identifier, tail_row_identifier, row_count)
    )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value"
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_put_row_value(groups_path jsonb[], group_key jsonb, row_identifier text, row_value jsonb)
  RETURNS void LANGUAGE sql VOLATILE AS $$
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      pg_temp.bulldozer_sort_group_row_path(groups_path, group_key, row_identifier),
      row_value
    )
    ON CONFLICT ("keyPath") DO UPDATE
    SET "value" = EXCLUDED."value"
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_put_row(
    groups_path jsonb[],
    group_key jsonb,
    row_identifier text,
    row_sort_key jsonb,
    row_data jsonb,
    left_row_identifier text,
    right_row_identifier text,
    priority bigint,
    prev_row_identifier text,
    next_row_identifier text
  )
  RETURNS void LANGUAGE sql VOLATILE AS $$
    SELECT pg_temp.bulldozer_sort_put_row_value(
      groups_path,
      group_key,
      row_identifier,
      pg_temp.bulldozer_sort_make_row_value(
        row_sort_key,
        row_data,
        left_row_identifier,
        right_row_identifier,
        priority,
        prev_row_identifier,
        next_row_identifier
      )
    )
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_delete_row_storage(groups_path jsonb[], group_key jsonb, row_identifier text)
  RETURNS void LANGUAGE sql VOLATILE AS $$
    DELETE FROM "BulldozerStorageEngine"
    WHERE "keyPath" = pg_temp.bulldozer_sort_group_row_path(groups_path, group_key, row_identifier)
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_random_priority()
  RETURNS bigint LANGUAGE sql VOLATILE AS $$
    SELECT abs(hashtextextended(gen_random_uuid()::text, 0))
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_ensure_group(groups_path jsonb[], group_key jsonb)
  RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    SELECT
      gen_random_uuid(),
      groups_path[1:"prefixLength"]::jsonb[],
      'null'::jsonb
    FROM generate_series(2, cardinality(groups_path)) AS "prefixLength"
    ON CONFLICT ("keyPath") DO NOTHING;

    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES
      (gen_random_uuid(), pg_temp.bulldozer_sort_group_path(groups_path, group_key), 'null'::jsonb),
      (gen_random_uuid(), pg_temp.bulldozer_sort_group_rows_path(groups_path, group_key), 'null'::jsonb)
    ON CONFLICT ("keyPath") DO NOTHING;

    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    VALUES (
      gen_random_uuid(),
      pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key),
      pg_temp.bulldozer_sort_make_group_metadata(NULL, NULL, NULL, 0)
    )
    ON CONFLICT ("keyPath") DO NOTHING;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_find_predecessor(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    target_row_identifier text,
    target_row_sort_key jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    current_row_identifier text;
    current_row_value jsonb;
    best_row_identifier text;
    cmp integer;
  BEGIN
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    current_row_identifier := metadata_value->>'rootRowIdentifier';
    best_row_identifier := NULL;

    WHILE current_row_identifier IS NOT NULL LOOP
      current_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, current_row_identifier);
      cmp := pg_temp.bulldozer_sort_compare_row_keys(
        compare_sort_keys_sql,
        current_row_value->'rowSortKey',
        current_row_identifier,
        target_row_sort_key,
        target_row_identifier
      );
      IF cmp < 0 THEN
        best_row_identifier := current_row_identifier;
        current_row_identifier := current_row_value->>'rightRowIdentifier';
      ELSE
        current_row_identifier := current_row_value->>'leftRowIdentifier';
      END IF;
    END LOOP;

    RETURN best_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_find_successor(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    target_row_identifier text,
    target_row_sort_key jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    current_row_identifier text;
    current_row_value jsonb;
    best_row_identifier text;
    cmp integer;
  BEGIN
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    current_row_identifier := metadata_value->>'rootRowIdentifier';
    best_row_identifier := NULL;

    WHILE current_row_identifier IS NOT NULL LOOP
      current_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, current_row_identifier);
      cmp := pg_temp.bulldozer_sort_compare_row_keys(
        compare_sort_keys_sql,
        current_row_value->'rowSortKey',
        current_row_identifier,
        target_row_sort_key,
        target_row_identifier
      );
      IF cmp > 0 THEN
        best_row_identifier := current_row_identifier;
        current_row_identifier := current_row_value->>'leftRowIdentifier';
      ELSE
        current_row_identifier := current_row_value->>'rightRowIdentifier';
      END IF;
    END LOOP;

    RETURN best_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_merge(
    groups_path jsonb[],
    group_key jsonb,
    left_root_row_identifier text,
    right_root_row_identifier text
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    left_row_value jsonb;
    right_row_value jsonb;
    merged_child_row_identifier text;
  BEGIN
    IF left_root_row_identifier IS NULL THEN
      RETURN right_root_row_identifier;
    END IF;
    IF right_root_row_identifier IS NULL THEN
      RETURN left_root_row_identifier;
    END IF;

    left_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, left_root_row_identifier);
    right_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, right_root_row_identifier);

    IF COALESCE((left_row_value->>'priority')::bigint, 0) <= COALESCE((right_row_value->>'priority')::bigint, 0) THEN
      merged_child_row_identifier := pg_temp.bulldozer_sort_merge(
        groups_path,
        group_key,
        left_row_value->>'rightRowIdentifier',
        right_root_row_identifier
      );
      left_row_value := jsonb_set(left_row_value, '{rightRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(merged_child_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, left_root_row_identifier, left_row_value);
      RETURN left_root_row_identifier;
    END IF;

    merged_child_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      left_root_row_identifier,
      right_row_value->>'leftRowIdentifier'
    );
    right_row_value := jsonb_set(right_row_value, '{leftRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(merged_child_row_identifier), true);
    PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, right_root_row_identifier, right_row_value);
    RETURN right_root_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_split(
    groups_path jsonb[],
    group_key jsonb,
    root_row_identifier text,
    split_row_sort_key jsonb,
    split_row_identifier text,
    compare_sort_keys_sql text,
    OUT left_root_row_identifier text,
    OUT right_root_row_identifier text
  )
  RETURNS record LANGUAGE plpgsql AS $$
  DECLARE
    root_row_value jsonb;
    child_split_result record;
    cmp integer;
  BEGIN
    IF root_row_identifier IS NULL THEN
      left_root_row_identifier := NULL;
      right_root_row_identifier := NULL;
      RETURN;
    END IF;

    root_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, root_row_identifier);
    cmp := pg_temp.bulldozer_sort_compare_row_keys(
      compare_sort_keys_sql,
      root_row_value->'rowSortKey',
      root_row_identifier,
      split_row_sort_key,
      split_row_identifier
    );

    IF cmp < 0 THEN
      SELECT *
      INTO child_split_result
      FROM pg_temp.bulldozer_sort_split(
        groups_path,
        group_key,
        root_row_value->>'rightRowIdentifier',
        split_row_sort_key,
        split_row_identifier,
        compare_sort_keys_sql
      ) AS "splitResult";
      root_row_value := jsonb_set(root_row_value, '{rightRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(child_split_result.left_root_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
      left_root_row_identifier := root_row_identifier;
      right_root_row_identifier := child_split_result.right_root_row_identifier;
      RETURN;
    END IF;

    SELECT *
    INTO child_split_result
    FROM pg_temp.bulldozer_sort_split(
      groups_path,
      group_key,
      root_row_value->>'leftRowIdentifier',
      split_row_sort_key,
      split_row_identifier,
      compare_sort_keys_sql
    ) AS "splitResult";
    root_row_value := jsonb_set(root_row_value, '{leftRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(child_split_result.right_root_row_identifier), true);
    PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
    left_root_row_identifier := child_split_result.left_root_row_identifier;
    right_root_row_identifier := root_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_insert(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    row_identifier text,
    row_sort_key jsonb,
    row_data jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    predecessor_row_identifier text;
    successor_row_identifier text;
    predecessor_row_value jsonb;
    successor_row_value jsonb;
    split_left_root_row_identifier text;
    split_right_root_row_identifier text;
    merged_left_root_row_identifier text;
    new_root_row_identifier text;
    new_head_row_identifier text;
    new_tail_row_identifier text;
    row_count integer;
  BEGIN
    PERFORM pg_temp.bulldozer_sort_ensure_group(groups_path, group_key);
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    row_count := COALESCE((metadata_value->>'rowCount')::int, 0);

    predecessor_row_identifier := pg_temp.bulldozer_sort_find_predecessor(
      groups_path,
      group_key,
      compare_sort_keys_sql,
      row_identifier,
      row_sort_key
    );
    successor_row_identifier := pg_temp.bulldozer_sort_find_successor(
      groups_path,
      group_key,
      compare_sort_keys_sql,
      row_identifier,
      row_sort_key
    );

    PERFORM pg_temp.bulldozer_sort_put_row(
      groups_path,
      group_key,
      row_identifier,
      row_sort_key,
      row_data,
      NULL,
      NULL,
      pg_temp.bulldozer_sort_random_priority(),
      predecessor_row_identifier,
      successor_row_identifier
    );

    IF predecessor_row_identifier IS NOT NULL THEN
      predecessor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, predecessor_row_identifier);
      IF predecessor_row_value IS NOT NULL THEN
        predecessor_row_value := jsonb_set(predecessor_row_value, '{nextRowIdentifier}', to_jsonb(row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, predecessor_row_identifier, predecessor_row_value);
      END IF;
    END IF;
    IF successor_row_identifier IS NOT NULL THEN
      successor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, successor_row_identifier);
      IF successor_row_value IS NOT NULL THEN
        successor_row_value := jsonb_set(successor_row_value, '{prevRowIdentifier}', to_jsonb(row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, successor_row_identifier, successor_row_value);
      END IF;
    END IF;

    SELECT "left_root_row_identifier", "right_root_row_identifier"
    INTO split_left_root_row_identifier, split_right_root_row_identifier
    FROM pg_temp.bulldozer_sort_split(
      groups_path,
      group_key,
      metadata_value->>'rootRowIdentifier',
      row_sort_key,
      row_identifier,
      compare_sort_keys_sql
    );
    merged_left_root_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      split_left_root_row_identifier,
      row_identifier
    );
    new_root_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      merged_left_root_row_identifier,
      split_right_root_row_identifier
    );

    new_head_row_identifier := COALESCE(metadata_value->>'headRowIdentifier', row_identifier);
    IF predecessor_row_identifier IS NULL THEN
      new_head_row_identifier := row_identifier;
    END IF;
    new_tail_row_identifier := COALESCE(metadata_value->>'tailRowIdentifier', row_identifier);
    IF successor_row_identifier IS NULL THEN
      new_tail_row_identifier := row_identifier;
    END IF;

    PERFORM pg_temp.bulldozer_sort_put_group_metadata(
      groups_path,
      group_key,
      new_root_row_identifier,
      new_head_row_identifier,
      new_tail_row_identifier,
      row_count + 1
    );
    RETURN row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_build_balanced_group(
    groups_path jsonb[],
    group_key jsonb,
    ordered_rows jsonb[],
    start_index integer,
    end_index integer,
    level integer
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    midpoint integer;
    current_row jsonb;
    row_identifier text;
    left_root_row_identifier text;
    right_root_row_identifier text;
    prev_row_identifier text;
    next_row_identifier text;
  BEGIN
    IF start_index > end_index THEN
      RETURN NULL;
    END IF;

    midpoint := (start_index + end_index) / 2;
    current_row := ordered_rows[midpoint];
    row_identifier := current_row->>'rowIdentifier';
    left_root_row_identifier := pg_temp.bulldozer_sort_build_balanced_group(
      groups_path,
      group_key,
      ordered_rows,
      start_index,
      midpoint - 1,
      level + 1
    );
    right_root_row_identifier := pg_temp.bulldozer_sort_build_balanced_group(
      groups_path,
      group_key,
      ordered_rows,
      midpoint + 1,
      end_index,
      level + 1
    );
    prev_row_identifier := CASE WHEN midpoint > 1 THEN ordered_rows[midpoint - 1]->>'rowIdentifier' ELSE NULL END;
    next_row_identifier := CASE WHEN midpoint < array_length(ordered_rows, 1) THEN ordered_rows[midpoint + 1]->>'rowIdentifier' ELSE NULL END;

    PERFORM pg_temp.bulldozer_sort_put_row(
      groups_path,
      group_key,
      row_identifier,
      current_row->'rowSortKey',
      current_row->'rowData',
      left_root_row_identifier,
      right_root_row_identifier,
      level,
      prev_row_identifier,
      next_row_identifier
    );
    RETURN row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_bulk_init_from_table(groups_path jsonb[], source_table_name text, compare_sort_keys_sql text)
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    current_group_key jsonb;
    ordered_rows jsonb[];
    root_row_identifier text;
    row_count integer;
    is_order_compatible boolean;
    current_index integer;
    cmp integer;
    current_row jsonb;
  BEGIN
    FOR current_group_key IN EXECUTE format(
      'SELECT DISTINCT COALESCE(r."groupKey", ''null''::jsonb) FROM "__bulldozer_seq" AS s, LATERAL jsonb_to_record(s."__output_row") AS r("groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb) WHERE s."__output_name" = %L',
      source_table_name
    )
    LOOP
      PERFORM pg_temp.bulldozer_sort_ensure_group(groups_path, current_group_key);
      EXECUTE format(
        'SELECT array_agg(jsonb_build_object(''rowIdentifier'', r."rowIdentifier", ''rowSortKey'', COALESCE(r."rowSortKey", ''null''::jsonb), ''rowData'', COALESCE(r."rowData", ''null''::jsonb)) ORDER BY COALESCE(r."rowSortKey", ''null''::jsonb) ASC, r."rowIdentifier" ASC) FROM "__bulldozer_seq" AS s, LATERAL jsonb_to_record(s."__output_row") AS r("groupKey" jsonb, "rowIdentifier" text, "rowSortKey" jsonb, "rowData" jsonb) WHERE s."__output_name" = %L AND COALESCE(r."groupKey", ''null''::jsonb) IS NOT DISTINCT FROM $1',
        source_table_name
      )
      INTO ordered_rows
      USING current_group_key;

      row_count := COALESCE(array_length(ordered_rows, 1), 0);
      IF row_count = 0 THEN
        CONTINUE;
      END IF;

      is_order_compatible := TRUE;
      FOR current_index IN 2..row_count
      LOOP
        cmp := pg_temp.bulldozer_sort_compare_row_keys(
          compare_sort_keys_sql,
          ordered_rows[current_index - 1]->'rowSortKey',
          ordered_rows[current_index - 1]->>'rowIdentifier',
          ordered_rows[current_index]->'rowSortKey',
          ordered_rows[current_index]->>'rowIdentifier'
        );
        IF cmp > 0 THEN
          is_order_compatible := FALSE;
          EXIT;
        END IF;
      END LOOP;

      IF is_order_compatible THEN
        root_row_identifier := pg_temp.bulldozer_sort_build_balanced_group(
          groups_path,
          current_group_key,
          ordered_rows,
          1,
          row_count,
          1
        );
        PERFORM pg_temp.bulldozer_sort_put_group_metadata(
          groups_path,
          current_group_key,
          root_row_identifier,
          ordered_rows[1]->>'rowIdentifier',
          ordered_rows[row_count]->>'rowIdentifier',
          row_count
        );
      ELSE
        FOREACH current_row IN ARRAY ordered_rows
        LOOP
          PERFORM pg_temp.bulldozer_sort_insert(
            groups_path,
            current_group_key,
            compare_sort_keys_sql,
            current_row->>'rowIdentifier',
            current_row->'rowSortKey',
            current_row->'rowData'
          );
        END LOOP;
      END IF;
    END LOOP;

    RETURN source_table_name;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_delete_recursive(
    groups_path jsonb[],
    group_key jsonb,
    root_row_identifier text,
    compare_sort_keys_sql text,
    target_row_identifier text,
    target_row_sort_key jsonb
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    root_row_value jsonb;
    updated_child_row_identifier text;
    merged_row_identifier text;
    cmp integer;
  BEGIN
    IF root_row_identifier IS NULL THEN
      RETURN NULL;
    END IF;

    root_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, root_row_identifier);
    cmp := pg_temp.bulldozer_sort_compare_row_keys(
      compare_sort_keys_sql,
      target_row_sort_key,
      target_row_identifier,
      root_row_value->'rowSortKey',
      root_row_identifier
    );

    IF cmp < 0 THEN
      IF root_row_value->>'leftRowIdentifier' IS NULL THEN
        RETURN root_row_identifier;
      END IF;
      updated_child_row_identifier := pg_temp.bulldozer_sort_delete_recursive(
        groups_path,
        group_key,
        root_row_value->>'leftRowIdentifier',
        compare_sort_keys_sql,
        target_row_identifier,
        target_row_sort_key
      );
      root_row_value := jsonb_set(root_row_value, '{leftRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(updated_child_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
      RETURN root_row_identifier;
    END IF;

    IF cmp > 0 THEN
      IF root_row_value->>'rightRowIdentifier' IS NULL THEN
        RETURN root_row_identifier;
      END IF;
      updated_child_row_identifier := pg_temp.bulldozer_sort_delete_recursive(
        groups_path,
        group_key,
        root_row_value->>'rightRowIdentifier',
        compare_sort_keys_sql,
        target_row_identifier,
        target_row_sort_key
      );
      root_row_value := jsonb_set(root_row_value, '{rightRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(updated_child_row_identifier), true);
      PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, root_row_identifier, root_row_value);
      RETURN root_row_identifier;
    END IF;

    merged_row_identifier := pg_temp.bulldozer_sort_merge(
      groups_path,
      group_key,
      root_row_value->>'leftRowIdentifier',
      root_row_value->>'rightRowIdentifier'
    );
    PERFORM pg_temp.bulldozer_sort_delete_row_storage(groups_path, group_key, root_row_identifier);
    RETURN merged_row_identifier;
  END;
  $$;

  CREATE OR REPLACE FUNCTION pg_temp.bulldozer_sort_delete(
    groups_path jsonb[],
    group_key jsonb,
    compare_sort_keys_sql text,
    row_identifier text
  )
  RETURNS text LANGUAGE plpgsql AS $$
  DECLARE
    metadata_value jsonb;
    row_value jsonb;
    predecessor_row_identifier text;
    successor_row_identifier text;
    predecessor_row_value jsonb;
    successor_row_value jsonb;
    new_root_row_identifier text;
    current_head_row_identifier text;
    current_tail_row_identifier text;
    row_count integer;
  BEGIN
    metadata_value := pg_temp.bulldozer_sort_get_group_metadata(groups_path, group_key);
    IF metadata_value IS NULL THEN
      RETURN row_identifier;
    END IF;

    row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, row_identifier);
    IF row_value IS NULL THEN
      RETURN row_identifier;
    END IF;

    predecessor_row_identifier := row_value->>'prevRowIdentifier';
    successor_row_identifier := row_value->>'nextRowIdentifier';
    row_count := COALESCE((metadata_value->>'rowCount')::int, 0);

    IF predecessor_row_identifier IS NOT NULL THEN
      predecessor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, predecessor_row_identifier);
      IF predecessor_row_value IS NOT NULL THEN
        predecessor_row_value := jsonb_set(predecessor_row_value, '{nextRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(successor_row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, predecessor_row_identifier, predecessor_row_value);
      END IF;
    END IF;
    IF successor_row_identifier IS NOT NULL THEN
      successor_row_value := pg_temp.bulldozer_sort_get_row(groups_path, group_key, successor_row_identifier);
      IF successor_row_value IS NOT NULL THEN
        successor_row_value := jsonb_set(successor_row_value, '{prevRowIdentifier}', pg_temp.bulldozer_sort_nullable_text_jsonb(predecessor_row_identifier), true);
        PERFORM pg_temp.bulldozer_sort_put_row_value(groups_path, group_key, successor_row_identifier, successor_row_value);
      END IF;
    END IF;

    new_root_row_identifier := pg_temp.bulldozer_sort_delete_recursive(
      groups_path,
      group_key,
      metadata_value->>'rootRowIdentifier',
      compare_sort_keys_sql,
      row_identifier,
      row_value->'rowSortKey'
    );

    IF row_count <= 1 THEN
      DELETE FROM "BulldozerStorageEngine"
      WHERE "keyPath" IN (
        pg_temp.bulldozer_sort_group_metadata_path(groups_path, group_key),
        pg_temp.bulldozer_sort_group_rows_path(groups_path, group_key),
        pg_temp.bulldozer_sort_group_path(groups_path, group_key)
      );
      RETURN row_identifier;
    END IF;

    current_head_row_identifier := metadata_value->>'headRowIdentifier';
    current_tail_row_identifier := metadata_value->>'tailRowIdentifier';
    IF current_head_row_identifier = row_identifier THEN
      current_head_row_identifier := successor_row_identifier;
    END IF;
    IF current_tail_row_identifier = row_identifier THEN
      current_tail_row_identifier := predecessor_row_identifier;
    END IF;

    PERFORM pg_temp.bulldozer_sort_put_group_metadata(
      groups_path,
      group_key,
      new_root_row_identifier,
      current_head_row_identifier,
      current_tail_row_identifier,
      row_count - 1
    );
    RETURN row_identifier;
  END;
  $$;
`;
