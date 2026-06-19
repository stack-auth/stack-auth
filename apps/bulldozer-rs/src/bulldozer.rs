//! Generic bulldozer reactive table engine.
//!
//! This is a direct port of the bulldozer-js engine. It implements a DAG of tables
//! where changes propagate from stored (source) tables through derived tables.

use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

// ═══════════════════════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug)]
pub struct Row {
    pub group_key: Value,
    pub row_identifier: String,
    pub row_sort_key: Value,
    pub row_data: Value,
}

#[derive(Clone, Debug)]
pub struct AddedRow {
    pub group_key: Value,
    pub row_identifier: String,
    pub row_sort_key: Value,
    pub row_data: Value,
}

#[derive(Clone, Debug)]
pub struct ModifiedRow {
    pub group_key: Value,
    pub row_identifier: String,
    pub old_row_sort_key: Value,
    pub new_row_sort_key: Value,
    pub old_row_data: Value,
    pub new_row_data: Value,
}

#[derive(Clone, Debug)]
pub struct DeletedRow {
    pub group_key: Value,
    pub row_identifier: String,
    pub old_row_sort_key: Value,
    pub old_row_data: Value,
}

#[derive(Clone, Debug)]
pub struct GroupEvent {
    pub group_key: Value,
}

#[derive(Clone, Debug, Default)]
pub struct TableChanges {
    pub added_rows: Vec<AddedRow>,
    pub modified_rows: Vec<ModifiedRow>,
    pub deleted_rows: Vec<DeletedRow>,
    pub added_groups: Vec<GroupEvent>,
    pub deleted_groups: Vec<GroupEvent>,
}

impl TableChanges {
    pub fn is_empty(&self) -> bool {
        self.added_rows.is_empty()
            && self.modified_rows.is_empty()
            && self.deleted_rows.is_empty()
            && self.added_groups.is_empty()
            && self.deleted_groups.is_empty()
    }
}

/// A changed row (old/new pair) derived from TableChanges.
pub struct ChangedRow {
    pub old: Option<Row>,
    pub new: Option<Row>,
}

pub fn changed_rows_from_table_changes(changes: &TableChanges) -> Vec<ChangedRow> {
    let mut result = Vec::new();
    for row in &changes.added_rows {
        result.push(ChangedRow {
            old: None,
            new: Some(Row {
                group_key: row.group_key.clone(),
                row_identifier: row.row_identifier.clone(),
                row_sort_key: row.row_sort_key.clone(),
                row_data: row.row_data.clone(),
            }),
        });
    }
    for row in &changes.modified_rows {
        result.push(ChangedRow {
            old: Some(Row {
                group_key: row.group_key.clone(),
                row_identifier: row.row_identifier.clone(),
                row_sort_key: row.old_row_sort_key.clone(),
                row_data: row.old_row_data.clone(),
            }),
            new: Some(Row {
                group_key: row.group_key.clone(),
                row_identifier: row.row_identifier.clone(),
                row_sort_key: row.new_row_sort_key.clone(),
                row_data: row.new_row_data.clone(),
            }),
        });
    }
    for row in &changes.deleted_rows {
        result.push(ChangedRow {
            old: Some(Row {
                group_key: row.group_key.clone(),
                row_identifier: row.row_identifier.clone(),
                row_sort_key: row.old_row_sort_key.clone(),
                row_data: row.old_row_data.clone(),
            }),
            new: None,
        });
    }
    result
}

/// Canonical string encoding of a group key for identity comparison.
pub fn canonical_group_key_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => format!("{b}"),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap(),
        Value::Array(arr) => {
            let inner: Vec<String> = arr.iter().map(canonical_group_key_string).collect();
            format!("[{}]", inner.join(","))
        }
        Value::Object(obj) => {
            let mut entries: Vec<(&String, &Value)> = obj.iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            let inner: Vec<String> = entries
                .iter()
                .map(|(k, v)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        canonical_group_key_string(v)
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
    }
}

pub fn piledriver_object_equals(a: &Value, b: &Value) -> bool {
    canonical_group_key_string(a) == canonical_group_key_string(b)
}

