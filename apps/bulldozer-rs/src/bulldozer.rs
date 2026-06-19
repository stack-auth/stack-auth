use serde_json::Value;
use std::collections::BTreeMap;

/// A row in a bulldozer table, keyed by group and identified by a string.
#[derive(Clone, Debug)]
pub struct Row {
    pub group_key: Value,
    pub row_identifier: String,
    pub row_sort_key: Value,
    pub row_data: Value,
}

/// The state of a single table in the bulldozer database, keyed by group.
#[derive(Clone, Debug, Default)]
pub struct TableState {
    /// Groups keyed by canonical group key string -> (group_key, rows)
    /// rows: BTreeMap<row_identifier, (row_sort_key, row_data)>
    pub groups: BTreeMap<String, (Value, BTreeMap<String, (Value, Value)>)>,
}

impl TableState {
    pub fn list_rows_in_group(&self, group_key: &Value) -> Vec<Row> {
        let key_str = canonical_group_key_string(group_key);
        match self.groups.get(&key_str) {
            Some((gk, rows)) => rows
                .iter()
                .map(|(id, (sk, data))| Row {
                    group_key: gk.clone(),
                    row_identifier: id.clone(),
                    row_sort_key: sk.clone(),
                    row_data: data.clone(),
                })
                .collect(),
            None => Vec::new(),
        }
    }
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
                .map(|(k, v)| format!("{}:{}", serde_json::to_string(k).unwrap(), canonical_group_key_string(v)))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
    }
}

/// Compare two JSON values by their serialized string form.
pub fn compare_json(a: &Value, b: &Value) -> std::cmp::Ordering {
    let sa = serde_json::to_string(a).unwrap();
    let sb = serde_json::to_string(b).unwrap();
    sa.cmp(&sb)
}
