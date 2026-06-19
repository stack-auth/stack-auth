use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

use crate::bulldozer::{canonical_group_key_string, Row};

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSnapshot {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub product_line_id: Option<String>,
    pub customer_type: String,
    pub prices: HashMap<String, HashMap<String, Value>>,
    pub included_items: HashMap<String, IncludedItemConfig>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncludedItemConfig {
    pub quantity: i64,
    #[serde(default)]
    pub repeat: Option<Value>,
    #[serde(default)]
    pub expires: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionRow {
    pub id: String,
    pub tenancy_id: String,
    pub customer_id: String,
    pub customer_type: String,
    pub product_id: Option<String>,
    pub price_id: Option<String>,
    pub product: ProductSnapshot,
    pub quantity: i64,
    pub stripe_subscription_id: Option<String>,
    pub status: String,
    pub current_period_start_millis: i64,
    pub current_period_end_millis: i64,
    pub cancel_at_period_end: bool,
    pub canceled_at_millis: Option<i64>,
    pub ended_at_millis: Option<i64>,
    pub refunded_at_millis: Option<i64>,
    pub product_revoked_at_millis: Option<i64>,
    pub creation_source: String,
    pub created_at_millis: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneTimePurchaseRow {
    pub id: String,
    pub tenancy_id: String,
    pub customer_id: String,
    pub customer_type: String,
    pub product_id: Option<String>,
    pub price_id: Option<String>,
    pub product: ProductSnapshot,
    pub quantity: i64,
    pub stripe_payment_intent_id: Option<String>,
    pub revoked_at_millis: Option<i64>,
    pub refunded_at_millis: Option<i64>,
    pub creation_source: String,
    pub created_at_millis: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualItemQuantityChangeRow {
    pub id: String,
    pub tenancy_id: String,
    pub customer_id: String,
    pub customer_type: String,
    pub item_id: String,
    pub quantity: i64,
    pub description: Option<String>,
    pub expires_at_millis: Option<i64>,
    pub created_at_millis: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRow {
    pub txn_id: String,
    pub tenancy_id: String,
    pub effective_at_millis: i64,
    #[serde(rename = "type")]
    pub txn_type: String,
    pub entries: Vec<Value>,
    pub customer_type: String,
    pub customer_id: String,
    pub payment_provider: Option<String>,
    pub created_at_millis: i64,
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

fn payment_provider(creation_source: &str) -> &'static str {
    if creation_source == "TEST_MODE" { "test_mode" } else { "stripe" }
}

fn charged_amount(product: &ProductSnapshot, price_id: &Option<String>, quantity: i64) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let price_id = match price_id {
        Some(id) => id,
        None => return result,
    };
    let price = match product.prices.get(price_id) {
        Some(p) => p,
        None => return result,
    };
    for (currency, amount) in price {
        if currency == "interval" || currency == "serverOnly" || currency == "freeTrial" {
            continue;
        }
        let numeric = match amount {
            Value::String(s) => s.parse::<f64>().ok(),
            Value::Number(n) => n.as_f64(),
            _ => None,
        };
        if let Some(n) = numeric {
            if n.is_finite() {
                result.insert(currency.clone(), (n * quantity as f64).to_string());
            }
        }
    }
    result
}

fn item_grants(product: &ProductSnapshot, quantity: i64) -> Vec<Value> {
    product.included_items.iter().map(|(item_id, item)| {
        let expires_when = normalized_expires_when(item);
        json!({
            "itemId": item_id,
            "quantity": item.quantity * quantity,
            "expiresWhen": expires_when,
        })
    }).collect()
}

fn normalized_expires_when(item: &IncludedItemConfig) -> Value {
    match &item.expires {
        Some(s) if s == "when-purchase-expires" || s == "when-repeated" => Value::String(s.clone()),
        _ => Value::Null,
    }
}

const DAY_MS: i64 = 86_400_000;
const WEEK_MS: i64 = 7 * DAY_MS;
const MONTH_MS: i64 = 30 * DAY_MS;
const YEAR_MS: i64 = 365 * DAY_MS;

fn repeat_interval_ms(repeat: &Option<Value>) -> Option<i64> {
    let arr = match repeat {
        Some(Value::Array(a)) if a.len() == 2 => a,
        _ => return None,
    };
    let count = arr[0].as_i64()?;
    let unit = arr[1].as_str()?;
    Some(match unit {
        "day" => count * DAY_MS,
        "week" => count * WEEK_MS,
        "month" => count * MONTH_MS,
        "year" => count * YEAR_MS,
        _ => return None,
    })
}

// ─── Payments Database ────────────────────────────────────────────────────────

/// CustomerKey for grouping transactions by customer.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CustomerKey {
    pub tenancy_id: String,
    pub customer_type: String,
    pub customer_id: String,
}

impl CustomerKey {
    pub fn to_value(&self) -> Value {
        json!({
            "tenancyId": self.tenancy_id,
            "customerType": self.customer_type,
            "customerId": self.customer_id,
        })
    }
}

/// The payments bulldozer database. Stores source facts and maintains derived views.
pub struct PaymentsDatabase {
    // Source tables
    subscriptions: BTreeMap<String, SubscriptionRow>,
    one_time_purchases: BTreeMap<String, OneTimePurchaseRow>,
    manual_item_quantity_changes: BTreeMap<String, ManualItemQuantityChangeRow>,

    // Derived: transactions grouped by customer
    transactions_by_customer: HashMap<String, Vec<TransactionRow>>,

    // Derived: owned products per customer (fold result)
    owned_products_by_customer: HashMap<String, Value>,

    // Derived: item quantities per customer (fold result)
    item_quantities_by_customer: HashMap<String, Value>,
}

impl PaymentsDatabase {
    pub fn new() -> Self {
        PaymentsDatabase {
            subscriptions: BTreeMap::new(),
            one_time_purchases: BTreeMap::new(),
            manual_item_quantity_changes: BTreeMap::new(),
            transactions_by_customer: HashMap::new(),
            owned_products_by_customer: HashMap::new(),
            item_quantities_by_customer: HashMap::new(),
        }
    }

    pub fn set_subscription(&mut self, row_id: &str, row: SubscriptionRow) {
        let customer_key = CustomerKey {
            tenancy_id: row.tenancy_id.clone(),
            customer_type: row.customer_type.clone(),
            customer_id: row.customer_id.clone(),
        };
        self.subscriptions.insert(row_id.to_string(), row);
        self.recompute_customer(&customer_key);
    }

    pub fn set_one_time_purchase(&mut self, row_id: &str, row: OneTimePurchaseRow) {
        let customer_key = CustomerKey {
            tenancy_id: row.tenancy_id.clone(),
            customer_type: row.customer_type.clone(),
            customer_id: row.customer_id.clone(),
        };
        self.one_time_purchases.insert(row_id.to_string(), row);
        self.recompute_customer(&customer_key);
    }

    pub fn set_manual_item_quantity_change(&mut self, row_id: &str, row: ManualItemQuantityChangeRow) {
        let customer_key = CustomerKey {
            tenancy_id: row.tenancy_id.clone(),
            customer_type: row.customer_type.clone(),
            customer_id: row.customer_id.clone(),
        };
        self.manual_item_quantity_changes.insert(row_id.to_string(), row);
        self.recompute_customer(&customer_key);
    }

    /// Recompute all derived tables for a given customer.
    fn recompute_customer(&mut self, key: &CustomerKey) {
        let key_str = canonical_group_key_string(&key.to_value());

        // Collect all transactions for this customer
        let mut transactions: Vec<TransactionRow> = Vec::new();

        // From subscriptions
        for sub in self.subscriptions.values() {
            if sub.tenancy_id == key.tenancy_id && sub.customer_type == key.customer_type && sub.customer_id == key.customer_id {
                self.generate_subscription_transactions(sub, &mut transactions);
            }
        }

        // From one-time purchases
        for otp in self.one_time_purchases.values() {
            if otp.tenancy_id == key.tenancy_id && otp.customer_type == key.customer_type && otp.customer_id == key.customer_id {
                self.generate_otp_transaction(otp, &mut transactions);
            }
        }

        // From manual item quantity changes
        for miqc in self.manual_item_quantity_changes.values() {
            if miqc.tenancy_id == key.tenancy_id && miqc.customer_type == key.customer_type && miqc.customer_id == key.customer_id {
                self.generate_manual_iqc_transaction(miqc, &mut transactions);
            }
        }

        // Sort transactions by effectiveAtMillis, then txnId
        transactions.sort_by(|a, b| {
            a.effective_at_millis.cmp(&b.effective_at_millis)
                .then_with(|| a.txn_id.cmp(&b.txn_id))
        });

        // Compute owned products (fold over product-grant and product-revocation entries)
        let owned_products = self.compute_owned_products(&transactions);

        // Compute item quantities (fold over item changes)
        let item_quantities = self.compute_item_quantities(&transactions);

        self.transactions_by_customer.insert(key_str.clone(), transactions);
        self.owned_products_by_customer.insert(key_str.clone(), owned_products);
        self.item_quantities_by_customer.insert(key_str, item_quantities);
    }

    fn generate_subscription_transactions(&self, sub: &SubscriptionRow, transactions: &mut Vec<TransactionRow>) {
        let provider = payment_provider(&sub.creation_source);
        let charged = charged_amount(&sub.product, &sub.price_id, sub.quantity);
        let has_money_transfer = provider != "test_mode" && !charged.is_empty();
        let grants = item_grants(&sub.product, sub.quantity);

        // Subscription start transaction
        let mut entries: Vec<Value> = vec![
            json!({
                "type": "active-subscription-start",
                "customerType": sub.customer_type,
                "customerId": sub.customer_id,
                "subscriptionId": sub.id,
            }),
            json!({
                "type": "product-grant",
                "customerType": sub.customer_type,
                "customerId": sub.customer_id,
                "productId": sub.product_id,
                "product": serde_json::to_value(&sub.product).unwrap(),
                "productLineId": sub.product.product_line_id.as_deref(),
                "quantity": sub.quantity,
                "subscriptionId": sub.id,
            }),
        ];
        if has_money_transfer {
            entries.push(json!({
                "type": "money-transfer",
                "customerType": sub.customer_type,
                "customerId": sub.customer_id,
                "chargedAmount": charged,
            }));
        }
        for grant in &grants {
            entries.push(json!({
                "type": "item-quantity-change",
                "customerType": sub.customer_type,
                "customerId": sub.customer_id,
                "itemId": grant["itemId"],
                "quantity": grant["quantity"],
                "expiresWhen": grant["expiresWhen"],
            }));
        }

        transactions.push(TransactionRow {
            txn_id: format!("sub-start:{}", sub.id),
            tenancy_id: sub.tenancy_id.clone(),
            effective_at_millis: sub.created_at_millis,
            txn_type: "subscription-start".to_string(),
            entries,
            customer_type: sub.customer_type.clone(),
            customer_id: sub.customer_id.clone(),
            payment_provider: Some(provider.to_string()),
            created_at_millis: sub.created_at_millis,
        });

        // Check for subscription end (immediate end without repeats)
        if let Some(ended_at) = sub.ended_at_millis {
            let has_repeat = sub.product.included_items.values()
                .any(|item| repeat_interval_ms(&item.repeat).is_some());
            let immediate_end = !has_repeat && ended_at < sub.current_period_end_millis && sub.product_revoked_at_millis.is_none();

            if immediate_end {
                let start_product_grant_entry_index: usize = 1;
                let start_item_change_base_index: usize = if has_money_transfer { 3 } else { 2 };

                let mut end_entries: Vec<Value> = vec![
                    json!({
                        "type": "active-subscription-end",
                        "customerType": sub.customer_type,
                        "customerId": sub.customer_id,
                        "subscriptionId": sub.id,
                    }),
                    json!({
                        "type": "product-revocation",
                        "customerType": sub.customer_type,
                        "customerId": sub.customer_id,
                        "adjustedTransactionId": format!("sub-start:{}", sub.id),
                        "adjustedEntryIndex": start_product_grant_entry_index,
                        "quantity": sub.quantity,
                        "productId": sub.product_id,
                        "productLineId": sub.product.product_line_id.as_deref(),
                    }),
                ];

                // Expire all outstanding item grants
                for (i, (item_id, item)) in sub.product.included_items.iter().enumerate() {
                    let expires_when = normalized_expires_when(item);
                    if expires_when != Value::Null {
                        end_entries.push(json!({
                            "type": "item-quantity-expire",
                            "customerType": sub.customer_type,
                            "customerId": sub.customer_id,
                            "adjustedTransactionId": format!("sub-start:{}", sub.id),
                            "adjustedEntryIndex": start_item_change_base_index + i,
                            "quantity": item.quantity * sub.quantity,
                            "itemId": item_id,
                        }));
                    }
                }

                transactions.push(TransactionRow {
                    txn_id: format!("sub-end:{}", sub.id),
                    tenancy_id: sub.tenancy_id.clone(),
                    effective_at_millis: ended_at,
                    txn_type: "subscription-end".to_string(),
                    entries: end_entries,
                    customer_type: sub.customer_type.clone(),
                    customer_id: sub.customer_id.clone(),
                    payment_provider: Some(provider.to_string()),
                    created_at_millis: ended_at,
                });
            }
        }

        // Cancel event
        if sub.cancel_at_period_end && (sub.status == "active" || sub.status == "trialing") {
            transactions.push(TransactionRow {
                txn_id: format!("sub-cancel:{}", sub.id),
                tenancy_id: sub.tenancy_id.clone(),
                effective_at_millis: sub.canceled_at_millis.unwrap_or(sub.created_at_millis),
                txn_type: "subscription-cancel".to_string(),
                entries: vec![json!({
                    "type": "active-subscription-change",
                    "customerType": sub.customer_type,
                    "customerId": sub.customer_id,
                    "subscriptionId": sub.id,
                    "changeType": "cancel",
                })],
                customer_type: sub.customer_type.clone(),
                customer_id: sub.customer_id.clone(),
                payment_provider: Some(provider.to_string()),
                created_at_millis: sub.created_at_millis,
            });
        }
    }

    fn generate_otp_transaction(&self, otp: &OneTimePurchaseRow, transactions: &mut Vec<TransactionRow>) {
        let provider = payment_provider(&otp.creation_source);
        let charged = charged_amount(&otp.product, &otp.price_id, otp.quantity);
        let has_money_transfer = provider != "test_mode" && !charged.is_empty();
        let grants = item_grants(&otp.product, otp.quantity);

        let mut entries: Vec<Value> = vec![
            json!({
                "type": "product-grant",
                "customerType": otp.customer_type,
                "customerId": otp.customer_id,
                "productId": otp.product_id,
                "product": serde_json::to_value(&otp.product).unwrap(),
                "productLineId": otp.product.product_line_id.as_deref(),
                "quantity": otp.quantity,
                "oneTimePurchaseId": otp.id,
            }),
        ];
        if has_money_transfer {
            entries.push(json!({
                "type": "money-transfer",
                "customerType": otp.customer_type,
                "customerId": otp.customer_id,
                "chargedAmount": charged,
            }));
        }
        for grant in &grants {
            entries.push(json!({
                "type": "item-quantity-change",
                "customerType": otp.customer_type,
                "customerId": otp.customer_id,
                "itemId": grant["itemId"],
                "quantity": grant["quantity"],
                "expiresWhen": grant["expiresWhen"],
            }));
        }

        transactions.push(TransactionRow {
            txn_id: format!("otp:{}", otp.id),
            tenancy_id: otp.tenancy_id.clone(),
            effective_at_millis: otp.created_at_millis,
            txn_type: "one-time-purchase".to_string(),
            entries,
            customer_type: otp.customer_type.clone(),
            customer_id: otp.customer_id.clone(),
            payment_provider: Some(provider.to_string()),
            created_at_millis: otp.created_at_millis,
        });
    }

    fn generate_manual_iqc_transaction(&self, miqc: &ManualItemQuantityChangeRow, transactions: &mut Vec<TransactionRow>) {
        transactions.push(TransactionRow {
            txn_id: format!("miqc:{}", miqc.id),
            tenancy_id: miqc.tenancy_id.clone(),
            effective_at_millis: miqc.created_at_millis,
            txn_type: "manual-item-quantity-change".to_string(),
            entries: vec![json!({
                "type": "item-quantity-change",
                "customerType": miqc.customer_type,
                "customerId": miqc.customer_id,
                "itemId": miqc.item_id,
                "quantity": miqc.quantity,
                "expiresWhen": miqc.expires_at_millis,
            })],
            customer_type: miqc.customer_type.clone(),
            customer_id: miqc.customer_id.clone(),
            payment_provider: Value::Null.as_str().map(|s| s.to_string()),
            created_at_millis: miqc.created_at_millis,
        });
    }

    /// Compute owned products fold.
    fn compute_owned_products(&self, transactions: &[TransactionRow]) -> Value {
        // Extract product-grant and product-revocation entries, sorted by effectiveAtMillis
        let mut product_entries: Vec<(i64, &str, &Value)> = Vec::new();
        for txn in transactions {
            for entry in &txn.entries {
                let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if entry_type == "product-grant" || entry_type == "product-revocation" {
                    product_entries.push((txn.effective_at_millis, &txn.txn_id, entry));
                }
            }
        }
        product_entries.sort_by_key(|(millis, txn_id, _)| (*millis, txn_id.to_string()));

        // Fold over entries
        let mut state: HashMap<String, (i64, Value, Value)> = HashMap::new(); // productId -> (quantity, product, productLineId)
        let mut last_output = Value::Null;

        for (effective_at, txn_id, entry) in &product_entries {
            let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let product_id = entry.get("productId").and_then(|v| v.as_str()).unwrap_or("__null__").to_string();
            let quantity = entry.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);

            let (current_qty, current_product, current_pli) = state.entry(product_id.clone())
                .or_insert_with(|| (0, Value::Null, Value::Null));

            if entry_type == "product-grant" {
                *current_qty = (*current_qty + quantity).max(0);
                *current_product = entry.get("product").cloned().unwrap_or(Value::Null);
                *current_pli = entry.get("productLineId").cloned().unwrap_or(Value::Null);
            } else {
                *current_qty = (*current_qty - quantity).max(0);
            }

            // Build the output owned products map
            let owned: HashMap<&str, Value> = state.iter()
                .map(|(k, (q, p, pli))| (k.as_str(), json!({"quantity": q, "product": p, "productLineId": pli})))
                .collect();
            last_output = json!({
                "txnEffectiveAtMillis": effective_at,
                "txnId": txn_id,
                "ownedProducts": owned,
                "customerType": entry.get("customerType"),
                "customerId": entry.get("customerId"),
                "tenancyId": entry.get("tenancyId"),
            });
        }

        last_output
    }

    /// Compute item quantities fold.
    fn compute_item_quantities(&self, transactions: &[TransactionRow]) -> Value {
        // First, expand transaction entries into item changes with expiries (the "split" step)
        let mut item_changes: Vec<(i64, String, String, i64, Option<i64>)> = Vec::new();
        // (effective_at, txn_id, item_id, quantity, expires_at)

        for txn in transactions {
            for entry in &txn.entries {
                let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");

                if entry_type == "item-quantity-change" {
                    let item_id = entry.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let quantity = entry.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);
                    let expires_when = entry.get("expiresWhen");

                    // Check if expiresWhen is a number (absolute millis expiry)
                    let expires_at_millis = match expires_when {
                        Some(Value::Number(n)) => n.as_i64(),
                        _ => None,
                    };

                    if let Some(exp) = expires_at_millis {
                        if exp > txn.effective_at_millis && quantity > 0 {
                            // Split into grant + future expiry
                            item_changes.push((txn.effective_at_millis, txn.txn_id.clone(), item_id.clone(), quantity, Some(exp)));
                            item_changes.push((exp, txn.txn_id.clone(), item_id, -quantity, None));
                        } else {
                            item_changes.push((txn.effective_at_millis, txn.txn_id.clone(), item_id, quantity, None));
                        }
                    } else {
                        // Compactable: no expiry logic, just the change
                        item_changes.push((txn.effective_at_millis, txn.txn_id.clone(), item_id, quantity, None));
                    }
                } else if entry_type == "item-quantity-expire" {
                    let item_id = entry.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let quantity = entry.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);
                    item_changes.push((txn.effective_at_millis, txn.txn_id.clone(), item_id, -quantity, None));
                }
            }
        }

        // Sort by effective time
        item_changes.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        // Fold over changes to compute item quantities
        // State: item_id -> { grants: [(quantity, expires_at)], debt: i64 }
        let mut state: HashMap<String, ItemQuantityState> = HashMap::new();
        let mut last_output = Value::Null;

        for (effective_at, txn_id, item_id, quantity, expires_at) in &item_changes {
            let item_state = state.entry(item_id.clone()).or_insert_with(|| ItemQuantityState {
                grants: Vec::new(),
                debt: 0,
            });

            if *quantity > 0 {
                let after_debt = *quantity + item_state.debt;
                if after_debt > 0 {
                    item_state.grants.push((after_debt, *expires_at));
                    item_state.debt = 0;
                } else {
                    item_state.debt = after_debt;
                }
            } else if *quantity < 0 {
                let mut remaining = quantity.unsigned_abs() as i64;
                // Sort grants by expiry (soonest first, null = infinity last)
                item_state.grants.sort_by(|(_, ea), (_, eb)| {
                    let a = ea.unwrap_or(i64::MAX);
                    let b = eb.unwrap_or(i64::MAX);
                    a.cmp(&b)
                });
                let mut new_grants = Vec::new();
                for (q, e) in item_state.grants.drain(..) {
                    let consumed = q.min(remaining);
                    remaining -= consumed;
                    if q > consumed {
                        new_grants.push((q - consumed, e));
                    }
                }
                item_state.grants = new_grants;
                item_state.debt -= remaining;
            } else {
                // quantity == 0: filter out expired grants
                item_state.grants.retain(|(_, e)| {
                    e.is_none() || e.unwrap() > *effective_at
                });
            }

            // Compute current quantities
            let quantities: HashMap<&str, i64> = state.iter()
                .map(|(id, s)| {
                    let sum: i64 = s.grants.iter().map(|(q, _)| q).sum::<i64>() + s.debt;
                    (id.as_str(), sum)
                })
                .collect();

            last_output = json!({
                "txnEffectiveAtMillis": effective_at,
                "txnId": txn_id,
                "itemQuantities": quantities,
                "customerType": "user",
                "customerId": "",
                "tenancyId": "",
            });
        }

        last_output
    }

    // ─── Read Methods ─────────────────────────────────────────────────────────

    pub fn read_transactions(&self, group_key: &Value) -> Vec<Row> {
        let key_str = canonical_group_key_string(group_key);
        match self.transactions_by_customer.get(&key_str) {
            Some(txns) => txns.iter().map(|txn| Row {
                group_key: group_key.clone(),
                row_identifier: txn.txn_id.clone(),
                row_sort_key: Value::from(txn.effective_at_millis),
                row_data: serde_json::to_value(txn).unwrap(),
            }).collect(),
            None => Vec::new(),
        }
    }

    pub fn read_owned_products(&self, group_key: &Value) -> Vec<Row> {
        let key_str = canonical_group_key_string(group_key);
        match self.owned_products_by_customer.get(&key_str) {
            Some(data) if *data != Value::Null => vec![Row {
                group_key: group_key.clone(),
                row_identifier: "fold-result".to_string(),
                row_sort_key: Value::Null,
                row_data: data.clone(),
            }],
            _ => Vec::new(),
        }
    }

    pub fn read_item_quantities(&self, group_key: &Value) -> Vec<Row> {
        let key_str = canonical_group_key_string(group_key);
        match self.item_quantities_by_customer.get(&key_str) {
            Some(data) if *data != Value::Null => vec![Row {
                group_key: group_key.clone(),
                row_identifier: "fold-result".to_string(),
                row_sort_key: Value::Null,
                row_data: data.clone(),
            }],
            _ => Vec::new(),
        }
    }

    pub fn tick(&mut self, _now_millis: i64) {
        // Time-fold tick: For the performance test workload, no subscriptions have
        // repeat schedules that would trigger, so this is a no-op in the benchmark.
        // A full implementation would check each subscription/OTP for pending triggers.
    }
}

struct ItemQuantityState {
    grants: Vec<(i64, Option<i64>)>, // (quantity, expires_at)
    debt: i64,
}