pub fn compare_json(a: &Value, b: &Value) -> Ordering {
    let sa = serde_json::to_string(a).unwrap();
    let sb = serde_json::to_string(b).unwrap();
    sa.cmp(&sb)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Table Implementation Trait
// ═══════════════════════════════════════════════════════════════════════════════

pub trait TableImpl {
    /// Process input changes and return output changes.
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges;

    /// Set or delete a row (only valid for stored tables).
    fn set_or_delete_row(&mut self, _row_id: &str, _data: Option<Value>) -> TableChanges {
        panic!("set_or_delete_row not supported on this table type");
    }

    /// List all rows in a group.
    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row>;

    /// List all groups.
    fn list_groups(&self) -> Vec<Value>;

    /// Tick for time-based processing. Returns changes if any.
    fn tick(&mut self, _now_ms: i64) -> TableChanges {
        TableChanges::default()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Stored Table
// ═══════════════════════════════════════════════════════════════════════════════

pub struct StoredTable {
    // row_identifier -> row_data
    rows: HashMap<String, Value>,
}

impl StoredTable {
    pub fn new() -> Self {
        StoredTable {
            rows: HashMap::new(),
        }
    }
}

impl TableImpl for StoredTable {
    fn emit_input_changes(&mut self, _changes: HashMap<String, TableChanges>) -> TableChanges {
        panic!("Stored tables do not have input tables");
    }

    fn set_or_delete_row(&mut self, row_id: &str, data: Option<Value>) -> TableChanges {
        let mut changes = TableChanges::default();
        let old = self.rows.get(row_id).cloned();

        match (&old, &data) {
            (None, Some(new_data)) => {
                self.rows.insert(row_id.to_string(), new_data.clone());
                changes.added_rows.push(AddedRow {
                    group_key: Value::Null,
                    row_identifier: row_id.to_string(),
                    row_sort_key: Value::Null,
                    row_data: new_data.clone(),
                });
            }
            (Some(old_data), Some(new_data)) => {
                self.rows.insert(row_id.to_string(), new_data.clone());
                if !piledriver_object_equals(old_data, new_data) {
                    changes.modified_rows.push(ModifiedRow {
                        group_key: Value::Null,
                        row_identifier: row_id.to_string(),
                        old_row_sort_key: Value::Null,
                        new_row_sort_key: Value::Null,
                        old_row_data: old_data.clone(),
                        new_row_data: new_data.clone(),
                    });
                }
            }
            (Some(old_data), None) => {
                self.rows.remove(row_id);
                changes.deleted_rows.push(DeletedRow {
                    group_key: Value::Null,
                    row_identifier: row_id.to_string(),
                    old_row_sort_key: Value::Null,
                    old_row_data: old_data.clone(),
                });
            }
            (None, None) => {}
        }
        changes
    }

    fn list_rows_in_group(&self, _group_key: &Value) -> Vec<Row> {
        self.rows
            .iter()
            .map(|(id, data)| Row {
                group_key: Value::Null,
                row_identifier: id.clone(),
                row_sort_key: Value::Null,
                row_data: data.clone(),
            })
            .collect()
    }

    fn list_groups(&self) -> Vec<Value> {
        vec![Value::Null]
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Filter Table
// ═══════════════════════════════════════════════════════════════════════════════

pub struct FilterTable {
    predicate: Box<dyn Fn(&Row) -> bool>,
    // row_identifier -> (group_key, sort_key, data) for rows that pass
    passing_rows: HashMap<String, (Value, Value, Value)>,
}

impl FilterTable {
    pub fn new(predicate: Box<dyn Fn(&Row) -> bool>) -> Self {
        FilterTable {
            predicate,
            passing_rows: HashMap::new(),
        }
    }
}

impl TableImpl for FilterTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("filter requires 'input'");
        let mut output = TableChanges::default();

        for changed in changed_rows_from_table_changes(input_changes) {
            let old_passes = changed.old.as_ref().map_or(false, |r| (self.predicate)(r));
            let new_passes = changed.new.as_ref().map_or(false, |r| (self.predicate)(r));

            match (old_passes, new_passes) {
                (false, true) => {
                    let row = changed.new.unwrap();
                    self.passing_rows.insert(
                        row.row_identifier.clone(),
                        (row.group_key.clone(), row.row_sort_key.clone(), row.row_data.clone()),
                    );
                    output.added_rows.push(AddedRow {
                        group_key: row.group_key,
                        row_identifier: row.row_identifier,
                        row_sort_key: row.row_sort_key,
                        row_data: row.row_data,
                    });
                }
                (true, false) => {
                    let row = changed.old.unwrap();
                    self.passing_rows.remove(&row.row_identifier);
                    output.deleted_rows.push(DeletedRow {
                        group_key: row.group_key,
                        row_identifier: row.row_identifier,
                        old_row_sort_key: row.row_sort_key,
                        old_row_data: row.row_data,
                    });
                }
                (true, true) => {
                    let old = changed.old.unwrap();
                    let new = changed.new.unwrap();
                    self.passing_rows.insert(
                        new.row_identifier.clone(),
                        (new.group_key.clone(), new.row_sort_key.clone(), new.row_data.clone()),
                    );
                    if !piledriver_object_equals(&old.row_data, &new.row_data)
                        || !piledriver_object_equals(&old.row_sort_key, &new.row_sort_key)
                    {
                        output.modified_rows.push(ModifiedRow {
                            group_key: new.group_key,
                            row_identifier: new.row_identifier,
                            old_row_sort_key: old.row_sort_key,
                            new_row_sort_key: new.row_sort_key,
                            old_row_data: old.row_data,
                            new_row_data: new.row_data,
                        });
                    }
                }
                (false, false) => {}
            }
        }
        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        self.passing_rows
            .iter()
            .filter(|(_, (gk, _, _))| canonical_group_key_string(gk) == gk_str)
            .map(|(id, (gk, sk, data))| Row {
                group_key: gk.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            })
            .collect()
    }

    fn list_groups(&self) -> Vec<Value> {
        let mut seen = HashMap::new();
        for (gk, _, _) in self.passing_rows.values() {
            let key = canonical_group_key_string(gk);
            seen.entry(key).or_insert_with(|| gk.clone());
        }
        seen.into_values().collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Map Table
// ═══════════════════════════════════════════════════════════════════════════════

pub struct MapTable {
    mapper: Box<dyn Fn(&Row) -> Value>,
    // row_identifier -> (group_key, sort_key, mapped_data)
    rows: HashMap<String, (Value, Value, Value)>,
}

impl MapTable {
    pub fn new(mapper: Box<dyn Fn(&Row) -> Value>) -> Self {
        MapTable {
            mapper,
            rows: HashMap::new(),
        }
    }
}

impl TableImpl for MapTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("map requires 'input'");
        let mut output = TableChanges::default();

        for changed in changed_rows_from_table_changes(input_changes) {
            match (changed.old, changed.new) {
                (None, Some(new_row)) => {
                    let mapped = (self.mapper)(&new_row);
                    self.rows.insert(
                        new_row.row_identifier.clone(),
                        (new_row.group_key.clone(), new_row.row_sort_key.clone(), mapped.clone()),
                    );
                    output.added_rows.push(AddedRow {
                        group_key: new_row.group_key,
                        row_identifier: new_row.row_identifier,
                        row_sort_key: new_row.row_sort_key,
                        row_data: mapped,
                    });
                }
                (Some(old_row), Some(new_row)) => {
                    let old_mapped = (self.mapper)(&old_row);
                    let new_mapped = (self.mapper)(&new_row);
                    self.rows.insert(
                        new_row.row_identifier.clone(),
                        (new_row.group_key.clone(), new_row.row_sort_key.clone(), new_mapped.clone()),
                    );
                    if !piledriver_object_equals(&old_mapped, &new_mapped)
                        || !piledriver_object_equals(&old_row.row_sort_key, &new_row.row_sort_key)
                    {
                        output.modified_rows.push(ModifiedRow {
                            group_key: new_row.group_key,
                            row_identifier: new_row.row_identifier,
                            old_row_sort_key: old_row.row_sort_key,
                            new_row_sort_key: new_row.row_sort_key,
                            old_row_data: old_mapped,
                            new_row_data: new_mapped,
                        });
                    }
                }
                (Some(old_row), None) => {
                    let old_mapped = (self.mapper)(&old_row);
                    self.rows.remove(&old_row.row_identifier);
                    output.deleted_rows.push(DeletedRow {
                        group_key: old_row.group_key,
                        row_identifier: old_row.row_identifier,
                        old_row_sort_key: old_row.row_sort_key,
                        old_row_data: old_mapped,
                    });
                }
                (None, None) => {}
            }
        }
        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        self.rows
            .iter()
            .filter(|(_, (gk, _, _))| canonical_group_key_string(gk) == gk_str)
            .map(|(id, (gk, sk, data))| Row {
                group_key: gk.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            })
            .collect()
    }

    fn list_groups(&self) -> Vec<Value> {
        let mut seen = HashMap::new();
        for (gk, _, _) in self.rows.values() {
            let key = canonical_group_key_string(gk);
            seen.entry(key).or_insert_with(|| gk.clone());
        }
        seen.into_values().collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FlatMap Table
// ═══════════════════════════════════════════════════════════════════════════════

pub struct FlatMapTable {
    mapper: Box<dyn Fn(&Row) -> Vec<Value>>,
    // input_row_identifier -> Vec<(output_row_identifier, group_key, sort_key, data)>
    emitted: HashMap<String, Vec<(String, Value, Value, Value)>>,
    // All output rows: output_row_identifier -> (group_key, sort_key, data)
    output_rows: HashMap<String, (Value, Value, Value)>,
}

impl FlatMapTable {
    pub fn new(mapper: Box<dyn Fn(&Row) -> Vec<Value>>) -> Self {
        FlatMapTable {
            mapper,
            emitted: HashMap::new(),
            output_rows: HashMap::new(),
        }
    }

    fn make_output_id(input_id: &str, index: usize) -> String {
        format!("{}[{}]", input_id, index)
    }
}

impl TableImpl for FlatMapTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("flatmap requires 'input'");
        let mut output = TableChanges::default();

        for changed in changed_rows_from_table_changes(input_changes) {
            // Remove old outputs
            if let Some(ref old_row) = changed.old {
                if let Some(old_outputs) = self.emitted.remove(&old_row.row_identifier) {
                    for (out_id, gk, sk, data) in old_outputs {
                        self.output_rows.remove(&out_id);
                        output.deleted_rows.push(DeletedRow {
                            group_key: gk,
                            row_identifier: out_id,
                            old_row_sort_key: sk,
                            old_row_data: data,
                        });
                    }
                }
            }

            // Add new outputs
            if let Some(ref new_row) = changed.new {
                let mapped_values = (self.mapper)(new_row);
                let mut new_outputs = Vec::with_capacity(mapped_values.len());
                for (i, data) in mapped_values.into_iter().enumerate() {
                    let out_id = Self::make_output_id(&new_row.row_identifier, i);
                    self.output_rows.insert(
                        out_id.clone(),
                        (new_row.group_key.clone(), new_row.row_sort_key.clone(), data.clone()),
                    );
                    new_outputs.push((
                        out_id.clone(),
                        new_row.group_key.clone(),
                        new_row.row_sort_key.clone(),
                        data.clone(),
                    ));
                    output.added_rows.push(AddedRow {
                        group_key: new_row.group_key.clone(),
                        row_identifier: out_id,
                        row_sort_key: new_row.row_sort_key.clone(),
                        row_data: data,
                    });
                }
                self.emitted.insert(new_row.row_identifier.clone(), new_outputs);
            }
        }
        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        self.output_rows
            .iter()
            .filter(|(_, (gk, _, _))| canonical_group_key_string(gk) == gk_str)
            .map(|(id, (gk, sk, data))| Row {
                group_key: gk.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            })
            .collect()
    }

    fn list_groups(&self) -> Vec<Value> {
        let mut seen = HashMap::new();
        for (gk, _, _) in self.output_rows.values() {
            let key = canonical_group_key_string(gk);
            seen.entry(key).or_insert_with(|| gk.clone());
        }
        seen.into_values().collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Concat Table
// ═══════════════════════════════════════════════════════════════════════════════

/// Combines rows from multiple input tables into one.
/// Row identifiers are prefixed with the input name.
pub struct ConcatTable {
    // All output rows: "{input_name}/{row_id}" -> (group_key, sort_key, data)
    output_rows: HashMap<String, (Value, Value, Value)>,
    // Input names in order (for sort key generation)
    input_names: Vec<String>,
}

impl ConcatTable {
    pub fn new(input_names: Vec<String>) -> Self {
        ConcatTable {
            output_rows: HashMap::new(),
            input_names,
        }
    }

    fn prefixed_id(input_name: &str, row_id: &str) -> String {
        format!("{}/{}", input_name, row_id)
    }
}

impl TableImpl for ConcatTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let mut output = TableChanges::default();

        for (input_name, input_changes) in &changes {
            for changed in changed_rows_from_table_changes(input_changes) {
                let prefixed = |id: &str| Self::prefixed_id(input_name, id);

                match (changed.old, changed.new) {
                    (None, Some(new_row)) => {
                        let out_id = prefixed(&new_row.row_identifier);
                        self.output_rows.insert(
                            out_id.clone(),
                            (new_row.group_key.clone(), new_row.row_sort_key.clone(), new_row.row_data.clone()),
                        );
                        output.added_rows.push(AddedRow {
                            group_key: new_row.group_key,
                            row_identifier: out_id,
                            row_sort_key: new_row.row_sort_key,
                            row_data: new_row.row_data,
                        });
                    }
                    (Some(old_row), Some(new_row)) => {
                        let out_id = prefixed(&new_row.row_identifier);
                        self.output_rows.insert(
                            out_id.clone(),
                            (new_row.group_key.clone(), new_row.row_sort_key.clone(), new_row.row_data.clone()),
                        );
                        if !piledriver_object_equals(&old_row.row_data, &new_row.row_data)
                            || !piledriver_object_equals(&old_row.row_sort_key, &new_row.row_sort_key)
                        {
                            output.modified_rows.push(ModifiedRow {
                                group_key: new_row.group_key,
                                row_identifier: out_id,
                                old_row_sort_key: old_row.row_sort_key,
                                new_row_sort_key: new_row.row_sort_key,
                                old_row_data: old_row.row_data,
                                new_row_data: new_row.row_data,
                            });
                        }
                    }
                    (Some(old_row), None) => {
                        let out_id = prefixed(&old_row.row_identifier);
                        self.output_rows.remove(&out_id);
                        output.deleted_rows.push(DeletedRow {
                            group_key: old_row.group_key,
                            row_identifier: out_id,
                            old_row_sort_key: old_row.row_sort_key,
                            old_row_data: old_row.row_data,
                        });
                    }
                    (None, None) => {}
                }
            }
        }
        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        self.output_rows
            .iter()
            .filter(|(_, (gk, _, _))| canonical_group_key_string(gk) == gk_str)
            .map(|(id, (gk, sk, data))| Row {
                group_key: gk.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            })
            .collect()
    }

    fn list_groups(&self) -> Vec<Value> {
        let mut seen = HashMap::new();
        for (gk, _, _) in self.output_rows.values() {
            let key = canonical_group_key_string(gk);
            seen.entry(key).or_insert_with(|| gk.clone());
        }
        seen.into_values().collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sort Table
// ═══════════════════════════════════════════════════════════════════════════════

/// Re-sorts rows by an extracted sort key within each group.
pub struct SortTable {
    sort_key_extractor: Box<dyn Fn(&Row) -> Value>,
    sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    // group_key_str -> (group_key, row_id -> (extracted_sort_key, original_sort_key, data))
    groups: HashMap<String, (Value, HashMap<String, (Value, Value, Value)>)>,
}

impl SortTable {
    pub fn new(
        sort_key_extractor: Box<dyn Fn(&Row) -> Value>,
        sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    ) -> Self {
        SortTable {
            sort_key_extractor,
            sort_key_comparator,
            groups: HashMap::new(),
        }
    }
}

impl TableImpl for SortTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("sort requires 'input'");
        let mut output = TableChanges::default();

        for changed in changed_rows_from_table_changes(input_changes) {
            match (changed.old, changed.new) {
                (None, Some(new_row)) => {
                    let new_sort_key = (self.sort_key_extractor)(&new_row);
                    let gk_str = canonical_group_key_string(&new_row.group_key);
                    let group = self.groups.entry(gk_str).or_insert_with(|| (new_row.group_key.clone(), HashMap::new()));
                    group.1.insert(
                        new_row.row_identifier.clone(),
                        (new_sort_key.clone(), new_row.row_sort_key.clone(), new_row.row_data.clone()),
                    );
                    output.added_rows.push(AddedRow {
                        group_key: new_row.group_key,
                        row_identifier: new_row.row_identifier,
                        row_sort_key: new_sort_key,
                        row_data: new_row.row_data,
                    });
                }
                (Some(old_row), Some(new_row)) => {
                    let old_sort_key = (self.sort_key_extractor)(&old_row);
                    let new_sort_key = (self.sort_key_extractor)(&new_row);
                    let gk_str = canonical_group_key_string(&new_row.group_key);
                    let group = self.groups.entry(gk_str).or_insert_with(|| (new_row.group_key.clone(), HashMap::new()));
                    group.1.insert(
                        new_row.row_identifier.clone(),
                        (new_sort_key.clone(), new_row.row_sort_key.clone(), new_row.row_data.clone()),
                    );
                    if !piledriver_object_equals(&old_sort_key, &new_sort_key)
                        || !piledriver_object_equals(&old_row.row_data, &new_row.row_data)
                    {
                        output.modified_rows.push(ModifiedRow {
                            group_key: new_row.group_key,
                            row_identifier: new_row.row_identifier,
                            old_row_sort_key: old_sort_key,
                            new_row_sort_key: new_sort_key,
                            old_row_data: old_row.row_data,
                            new_row_data: new_row.row_data,
                        });
                    }
                }
                (Some(old_row), None) => {
                    let old_sort_key = (self.sort_key_extractor)(&old_row);
                    let gk_str = canonical_group_key_string(&old_row.group_key);
                    if let Some(group) = self.groups.get_mut(&gk_str) {
                        group.1.remove(&old_row.row_identifier);
                        if group.1.is_empty() {
                            self.groups.remove(&gk_str);
                        }
                    }
                    output.deleted_rows.push(DeletedRow {
                        group_key: old_row.group_key,
                        row_identifier: old_row.row_identifier,
                        old_row_sort_key: old_sort_key,
                        old_row_data: old_row.row_data,
                    });
                }
                (None, None) => {}
            }
        }
        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        match self.groups.get(&gk_str) {
            Some((gk, rows)) => {
                let mut result: Vec<Row> = rows
                    .iter()
                    .map(|(id, (sk, _orig_sk, data))| Row {
                        group_key: gk.clone(),
                        row_identifier: id.clone(),
                        row_sort_key: sk.clone(),
                        row_data: data.clone(),
                    })
                    .collect();
                result.sort_by(|a, b| (self.sort_key_comparator)(&a.row_sort_key, &b.row_sort_key));
                result
            }
            None => Vec::new(),
        }
    }

    fn list_groups(&self) -> Vec<Value> {
        self.groups.values().map(|(gk, _)| gk.clone()).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GroupBy Table
// ═══════════════════════════════════════════════════════════════════════════════

/// Re-groups rows by an extracted group key.
pub struct GroupByTable {
    group_key_extractor: Box<dyn Fn(&Row) -> Value>,
    group_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    // output_group_key_str -> (group_key, row_id -> (sort_key, data))
    groups: HashMap<String, (Value, HashMap<String, (Value, Value)>)>,
    // row_id -> output_group_key_str (for tracking which group a row is in)
    row_to_group: HashMap<String, String>,
}

impl GroupByTable {
    pub fn new(
        group_key_extractor: Box<dyn Fn(&Row) -> Value>,
        group_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
        sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    ) -> Self {
        GroupByTable {
            group_key_extractor,
            group_key_comparator,
            sort_key_comparator,
            groups: HashMap::new(),
            row_to_group: HashMap::new(),
        }
    }
}

impl TableImpl for GroupByTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("group-by requires 'input'");
        let mut output = TableChanges::default();

        for changed in changed_rows_from_table_changes(input_changes) {
            // Remove from old group
            if let Some(ref old_row) = changed.old {
                if let Some(old_gk_str) = self.row_to_group.remove(&old_row.row_identifier) {
                    if let Some(group) = self.groups.get_mut(&old_gk_str) {
                        group.1.remove(&old_row.row_identifier);
                        let old_gk = (self.group_key_extractor)(old_row);
                        output.deleted_rows.push(DeletedRow {
                            group_key: old_gk,
                            row_identifier: old_row.row_identifier.clone(),
                            old_row_sort_key: old_row.row_sort_key.clone(),
                            old_row_data: old_row.row_data.clone(),
                        });
                        if group.1.is_empty() {
                            let deleted_gk = group.0.clone();
                            self.groups.remove(&old_gk_str);
                            output.deleted_groups.push(GroupEvent { group_key: deleted_gk });
                        }
                    }
                }
            }

            // Add to new group
            if let Some(ref new_row) = changed.new {
                let new_gk = (self.group_key_extractor)(new_row);
                let new_gk_str = canonical_group_key_string(&new_gk);
                let is_new_group = !self.groups.contains_key(&new_gk_str);
                let group = self.groups.entry(new_gk_str.clone()).or_insert_with(|| (new_gk.clone(), HashMap::new()));
                group.1.insert(
                    new_row.row_identifier.clone(),
                    (new_row.row_sort_key.clone(), new_row.row_data.clone()),
                );
                self.row_to_group.insert(new_row.row_identifier.clone(), new_gk_str);
                if is_new_group {
                    output.added_groups.push(GroupEvent { group_key: new_gk.clone() });
                }
                output.added_rows.push(AddedRow {
                    group_key: new_gk,
                    row_identifier: new_row.row_identifier.clone(),
                    row_sort_key: new_row.row_sort_key.clone(),
                    row_data: new_row.row_data.clone(),
                });
            }
        }
        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        match self.groups.get(&gk_str) {
            Some((gk, rows)) => {
                let mut result: Vec<Row> = rows
                    .iter()
                    .map(|(id, (sk, data))| Row {
                        group_key: gk.clone(),
                        row_identifier: id.clone(),
                        row_sort_key: sk.clone(),
                        row_data: data.clone(),
                    })
                    .collect();
                result.sort_by(|a, b| (self.sort_key_comparator)(&a.row_sort_key, &b.row_sort_key));
                result
            }
            None => Vec::new(),
        }
    }

    fn list_groups(&self) -> Vec<Value> {
        self.groups.values().map(|(gk, _)| gk.clone()).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LeftJoin Table
// ═══════════════════════════════════════════════════════════════════════════════

pub struct LeftJoinTable {
    left_join_key_extractor: Box<dyn Fn(&Row) -> Value>,
    right_join_key_extractor: Box<dyn Fn(&Row) -> Value>,
    join_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    joiner: Box<dyn Fn(&Row, Option<&Row>) -> Value>,
    // Left rows: row_id -> Row + join_key
    left_rows: HashMap<String, (Row, Value)>,
    // Right rows: row_id -> Row + join_key
    right_rows: HashMap<String, (Row, Value)>,
    // Join key str -> set of left row ids
    left_by_join_key: HashMap<String, Vec<String>>,
    // Join key str -> set of right row ids
    right_by_join_key: HashMap<String, Vec<String>>,
    // Output rows: output_row_id -> (group_key, sort_key, data)
    output_rows: HashMap<String, (Value, Value, Value)>,
    // Track groups
    output_groups: HashMap<String, Value>,
}

impl LeftJoinTable {
    pub fn new(
        left_join_key_extractor: Box<dyn Fn(&Row) -> Value>,
        right_join_key_extractor: Box<dyn Fn(&Row) -> Value>,
        join_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
        joiner: Box<dyn Fn(&Row, Option<&Row>) -> Value>,
    ) -> Self {
        LeftJoinTable {
            left_join_key_extractor,
            right_join_key_extractor,
            join_key_comparator,
            joiner,
            left_rows: HashMap::new(),
            right_rows: HashMap::new(),
            left_by_join_key: HashMap::new(),
            right_by_join_key: HashMap::new(),
            output_rows: HashMap::new(),
            output_groups: HashMap::new(),
        }
    }

    fn output_row_id(left_id: &str, right_id: Option<&str>) -> String {
        serde_json::to_string(&serde_json::json!([left_id, right_id])).unwrap()
    }

    fn output_sort_key(left_sk: &Value, right_sk: Option<&Value>) -> Value {
        serde_json::json!([left_sk, right_sk])
    }
}

impl TableImpl for LeftJoinTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let mut output = TableChanges::default();

        // Process left changes
        if let Some(left_changes) = changes.get("left") {
            for changed in changed_rows_from_table_changes(left_changes) {
                // Delete old left outputs
                if let Some(ref old_row) = changed.old {
                    if let Some((_, old_jk)) = self.left_rows.remove(&old_row.row_identifier) {
                        let jk_str = canonical_group_key_string(&old_jk);
                        if let Some(ids) = self.left_by_join_key.get_mut(&jk_str) {
                            ids.retain(|id| id != &old_row.row_identifier);
                            if ids.is_empty() {
                                self.left_by_join_key.remove(&jk_str);
                            }
                        }
                        // Remove output rows for this left row
                        let right_ids: Vec<String> = self.right_by_join_key
                            .get(&jk_str)
                            .map(|ids| ids.clone())
                            .unwrap_or_default();
                        if right_ids.is_empty() {
                            let out_id = Self::output_row_id(&old_row.row_identifier, None);
                            if let Some((gk, sk, data)) = self.output_rows.remove(&out_id) {
                                output.deleted_rows.push(DeletedRow {
                                    group_key: gk,
                                    row_identifier: out_id,
                                    old_row_sort_key: sk,
                                    old_row_data: data,
                                });
                            }
                        } else {
                            for rid in &right_ids {
                                let out_id = Self::output_row_id(&old_row.row_identifier, Some(rid));
                                if let Some((gk, sk, data)) = self.output_rows.remove(&out_id) {
                                    output.deleted_rows.push(DeletedRow {
                                        group_key: gk,
                                        row_identifier: out_id,
                                        old_row_sort_key: sk,
                                        old_row_data: data,
                                    });
                                }
                            }
                        }
                    }
                }

                // Add new left outputs
                if let Some(ref new_row) = changed.new {
                    let new_jk = (self.left_join_key_extractor)(new_row);
                    let jk_str = canonical_group_key_string(&new_jk);
                    self.left_rows.insert(new_row.row_identifier.clone(), (new_row.clone(), new_jk.clone()));
                    self.left_by_join_key.entry(jk_str.clone()).or_default().push(new_row.row_identifier.clone());

                    let right_ids: Vec<String> = self.right_by_join_key
                        .get(&jk_str)
                        .map(|ids| ids.clone())
                        .unwrap_or_default();

                    if right_ids.is_empty() {
                        let joined_data = (self.joiner)(new_row, None);
                        let out_id = Self::output_row_id(&new_row.row_identifier, None);
                        let sort_key = Self::output_sort_key(&new_row.row_sort_key, None);
                        let gk_str = canonical_group_key_string(&new_row.group_key);
                        if !self.output_groups.contains_key(&gk_str) {
                            self.output_groups.insert(gk_str.clone(), new_row.group_key.clone());
                            output.added_groups.push(GroupEvent { group_key: new_row.group_key.clone() });
                        }
                        self.output_rows.insert(out_id.clone(), (new_row.group_key.clone(), sort_key.clone(), joined_data.clone()));
                        output.added_rows.push(AddedRow {
                            group_key: new_row.group_key.clone(),
                            row_identifier: out_id,
                            row_sort_key: sort_key,
                            row_data: joined_data,
                        });
                    } else {
                        for rid in &right_ids {
                            let right_row = &self.right_rows.get(rid).unwrap().0;
                            let joined_data = (self.joiner)(new_row, Some(right_row));
                            let out_id = Self::output_row_id(&new_row.row_identifier, Some(rid));
                            let sort_key = Self::output_sort_key(&new_row.row_sort_key, Some(&right_row.row_sort_key));
                            let gk_str = canonical_group_key_string(&new_row.group_key);
                            if !self.output_groups.contains_key(&gk_str) {
                                self.output_groups.insert(gk_str.clone(), new_row.group_key.clone());
                                output.added_groups.push(GroupEvent { group_key: new_row.group_key.clone() });
                            }
                            self.output_rows.insert(out_id.clone(), (new_row.group_key.clone(), sort_key.clone(), joined_data.clone()));
                            output.added_rows.push(AddedRow {
                                group_key: new_row.group_key.clone(),
                                row_identifier: out_id,
                                row_sort_key: sort_key,
                                row_data: joined_data,
                            });
                        }
                    }
                }
            }
        }

        // Process right changes
        if let Some(right_changes) = changes.get("right") {
            for changed in changed_rows_from_table_changes(right_changes) {
                if let Some(ref old_row) = changed.old {
                    if let Some((_, old_jk)) = self.right_rows.remove(&old_row.row_identifier) {
                        let jk_str = canonical_group_key_string(&old_jk);
                        // Remove outputs involving this right row
                        let left_ids: Vec<String> = self.left_by_join_key
                            .get(&jk_str)
                            .map(|ids| ids.clone())
                            .unwrap_or_default();
                        for lid in &left_ids {
                            let out_id = Self::output_row_id(lid, Some(&old_row.row_identifier));
                            if let Some((gk, sk, data)) = self.output_rows.remove(&out_id) {
                                output.deleted_rows.push(DeletedRow {
                                    group_key: gk,
                                    row_identifier: out_id,
                                    old_row_sort_key: sk,
                                    old_row_data: data,
                                });
                            }
                        }
                        // Remove from index
                        if let Some(ids) = self.right_by_join_key.get_mut(&jk_str) {
                            ids.retain(|id| id != &old_row.row_identifier);
                            // If no more rights for this key, add null joins for lefts
                            if ids.is_empty() {
                                self.right_by_join_key.remove(&jk_str);
                                for lid in &left_ids {
                                    let left_row = &self.left_rows.get(lid).unwrap().0;
                                    let joined_data = (self.joiner)(left_row, None);
                                    let out_id = Self::output_row_id(lid, None);
                                    let sort_key = Self::output_sort_key(&left_row.row_sort_key, None);
                                    self.output_rows.insert(out_id.clone(), (left_row.group_key.clone(), sort_key.clone(), joined_data.clone()));
                                    output.added_rows.push(AddedRow {
                                        group_key: left_row.group_key.clone(),
                                        row_identifier: out_id,
                                        row_sort_key: sort_key,
                                        row_data: joined_data,
                                    });
                                }
                            }
                        }
                    }
                }

                if let Some(ref new_row) = changed.new {
                    let new_jk = (self.right_join_key_extractor)(new_row);
                    let jk_str = canonical_group_key_string(&new_jk);
                    let left_ids: Vec<String> = self.left_by_join_key
                        .get(&jk_str)
                        .map(|ids| ids.clone())
                        .unwrap_or_default();

                    // If this is the first right for this key, remove null joins
                    let had_rights = self.right_by_join_key.get(&jk_str).map_or(false, |ids| !ids.is_empty());
                    if !had_rights {
                        for lid in &left_ids {
                            let out_id = Self::output_row_id(lid, None);
                            if let Some((gk, sk, data)) = self.output_rows.remove(&out_id) {
                                output.deleted_rows.push(DeletedRow {
                                    group_key: gk,
                                    row_identifier: out_id,
                                    old_row_sort_key: sk,
                                    old_row_data: data,
                                });
                            }
                        }
                    }

                    self.right_rows.insert(new_row.row_identifier.clone(), (new_row.clone(), new_jk.clone()));
                    self.right_by_join_key.entry(jk_str.clone()).or_default().push(new_row.row_identifier.clone());

                    // Add outputs for each left
                    for lid in &left_ids {
                        let left_row = &self.left_rows.get(lid).unwrap().0;
                        let joined_data = (self.joiner)(left_row, Some(new_row));
                        let out_id = Self::output_row_id(lid, Some(&new_row.row_identifier));
                        let sort_key = Self::output_sort_key(&left_row.row_sort_key, Some(&new_row.row_sort_key));
                        self.output_rows.insert(out_id.clone(), (left_row.group_key.clone(), sort_key.clone(), joined_data.clone()));
                        output.added_rows.push(AddedRow {
                            group_key: left_row.group_key.clone(),
                            row_identifier: out_id,
                            row_sort_key: sort_key,
                            row_data: joined_data,
                        });
                    }
                }
            }
        }

        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        self.output_rows
            .iter()
            .filter(|(_, (gk, _, _))| canonical_group_key_string(gk) == gk_str)
            .map(|(id, (gk, sk, data))| Row {
                group_key: gk.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            })
            .collect()
    }

    fn list_groups(&self) -> Vec<Value> {
        self.output_groups.values().cloned().collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LeftFold Table
// ═══════════════════════════════════════════════════════════════════════════════

/// Folds rows in sort-key order within each group. Output rows keep the source
/// rowIdentifier and rowSortKey; rowData is the reducer output for that row.
pub struct LeftFoldTable {
    initial_state: Value,
    reducer: Box<dyn Fn(&Value, &Row) -> (Value, Value)>, // (new_state, new_row_data)
    sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    // group_key_str -> (group_key, sorted rows as BTreeMap<SortEntry, (row_id, input_data, output_data, state_after)>)
    groups: HashMap<String, GroupFoldState>,
}

struct GroupFoldState {
    group_key: Value,
    // (row_identifier -> (sort_key, input_data))
    input_rows: HashMap<String, (Value, Value)>,
    // Computed output: row_identifier -> (sort_key, output_data)
    output_rows: HashMap<String, (Value, Value)>,
}

impl LeftFoldTable {
    pub fn new(
        initial_state: Value,
        reducer: Box<dyn Fn(&Value, &Row) -> (Value, Value)>,
        sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    ) -> Self {
        LeftFoldTable {
            initial_state,
            reducer,
            sort_key_comparator,
            groups: HashMap::new(),
        }
    }

    /// Recompute the fold for a group, returning old and new output rows.
    fn recompute_group_with(
        initial_state: &Value,
        reducer: &dyn Fn(&Value, &Row) -> (Value, Value),
        sort_key_comparator: &dyn Fn(&Value, &Value) -> Ordering,
        state: &mut GroupFoldState,
    ) -> (Vec<Row>, Vec<Row>) {
        let old_outputs: Vec<Row> = state.output_rows.iter().map(|(id, (sk, data))| Row {
            group_key: state.group_key.clone(),
            row_identifier: id.clone(),
            row_sort_key: sk.clone(),
            row_data: data.clone(),
        }).collect();

        // Sort input rows by sort key
        let mut sorted_inputs: Vec<(&String, &Value, &Value)> = state.input_rows
            .iter()
            .map(|(id, (sk, data))| (id, sk, data))
            .collect();
        sorted_inputs.sort_by(|(_, sk_a, _), (_, sk_b, _)| sort_key_comparator(sk_a, sk_b));

        // Fold
        let mut fold_state = initial_state.clone();
        let mut new_output_rows = HashMap::new();
        let mut new_outputs: Vec<Row> = Vec::new();

        for (id, sk, data) in sorted_inputs {
            let row = Row {
                group_key: state.group_key.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            };
            let (new_state, output_data) = reducer(&fold_state, &row);
            fold_state = new_state;
            new_output_rows.insert(id.clone(), (sk.clone(), output_data.clone()));
            new_outputs.push(Row {
                group_key: state.group_key.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: output_data,
            });
        }

        state.output_rows = new_output_rows;
        (old_outputs, new_outputs)
    }
}

impl TableImpl for LeftFoldTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("left-fold requires 'input'");
        let mut output = TableChanges::default();

        // Track which groups are affected
        let mut affected_groups: HashMap<String, Value> = HashMap::new();

        // Handle group lifecycle from input
        for g in &input_changes.added_groups {
            let gk_str = canonical_group_key_string(&g.group_key);
            affected_groups.insert(gk_str.clone(), g.group_key.clone());
            if !self.groups.contains_key(&gk_str) {
                self.groups.insert(gk_str, GroupFoldState {
                    group_key: g.group_key.clone(),
                    input_rows: HashMap::new(),
                    output_rows: HashMap::new(),
                });
                output.added_groups.push(GroupEvent { group_key: g.group_key.clone() });
            }
        }

        // Apply row changes to input storage
        for changed in changed_rows_from_table_changes(input_changes) {
            if let Some(ref old_row) = changed.old {
                let gk_str = canonical_group_key_string(&old_row.group_key);
                affected_groups.insert(gk_str.clone(), old_row.group_key.clone());
                if let Some(group) = self.groups.get_mut(&gk_str) {
                    group.input_rows.remove(&old_row.row_identifier);
                }
            }
            if let Some(ref new_row) = changed.new {
                let gk_str = canonical_group_key_string(&new_row.group_key);
                affected_groups.insert(gk_str.clone(), new_row.group_key.clone());
                let group = self.groups.entry(gk_str).or_insert_with(|| GroupFoldState {
                    group_key: new_row.group_key.clone(),
                    input_rows: HashMap::new(),
                    output_rows: HashMap::new(),
                });
                group.input_rows.insert(
                    new_row.row_identifier.clone(),
                    (new_row.row_sort_key.clone(), new_row.row_data.clone()),
                );
            }
        }

        // Handle deleted groups
        for g in &input_changes.deleted_groups {
            let gk_str = canonical_group_key_string(&g.group_key);
            if let Some(group) = self.groups.remove(&gk_str) {
                for (id, (sk, data)) in &group.output_rows {
                    output.deleted_rows.push(DeletedRow {
                        group_key: group.group_key.clone(),
                        row_identifier: id.clone(),
                        old_row_sort_key: sk.clone(),
                        old_row_data: data.clone(),
                    });
                }
                output.deleted_groups.push(GroupEvent { group_key: g.group_key.clone() });
            }
            affected_groups.remove(&gk_str);
        }

        // Recompute affected groups
        for (gk_str, _) in &affected_groups {
            if let Some(group) = self.groups.get_mut(gk_str) {
                let (old_outputs, new_outputs) = Self::recompute_group_with(
                    &self.initial_state, &self.reducer, &self.sort_key_comparator, group
                );
                // Diff old vs new outputs
                let old_map: HashMap<&String, &Row> = old_outputs.iter().map(|r| (&r.row_identifier, r)).collect();
                let new_map: HashMap<&String, &Row> = new_outputs.iter().map(|r| (&r.row_identifier, r)).collect();

                for (id, new_row) in &new_map {
                    if let Some(old_row) = old_map.get(id) {
                        if !piledriver_object_equals(&old_row.row_data, &new_row.row_data)
                            || !piledriver_object_equals(&old_row.row_sort_key, &new_row.row_sort_key)
                        {
                            output.modified_rows.push(ModifiedRow {
                                group_key: new_row.group_key.clone(),
                                row_identifier: new_row.row_identifier.clone(),
                                old_row_sort_key: old_row.row_sort_key.clone(),
                                new_row_sort_key: new_row.row_sort_key.clone(),
                                old_row_data: old_row.row_data.clone(),
                                new_row_data: new_row.row_data.clone(),
                            });
                        }
                    } else {
                        output.added_rows.push(AddedRow {
                            group_key: new_row.group_key.clone(),
                            row_identifier: new_row.row_identifier.clone(),
                            row_sort_key: new_row.row_sort_key.clone(),
                            row_data: new_row.row_data.clone(),
                        });
                    }
                }
                for (id, old_row) in &old_map {
                    if !new_map.contains_key(id) {
                        output.deleted_rows.push(DeletedRow {
                            group_key: old_row.group_key.clone(),
                            row_identifier: old_row.row_identifier.clone(),
                            old_row_sort_key: old_row.row_sort_key.clone(),
                            old_row_data: old_row.row_data.clone(),
                        });
                    }
                }
            }
        }

        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        match self.groups.get(&gk_str) {
            Some(group) => {
                let mut rows: Vec<Row> = group.output_rows.iter().map(|(id, (sk, data))| Row {
                    group_key: group.group_key.clone(),
                    row_identifier: id.clone(),
                    row_sort_key: sk.clone(),
                    row_data: data.clone(),
                }).collect();
                rows.sort_by(|a, b| (self.sort_key_comparator)(&a.row_sort_key, &b.row_sort_key));
                rows
            }
            None => Vec::new(),
        }
    }

    fn list_groups(&self) -> Vec<Value> {
        self.groups.values().map(|g| g.group_key.clone()).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TimeFold Table
// ═══════════════════════════════════════════════════════════════════════════════

/// Time-aware fold. Each input row runs once immediately with trigger_time=None.
/// If the reducer returns next_trigger_time, tick() processes queued rows.
pub struct TimeFoldTable {
    initial_state: Value,
    reducer: Box<dyn Fn(&Value, &Row, Option<i64>) -> TimeFoldResult>,
    // Source rows: row_identifier -> SourceRowState
    source_rows: HashMap<String, TimeFoldSourceRow>,
    // Output rows per group: group_key_str -> (group_key, row_id -> data)
    output_groups: HashMap<String, (Value, HashMap<String, Value>)>,
    // Timer queue: (trigger_time_ms, row_identifier)
    queue: BTreeMap<(i64, String), ()>,
}

pub struct TimeFoldResult {
    pub new_state: Value,
    pub new_row_data: Value,
    pub next_trigger_time_ms: Option<i64>,
}

struct TimeFoldSourceRow {
    row: Row,
    state: Value,
    next_trigger_time_ms: Option<i64>,
    emitted_rows: Vec<Value>, // Each emitted row data
}

impl TimeFoldTable {
    pub fn new(
        initial_state: Value,
        reducer: Box<dyn Fn(&Value, &Row, Option<i64>) -> TimeFoldResult>,
    ) -> Self {
        TimeFoldTable {
            initial_state,
            reducer,
            source_rows: HashMap::new(),
            output_groups: HashMap::new(),
            queue: BTreeMap::new(),
        }
    }

    fn output_row_id(source_id: &str, index: usize) -> String {
        serde_json::to_string(&serde_json::json!([source_id, index])).unwrap()
    }

    fn remove_outputs(&mut self, source_row: &TimeFoldSourceRow, output: &mut TableChanges) {
        let gk_str = canonical_group_key_string(&source_row.row.group_key);
        if let Some((gk, group_rows)) = self.output_groups.get_mut(&gk_str) {
            for (i, data) in source_row.emitted_rows.iter().enumerate() {
                let out_id = Self::output_row_id(&source_row.row.row_identifier, i);
                group_rows.remove(&out_id);
                output.deleted_rows.push(DeletedRow {
                    group_key: gk.clone(),
                    row_identifier: out_id,
                    old_row_sort_key: Value::Null,
                    old_row_data: data.clone(),
                });
            }
        }
    }

    fn add_outputs(&mut self, source_row: &TimeFoldSourceRow, output: &mut TableChanges) {
        let gk_str = canonical_group_key_string(&source_row.row.group_key);
        let (gk, group_rows) = self.output_groups
            .entry(gk_str)
            .or_insert_with(|| (source_row.row.group_key.clone(), HashMap::new()));
        for (i, data) in source_row.emitted_rows.iter().enumerate() {
            let out_id = Self::output_row_id(&source_row.row.row_identifier, i);
            group_rows.insert(out_id.clone(), data.clone());
            output.added_rows.push(AddedRow {
                group_key: gk.clone(),
                row_identifier: out_id,
                row_sort_key: Value::Null,
                row_data: data.clone(),
            });
        }
    }
}

impl TableImpl for TimeFoldTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("time-fold requires 'input'");
        let mut output = TableChanges::default();

        // Handle added groups
        for g in &input_changes.added_groups {
            let gk_str = canonical_group_key_string(&g.group_key);
            if !self.output_groups.contains_key(&gk_str) {
                self.output_groups.insert(gk_str, (g.group_key.clone(), HashMap::new()));
                output.added_groups.push(GroupEvent { group_key: g.group_key.clone() });
            }
        }

        for changed in changed_rows_from_table_changes(input_changes) {
            // Delete old source row
            if let Some(ref old_row) = changed.old {
                if let Some(old_source) = self.source_rows.remove(&old_row.row_identifier) {
                    // Remove from queue
                    if let Some(t) = old_source.next_trigger_time_ms {
                        self.queue.remove(&(t, old_row.row_identifier.clone()));
                    }
                    // Remove outputs
                    self.remove_outputs(&old_source, &mut output);
                }
            }

            // Add new source row
            if let Some(ref new_row) = changed.new {
                let result = (self.reducer)(&self.initial_state, new_row, None);
                let source = TimeFoldSourceRow {
                    row: new_row.clone(),
                    state: result.new_state,
                    next_trigger_time_ms: result.next_trigger_time_ms,
                    emitted_rows: vec![result.new_row_data],
                };
                // Add to queue
                if let Some(t) = source.next_trigger_time_ms {
                    self.queue.insert((t, new_row.row_identifier.clone()), ());
                }
                // Add outputs
                self.add_outputs(&source, &mut output);
                self.source_rows.insert(new_row.row_identifier.clone(), source);
            }
        }

        // Handle deleted groups
        for g in &input_changes.deleted_groups {
            let gk_str = canonical_group_key_string(&g.group_key);
            if let Some((_, group_rows)) = self.output_groups.remove(&gk_str) {
                for (out_id, data) in group_rows {
                    output.deleted_rows.push(DeletedRow {
                        group_key: g.group_key.clone(),
                        row_identifier: out_id,
                        old_row_sort_key: Value::Null,
                        old_row_data: data,
                    });
                }
                output.deleted_groups.push(GroupEvent { group_key: g.group_key.clone() });
            }
        }

        output
    }

    fn tick(&mut self, now_ms: i64) -> TableChanges {
        let mut output = TableChanges::default();

        loop {
            let next = self.queue.iter().next().map(|((t, id), _)| (*t, id.clone()));
            match next {
                Some((trigger_time, row_id)) if trigger_time <= now_ms => {
                    self.queue.remove(&(trigger_time, row_id.clone()));
                    if let Some(source) = self.source_rows.get_mut(&row_id) {
                        if source.next_trigger_time_ms != Some(trigger_time) {
                            continue;
                        }
                        let result = (self.reducer)(&source.state, &source.row, Some(trigger_time));
                        // Add new output row
                        let new_index = source.emitted_rows.len();
                        let out_id = Self::output_row_id(&row_id, new_index);
                        let gk_str = canonical_group_key_string(&source.row.group_key);
                        if let Some((gk, group_rows)) = self.output_groups.get_mut(&gk_str) {
                            group_rows.insert(out_id.clone(), result.new_row_data.clone());
                            output.added_rows.push(AddedRow {
                                group_key: gk.clone(),
                                row_identifier: out_id,
                                row_sort_key: Value::Null,
                                row_data: result.new_row_data.clone(),
                            });
                        }
                        source.emitted_rows.push(result.new_row_data);
                        source.state = result.new_state;
                        source.next_trigger_time_ms = result.next_trigger_time_ms;
                        if let Some(t) = source.next_trigger_time_ms {
                            self.queue.insert((t, row_id), ());
                        }
                    }
                }
                _ => break,
            }
        }

        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        match self.output_groups.get(&gk_str) {
            Some((gk, rows)) => rows
                .iter()
                .map(|(id, data)| Row {
                    group_key: gk.clone(),
                    row_identifier: id.clone(),
                    row_sort_key: Value::Null,
                    row_data: data.clone(),
                })
                .collect(),
            None => Vec::new(),
        }
    }

    fn list_groups(&self) -> Vec<Value> {
        self.output_groups.values().map(|(gk, _)| gk.clone()).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Compact Table (uses transduction-like logic)
// ═══════════════════════════════════════════════════════════════════════════════

/// Compacts adjacent rows using a merge function.
/// When two adjacent rows can be merged, they become one.
pub struct CompactTable {
    compactor: Box<dyn Fn(&Value, &Value) -> Vec<Value>>,
    sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    // group_key_str -> (group_key, input rows sorted)
    groups: HashMap<String, CompactGroupState>,
}

struct CompactGroupState {
    group_key: Value,
    // input rows: row_id -> (sort_key, data)
    input_rows: HashMap<String, (Value, Value)>,
    // output rows after compaction: Vec<(row_id, sort_key, data)>
    output_rows: Vec<(String, Value, Value)>,
}

impl CompactTable {
    pub fn new(
        compactor: Box<dyn Fn(&Value, &Value) -> Vec<Value>>,
        sort_key_comparator: Box<dyn Fn(&Value, &Value) -> Ordering>,
    ) -> Self {
        CompactTable {
            compactor,
            sort_key_comparator,
            groups: HashMap::new(),
        }
    }

    fn recompute_group_with(
        compactor: &dyn Fn(&Value, &Value) -> Vec<Value>,
        sort_key_comparator: &dyn Fn(&Value, &Value) -> Ordering,
        state: &mut CompactGroupState,
    ) {
        // Sort input rows
        let mut sorted: Vec<(&String, &Value, &Value)> = state.input_rows
            .iter()
            .map(|(id, (sk, data))| (id, sk, data))
            .collect();
        sorted.sort_by(|(_, sk_a, _), (_, sk_b, _)| sort_key_comparator(sk_a, sk_b));

        // Compact: merge adjacent rows
        let mut compacted: Vec<(String, Value, Value)> = Vec::new();
        for (id, sk, data) in sorted {
            if compacted.is_empty() {
                compacted.push((id.clone(), sk.clone(), data.clone()));
            } else {
                let last_data = &compacted.last().unwrap().2;
                let merged = compactor(last_data, data);
                if merged.len() == 1 {
                    // Merged into one
                    let last = compacted.last_mut().unwrap();
                    last.2 = merged.into_iter().next().unwrap();
                } else {
                    // Not merged - keep the last as-is, update if compactor changed it
                    let last = compacted.last_mut().unwrap();
                    last.2 = merged[0].clone();
                    compacted.push((id.clone(), sk.clone(), merged[1].clone()));
                }
            }
        }

        state.output_rows = compacted;
    }
}

impl TableImpl for CompactTable {
    fn emit_input_changes(&mut self, changes: HashMap<String, TableChanges>) -> TableChanges {
        let input_changes = changes.get("input").expect("compact requires 'input'");
        let mut output = TableChanges::default();

        // Track affected groups
        let mut affected_groups: Vec<String> = Vec::new();

        for changed in changed_rows_from_table_changes(input_changes) {
            if let Some(ref old_row) = changed.old {
                let gk_str = canonical_group_key_string(&old_row.group_key);
                if let Some(group) = self.groups.get_mut(&gk_str) {
                    group.input_rows.remove(&old_row.row_identifier);
                }
                if !affected_groups.contains(&gk_str) {
                    affected_groups.push(gk_str);
                }
            }
            if let Some(ref new_row) = changed.new {
                let gk_str = canonical_group_key_string(&new_row.group_key);
                let group = self.groups.entry(gk_str.clone()).or_insert_with(|| CompactGroupState {
                    group_key: new_row.group_key.clone(),
                    input_rows: HashMap::new(),
                    output_rows: Vec::new(),
                });
                group.input_rows.insert(
                    new_row.row_identifier.clone(),
                    (new_row.row_sort_key.clone(), new_row.row_data.clone()),
                );
                if !affected_groups.contains(&gk_str) {
                    affected_groups.push(gk_str);
                }
            }
        }

        // Recompute affected groups
        for gk_str in affected_groups {
            if let Some(group) = self.groups.get_mut(&gk_str) {
                let old_outputs: Vec<(String, Value, Value)> = group.output_rows.clone();
                Self::recompute_group_with(&self.compactor, &self.sort_key_comparator, group);
                let new_outputs = &group.output_rows;

                // Diff: emit deleted for old, added for new (simple approach)
                let old_map: HashMap<&String, (&Value, &Value)> = old_outputs.iter().map(|(id, sk, d)| (id, (sk, d))).collect();
                let new_map: HashMap<&String, (&Value, &Value)> = new_outputs.iter().map(|(id, sk, d)| (id, (sk, d))).collect();

                for (id, (sk, data)) in &old_map {
                    if let Some((new_sk, new_data)) = new_map.get(id) {
                        if !piledriver_object_equals(data, new_data) || !piledriver_object_equals(sk, new_sk) {
                            output.modified_rows.push(ModifiedRow {
                                group_key: group.group_key.clone(),
                                row_identifier: (*id).clone(),
                                old_row_sort_key: (*sk).clone(),
                                new_row_sort_key: (*new_sk).clone(),
                                old_row_data: (*data).clone(),
                                new_row_data: (*new_data).clone(),
                            });
                        }
                    } else {
                        output.deleted_rows.push(DeletedRow {
                            group_key: group.group_key.clone(),
                            row_identifier: (*id).clone(),
                            old_row_sort_key: (*sk).clone(),
                            old_row_data: (*data).clone(),
                        });
                    }
                }
                for (id, (sk, data)) in &new_map {
                    if !old_map.contains_key(id) {
                        output.added_rows.push(AddedRow {
                            group_key: group.group_key.clone(),
                            row_identifier: (*id).clone(),
                            row_sort_key: (*sk).clone(),
                            row_data: (*data).clone(),
                        });
                    }
                }
            }
        }

        output
    }

    fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let gk_str = canonical_group_key_string(group_key);
        match self.groups.get(&gk_str) {
            Some(group) => group.output_rows.iter().map(|(id, sk, data)| Row {
                group_key: group.group_key.clone(),
                row_identifier: id.clone(),
                row_sort_key: sk.clone(),
                row_data: data.clone(),
            }).collect(),
            None => Vec::new(),
        }
    }

    fn list_groups(&self) -> Vec<Value> {
        self.groups.values().map(|g| g.group_key.clone()).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database
// ═══════════════════════════════════════════════════════════════════════════════

struct TableEntry {
    #[allow(dead_code)]
    id: String,
    implementation: Box<dyn TableImpl>,
    /// Maps input name -> table index in the database
    input_tables: HashMap<String, usize>,
    /// List of (downstream_table_index, input_name_in_downstream)
    downstream: Vec<(usize, String)>,
}

pub struct Database {
    tables: Vec<TableEntry>,
    table_id_to_index: HashMap<String, usize>,
}

impl Database {
    pub fn new() -> Self {
        Database {
            tables: Vec::new(),
            table_id_to_index: HashMap::new(),
        }
    }

    /// Add a table to the database.
    /// input_tables: maps input_name -> table_id of the input table.
    pub fn add_table(
        &mut self,
        table_id: &str,
        implementation: Box<dyn TableImpl>,
        input_tables: HashMap<String, String>,
    ) {
        let index = self.tables.len();
        let input_indices: HashMap<String, usize> = input_tables
            .iter()
            .map(|(name, id)| {
                let idx = *self.table_id_to_index.get(id).unwrap_or_else(|| {
                    panic!("Input table '{}' not found for table '{}'", id, table_id)
                });
                (name.clone(), idx)
            })
            .collect();

        // Register this table as downstream of its inputs
        for (name, &input_idx) in &input_indices {
            self.tables[input_idx].downstream.push((index, name.clone()));
        }

        self.tables.push(TableEntry {
            id: table_id.to_string(),
            implementation,
            input_tables: input_indices,
            downstream: Vec::new(),
        });
        self.table_id_to_index.insert(table_id.to_string(), index);
    }

    /// Set or delete a row in a stored table and propagate changes.
    pub fn set_or_delete_row(&mut self, table_id: &str, row_id: &str, data: Option<Value>) {
        let table_idx = *self.table_id_to_index.get(table_id)
            .unwrap_or_else(|| panic!("Table '{}' not found", table_id));

        let changes = self.tables[table_idx].implementation.set_or_delete_row(row_id, data);
        if !changes.is_empty() {
            self.propagate_changes(table_idx, changes);
        }
    }

    /// Tick all time-fold tables up to `now_ms` and propagate changes.
    pub fn tick(&mut self, now_ms: i64) {
        let table_count = self.tables.len();
        for i in 0..table_count {
            let changes = self.tables[i].implementation.tick(now_ms);
            if !changes.is_empty() {
                self.propagate_changes(i, changes);
            }
        }
    }

    /// Propagate changes from a table to all its downstream tables (BFS).
    fn propagate_changes(&mut self, source_idx: usize, changes: TableChanges) {
        // Use a queue for BFS propagation
        let mut queue: Vec<(usize, String, TableChanges)> = Vec::new();

        // Enqueue all downstream of source
        let downstream: Vec<(usize, String)> = self.tables[source_idx].downstream.clone();
        for (downstream_idx, input_name) in downstream {
            queue.push((downstream_idx, input_name, changes.clone()));
        }

        while !queue.is_empty() {
            // Group changes by target table
            let mut grouped: HashMap<usize, HashMap<String, TableChanges>> = HashMap::new();
            for (idx, input_name, changes) in queue.drain(..) {
                grouped.entry(idx).or_default().insert(input_name, changes);
            }

            // Process each target table
            let mut sorted_targets: Vec<usize> = grouped.keys().cloned().collect();
            sorted_targets.sort();

            for target_idx in sorted_targets {
                let input_changes = grouped.remove(&target_idx).unwrap();
                let output_changes = self.tables[target_idx].implementation.emit_input_changes(input_changes);

                if !output_changes.is_empty() {
                    let downstream: Vec<(usize, String)> = self.tables[target_idx].downstream.clone();
                    for (downstream_idx, input_name) in downstream {
                        queue.push((downstream_idx, input_name, output_changes.clone()));
                    }
                }
            }
        }
    }

    /// List rows in a group for a given table.
    pub fn list_rows_in_group(&self, table_id: &str, group_key: &Value) -> Vec<Row> {
        let table_idx = *self.table_id_to_index.get(table_id)
            .unwrap_or_else(|| panic!("Table '{}' not found", table_id));
        self.tables[table_idx].implementation.list_rows_in_group(group_key)
    }

    /// List all groups for a given table.
    pub fn list_groups(&self, table_id: &str) -> Vec<Value> {
        let table_idx = *self.table_id_to_index.get(table_id)
            .unwrap_or_else(|| panic!("Table '{}' not found", table_id));
        self.tables[table_idx].implementation.list_groups()
    }
}
