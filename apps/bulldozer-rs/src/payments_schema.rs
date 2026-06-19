//! Payments schema defined on top of the generic bulldozer engine.
//! Direct port of bulldozer-js/src/payments/schema/index.ts.

use serde_json::{json, Value};
use std::collections::HashMap;

use crate::bulldozer::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const DAY_MS: i64 = 86_400_000;
const WEEK_MS: i64 = 7 * DAY_MS;
const MONTH_MS: i64 = 30 * DAY_MS;
const YEAR_MS: i64 = 365 * DAY_MS;

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

fn compare_numbers(a: &Value, b: &Value) -> std::cmp::Ordering {
    let na = a.as_f64().unwrap_or(0.0);
    let nb = b.as_f64().unwrap_or(0.0);
    na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
}

fn payment_provider(creation_source: &str) -> &'static str {
    if creation_source == "TEST_MODE" { "test_mode" } else { "stripe" }
}

fn repeat_interval_ms(repeat: &Value) -> Option<i64> {
    let arr = repeat.as_array()?;
    if arr.len() != 2 { return None; }
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

fn normalized_expires_when(item: &Value) -> Value {
    match item.get("expires").and_then(|v| v.as_str()) {
        Some(s) if s == "when-purchase-expires" || s == "when-repeated" => Value::String(s.to_string()),
        _ => Value::Null,
    }
}

fn product_line_id(product: &Value) -> Value {
    product.get("productLineId").cloned().unwrap_or(Value::Null)
}

fn charged_amount(product: &Value, price_id: &Value, quantity: i64) -> Value {
    let price_id_str = match price_id.as_str() {
        Some(s) => s,
        None => return json!({}),
    };
    let prices = match product.get("prices").and_then(|p| p.as_object()) {
        Some(p) => p,
        None => return json!({}),
    };
    let price = match prices.get(price_id_str).and_then(|p| p.as_object()) {
        Some(p) => p,
        None => return json!({}),
    };
    let mut result = serde_json::Map::new();
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
                result.insert(currency.clone(), Value::String((n * quantity as f64).to_string()));
            }
        }
    }
    Value::Object(result)
}

fn item_grants(product: &Value, quantity: i64) -> Vec<Value> {
    let items = match product.get("includedItems").and_then(|v| v.as_object()) {
        Some(items) => items,
        None => return Vec::new(),
    };
    items.iter().map(|(item_id, item)| {
        let item_qty = item.get("quantity").and_then(|q| q.as_i64()).unwrap_or(0);
        json!({
            "itemId": item_id,
            "quantity": item_qty * quantity,
            "expiresWhen": normalized_expires_when(item),
        })
    }).collect()
}

fn repeat_schedule(product: &Value, quantity: i64, anchor_millis: i64) -> Value {
    let items = match product.get("includedItems").and_then(|v| v.as_object()) {
        Some(items) => items,
        None => return json!({}),
    };
    let mut schedule = serde_json::Map::new();
    for (item_id, item) in items {
        let item_qty = item.get("quantity").and_then(|q| q.as_i64()).unwrap_or(0);
        let interval = item.get("repeat").map(|r| repeat_interval_ms(r)).unwrap_or(None);
        let next_repeat = interval.map(|ms| anchor_millis + ms);
        schedule.insert(item_id.clone(), json!({
            "quantity": item_qty * quantity,
            "expiresWhen": normalized_expires_when(item),
            "repeatIntervalMs": interval,
            "nextRepeatMillis": next_repeat,
        }));
    }
    Value::Object(schedule)
}

fn outstanding_grants(product: &Value, quantity: i64, txn_id: &str, base_index: usize) -> Vec<Value> {
    let items = match product.get("includedItems").and_then(|v| v.as_object()) {
        Some(items) => items,
        None => return Vec::new(),
    };
    items.iter().enumerate().map(|(i, (item_id, item))| {
        let item_qty = item.get("quantity").and_then(|q| q.as_i64()).unwrap_or(0);
        json!({
            "txnId": txn_id,
            "entryIndex": base_index + i,
            "itemId": item_id,
            "quantity": item_qty * quantity,
            "expiresWhen": normalized_expires_when(item),
        })
    }).collect()
}

fn soonest_next_millis(schedule: &Value, end_millis: Option<i64>) -> Option<i64> {
    let mut candidates: Vec<i64> = Vec::new();
    if let Some(obj) = schedule.as_object() {
        for (_, item) in obj {
            if let Some(next) = item.get("nextRepeatMillis").and_then(|v| v.as_i64()) {
                candidates.push(next);
            }
        }
    }
    if let Some(end) = end_millis {
        candidates.push(end);
    }
    candidates.into_iter().min()
}

fn customer_group_key(row_data: &Value) -> Value {
    json!({
        "tenancyId": row_data.get("tenancyId").cloned().unwrap_or(Value::Null),
        "customerType": row_data.get("customerType").cloned().unwrap_or(Value::Null),
        "customerId": row_data.get("customerId").cloned().unwrap_or(Value::Null),
    })
}

fn grant_refs_to_expire(grants: &Value, expires_when: &str, due_item_ids: Option<&Vec<String>>) -> Vec<Value> {
    let arr = match grants.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter().filter(|grant| {
        let ew = grant.get("expiresWhen").and_then(|v| v.as_str()).unwrap_or("");
        let matches = if expires_when == "both" {
            ew == "when-repeated" || ew == "when-purchase-expires"
        } else {
            ew == expires_when
        };
        if !matches { return false; }
        if let Some(ids) = due_item_ids {
            let item_id = grant.get("itemId").and_then(|v| v.as_str()).unwrap_or("");
            ids.contains(&item_id.to_string())
        } else {
            true
        }
    }).map(|grant| {
        json!({
            "transactionId": grant.get("txnId"),
            "entryIndex": grant.get("entryIndex"),
            "itemId": grant.get("itemId"),
            "quantity": grant.get("quantity"),
        })
    }).collect()
}

fn due_item_entries(schedule: &Value, current_millis: i64) -> Vec<(String, Value)> {
    let obj = match schedule.as_object() {
        Some(o) => o,
        None => return Vec::new(),
    };
    obj.iter().filter(|(_, item)| {
        item.get("nextRepeatMillis").and_then(|v| v.as_i64())
            .map_or(false, |next| next <= current_millis)
    }).map(|(id, item)| (id.clone(), item.clone())).collect()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Schema Table IDs
// ═══════════════════════════════════════════════════════════════════════════════

pub const SUBSCRIPTIONS: &str = "payments-subscriptions";
pub const SUBSCRIPTION_INVOICES: &str = "payments-subscription-invoices";
pub const ONE_TIME_PURCHASES: &str = "payments-one-time-purchases";
pub const MANUAL_ITEM_QTY_CHANGES: &str = "payments-manual-item-quantity-changes";
pub const MANUAL_TRANSACTIONS: &str = "payments-manual-transactions";
pub const TRANSACTIONS_BY_CUSTOMER: &str = "payments-transactions-by-customer";
pub const OWNED_PRODUCTS: &str = "payments-owned-products";
pub const ITEM_QUANTITIES: &str = "payments-item-quantities";

// ═══════════════════════════════════════════════════════════════════════════════
// Schema Construction
// ═══════════════════════════════════════════════════════════════════════════════

pub fn create_payments_database() -> Database {
    let mut db = Database::new();

    // ─── Stored Tables ─────────────────────────────────────────────────────────
    db.add_table(SUBSCRIPTIONS, Box::new(StoredTable::new()), HashMap::new());
    db.add_table(SUBSCRIPTION_INVOICES, Box::new(StoredTable::new()), HashMap::new());
    db.add_table(ONE_TIME_PURCHASES, Box::new(StoredTable::new()), HashMap::new());
    db.add_table(MANUAL_ITEM_QTY_CHANGES, Box::new(StoredTable::new()), HashMap::new());
    db.add_table(MANUAL_TRANSACTIONS, Box::new(StoredTable::new()), HashMap::new());

    // ─── Subscriptions with Invoices (left join) ───────────────────────────────
    db.add_table(
        "payments-subscriptions-with-invoices",
        Box::new(LeftJoinTable::new(
            Box::new(|row: &Row| {
                let d = &row.row_data;
                json!({"tenancyId": d.get("tenancyId"), "stripeSubscriptionId": d.get("stripeSubscriptionId")})
            }),
            Box::new(|row: &Row| {
                let d = &row.row_data;
                json!({"tenancyId": d.get("tenancyId"), "stripeSubscriptionId": d.get("stripeSubscriptionId")})
            }),
            Box::new(compare_json),
            Box::new(|left: &Row, right: Option<&Row>| {
                json!({"leftRowData": left.row_data, "rightRowData": right.map(|r| &r.row_data).cloned().unwrap_or(Value::Null)})
            }),
        )),
        HashMap::from([
            ("left".to_string(), SUBSCRIPTION_INVOICES.to_string()),
            ("right".to_string(), SUBSCRIPTIONS.to_string()),
        ]),
    );

    // ─── Renewal Invoice Rows (filter) ─────────────────────────────────────────
    db.add_table(
        "payments-renewal-invoice-rows",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            let right = row.row_data.get("rightRowData");
            let left = row.row_data.get("leftRowData");
            right.map_or(false, |r| !r.is_null())
                && left.and_then(|l| l.get("isSubscriptionCreationInvoice")).and_then(|v| v.as_bool()).unwrap_or(false) == false
        }))),
        HashMap::from([("input".to_string(), "payments-subscriptions-with-invoices".to_string())]),
    );

    // ─── Subscription Renewal Events (map) ─────────────────────────────────────
    db.add_table(
        "payments-subscription-renewal-events",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let sub = row.row_data.get("rightRowData").unwrap();
            let invoice = row.row_data.get("leftRowData").unwrap();
            let provider = payment_provider(sub.get("creationSource").and_then(|v| v.as_str()).unwrap_or(""));
            json!({
                "subscriptionId": sub.get("id"),
                "tenancyId": sub.get("tenancyId"),
                "customerId": sub.get("customerId"),
                "customerType": sub.get("customerType"),
                "invoiceId": invoice.get("id"),
                "chargedAmount": charged_amount(sub.get("product").unwrap_or(&Value::Null), sub.get("priceId").unwrap_or(&Value::Null), sub.get("quantity").and_then(|v| v.as_i64()).unwrap_or(1)),
                "paymentProvider": provider,
                "effectiveAtMillis": invoice.get("createdAtMillis"),
                "createdAtMillis": invoice.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-renewal-invoice-rows".to_string())]),
    );

    // ─── Cancel Pending Subscriptions (filter) ─────────────────────────────────
    db.add_table(
        "payments-cancel-pending-subscriptions",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            let cap = row.row_data.get("cancelAtPeriodEnd").and_then(|v| v.as_bool()).unwrap_or(false);
            let status = row.row_data.get("status").and_then(|v| v.as_str()).unwrap_or("");
            cap && (status == "active" || status == "trialing")
        }))),
        HashMap::from([("input".to_string(), SUBSCRIPTIONS.to_string())]),
    );

    // ─── Subscription Cancel Events (map) ──────────────────────────────────────
    db.add_table(
        "payments-subscription-cancel-events",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let provider = payment_provider(d.get("creationSource").and_then(|v| v.as_str()).unwrap_or(""));
            let effective = d.get("canceledAtMillis").filter(|v| !v.is_null())
                .or_else(|| d.get("createdAtMillis"));
            json!({
                "subscriptionId": d.get("id"),
                "tenancyId": d.get("tenancyId"),
                "customerId": d.get("customerId"),
                "customerType": d.get("customerType"),
                "changeType": "cancel",
                "paymentProvider": provider,
                "effectiveAtMillis": effective,
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-cancel-pending-subscriptions".to_string())]),
    );

    // ─── Subscription TimeFold ─────────────────────────────────────────────────
    db.add_table(
        "payments-subscription-timefold",
        Box::new(TimeFoldTable::new(
            json!({}),
            Box::new(|_state: &Value, row: &Row, trigger_time: Option<i64>| {
                let sub = &row.row_data;
                if trigger_time.is_none() {
                    // Initial: compute subscription start state
                    let provider = payment_provider(sub.get("creationSource").and_then(|v| v.as_str()).unwrap_or(""));
                    let product = sub.get("product").unwrap_or(&Value::Null);
                    let price_id = sub.get("priceId").unwrap_or(&Value::Null);
                    let quantity = sub.get("quantity").and_then(|v| v.as_i64()).unwrap_or(1);
                    let created_at = sub.get("createdAtMillis").and_then(|v| v.as_i64()).unwrap_or(0);
                    let ended_at = sub.get("endedAtMillis").and_then(|v| v.as_i64());
                    let period_end = sub.get("currentPeriodEndMillis").and_then(|v| v.as_i64()).unwrap_or(0);
                    let revoked_at = sub.get("productRevokedAtMillis").and_then(|v| v.as_i64());

                    let charged = charged_amount(product, price_id, quantity);
                    let has_money = provider != "test_mode" && charged.as_object().map_or(false, |o| !o.is_empty());
                    let grants = item_grants(product, quantity);
                    let start_txn_id = format!("sub-start:{}", sub.get("id").and_then(|v| v.as_str()).unwrap_or(""));
                    let start_product_grant_entry_index: usize = 1;
                    let start_item_change_base_index: usize = if has_money { 3 } else { 2 };

                    let schedule = repeat_schedule(product, quantity, created_at);
                    let has_repeat = schedule.as_object().map_or(false, |obj| {
                        obj.values().any(|item| item.get("nextRepeatMillis").map_or(false, |v| !v.is_null()))
                    });

                    let out_grants = outstanding_grants(product, quantity, &start_txn_id, start_item_change_base_index);

                    let initial_state = json!({
                        "subscriptionId": sub.get("id"),
                        "tenancyId": sub.get("tenancyId"),
                        "customerId": sub.get("customerId"),
                        "customerType": sub.get("customerType"),
                        "productId": sub.get("productId"),
                        "product": product,
                        "productLineId": product_line_id(product),
                        "priceId": price_id,
                        "quantity": quantity,
                        "paymentProvider": provider,
                        "endedAtMillis": ended_at,
                        "productRevokedAtMillis": revoked_at,
                        "chargedAmount": charged,
                        "startTxnId": start_txn_id,
                        "startProductGrantEntryIndex": start_product_grant_entry_index,
                        "startItemChangeBaseIndex": start_item_change_base_index,
                        "itemRepeatSchedule": schedule,
                        "outstandingGrants": out_grants,
                        "repeatCount": 0,
                    });

                    let start_event = json!({
                        "type": "subscription-start",
                        "subscriptionId": sub.get("id"),
                        "tenancyId": sub.get("tenancyId"),
                        "customerId": sub.get("customerId"),
                        "customerType": sub.get("customerType"),
                        "productId": sub.get("productId"),
                        "product": product,
                        "productLineId": product_line_id(product),
                        "priceId": price_id,
                        "quantity": quantity,
                        "chargedAmount": charged_amount(product, price_id, quantity),
                        "itemGrants": grants,
                        "paymentProvider": provider,
                        "effectiveAtMillis": created_at,
                        "createdAtMillis": created_at,
                    });

                    let immediate_end = ended_at.is_some() && !has_repeat
                        && ended_at.unwrap() < period_end && revoked_at.is_none();

                    if immediate_end {
                        let end_event = subscription_end_event(&initial_state);
                        let events = json!([start_event, end_event]);
                        TimeFoldResult {
                            new_state: initial_state,
                            new_row_data: events,
                            next_trigger_time_ms: None,
                        }
                    } else {
                        let next = soonest_next_millis(
                            initial_state.get("itemRepeatSchedule").unwrap_or(&Value::Null),
                            ended_at,
                        );
                        TimeFoldResult {
                            new_state: initial_state,
                            new_row_data: json!([start_event]),
                            next_trigger_time_ms: next,
                        }
                    }
                } else {
                    let current_millis = trigger_time.unwrap();
                    let ended_at = _state.get("endedAtMillis").and_then(|v| v.as_i64());
                    if ended_at.is_some() && ended_at.unwrap() <= current_millis {
                        let end_event = subscription_end_event(_state);
                        TimeFoldResult {
                            new_state: _state.clone(),
                            new_row_data: json!([end_event]),
                            next_trigger_time_ms: None,
                        }
                    } else {
                        let (new_state, event) = subscription_repeat_step(_state, current_millis);
                        let next = soonest_next_millis(
                            new_state.get("itemRepeatSchedule").unwrap_or(&Value::Null),
                            new_state.get("endedAtMillis").and_then(|v| v.as_i64()),
                        );
                        TimeFoldResult {
                            new_state,
                            new_row_data: json!([event]),
                            next_trigger_time_ms: next,
                        }
                    }
                }
            }),
        )),
        HashMap::from([("input".to_string(), SUBSCRIPTIONS.to_string())]),
    );

    // ─── Subscription Timefold Events (flatmap) ────────────────────────────────
    db.add_table(
        "payments-subscription-timefold-events",
        Box::new(FlatMapTable::new(Box::new(|row: &Row| {
            match row.row_data.as_array() {
                Some(arr) => arr.clone(),
                None => Vec::new(),
            }
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-timefold".to_string())]),
    );

    // ─── Subscription Start Events (filter) ────────────────────────────────────
    db.add_table(
        "payments-subscription-start-events",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("subscription-start")
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-timefold-events".to_string())]),
    );

    // ─── Subscription End Events (filter) ──────────────────────────────────────
    db.add_table(
        "payments-subscription-end-events",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("subscription-end")
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-timefold-events".to_string())]),
    );

    // ─── Item Grant Repeat from Subscriptions (filter) ─────────────────────────
    db.add_table(
        "payments-item-grant-repeat-from-subscriptions",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("item-grant-repeat")
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-timefold-events".to_string())]),
    );

    // ─── One Time Purchase Events (map) ────────────────────────────────────────
    db.add_table(
        "payments-one-time-purchase-events",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let product = d.get("product").unwrap_or(&Value::Null);
            let price_id = d.get("priceId").unwrap_or(&Value::Null);
            let quantity = d.get("quantity").and_then(|v| v.as_i64()).unwrap_or(1);
            let provider = payment_provider(d.get("creationSource").and_then(|v| v.as_str()).unwrap_or(""));
            json!({
                "purchaseId": d.get("id"),
                "tenancyId": d.get("tenancyId"),
                "customerId": d.get("customerId"),
                "customerType": d.get("customerType"),
                "productId": d.get("productId"),
                "product": product,
                "productLineId": product_line_id(product),
                "priceId": price_id,
                "quantity": quantity,
                "chargedAmount": charged_amount(product, price_id, quantity),
                "itemGrants": item_grants(product, quantity),
                "paymentProvider": provider,
                "effectiveAtMillis": d.get("createdAtMillis"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), ONE_TIME_PURCHASES.to_string())]),
    );

    // ─── OTP TimeFold ──────────────────────────────────────────────────────────
    db.add_table(
        "payments-otp-timefold",
        Box::new(TimeFoldTable::new(
            json!({}),
            Box::new(|_state: &Value, row: &Row, trigger_time: Option<i64>| {
                let purchase = &row.row_data;
                if trigger_time.is_none() {
                    let provider = payment_provider(purchase.get("creationSource").and_then(|v| v.as_str()).unwrap_or(""));
                    let product = purchase.get("product").unwrap_or(&Value::Null);
                    let quantity = purchase.get("quantity").and_then(|v| v.as_i64()).unwrap_or(1);
                    let created_at = purchase.get("createdAtMillis").and_then(|v| v.as_i64()).unwrap_or(0);
                    let revoked_at = purchase.get("revokedAtMillis").and_then(|v| v.as_i64());
                    let has_money = provider != "test_mode";
                    let txn_id = format!("otp:{}", purchase.get("id").and_then(|v| v.as_str()).unwrap_or(""));

                    // Only include items with repeat interval
                    let full_schedule = repeat_schedule(product, quantity, created_at);
                    let filtered_schedule = if let Some(obj) = full_schedule.as_object() {
                        let filtered: serde_json::Map<String, Value> = obj.iter()
                            .filter(|(_, v)| v.get("repeatIntervalMs").map_or(false, |ms| !ms.is_null()))
                            .map(|(k, v)| (k.clone(), v.clone()))
                            .collect();
                        Value::Object(filtered)
                    } else {
                        json!({})
                    };

                    let out_grants = outstanding_grants(product, quantity, &txn_id, if has_money { 2 } else { 1 });

                    let initial_state = json!({
                        "purchaseId": purchase.get("id"),
                        "tenancyId": purchase.get("tenancyId"),
                        "customerId": purchase.get("customerId"),
                        "customerType": purchase.get("customerType"),
                        "paymentProvider": provider,
                        "revokedAtMillis": revoked_at,
                        "itemRepeatSchedule": filtered_schedule,
                        "outstandingGrants": out_grants,
                        "repeatCount": 0,
                    });

                    let next = soonest_next_millis(&filtered_schedule, None);
                    let capped_next = match (next, revoked_at) {
                        (Some(n), Some(r)) if n > r => None,
                        _ => next,
                    };

                    TimeFoldResult {
                        new_state: initial_state,
                        new_row_data: json!([]),
                        next_trigger_time_ms: capped_next,
                    }
                } else {
                    let current_millis = trigger_time.unwrap();
                    let (new_state, event) = otp_repeat_step(_state, current_millis);
                    let next = soonest_next_millis(
                        new_state.get("itemRepeatSchedule").unwrap_or(&Value::Null),
                        None,
                    );
                    let capped_next = match (next, new_state.get("revokedAtMillis").and_then(|v| v.as_i64())) {
                        (Some(n), Some(r)) if n > r => None,
                        _ => next,
                    };
                    TimeFoldResult {
                        new_state,
                        new_row_data: json!([event]),
                        next_trigger_time_ms: capped_next,
                    }
                }
            }),
        )),
        HashMap::from([("input".to_string(), ONE_TIME_PURCHASES.to_string())]),
    );

    // ─── OTP Timefold Events (flatmap) ─────────────────────────────────────────
    db.add_table(
        "payments-otp-timefold-events",
        Box::new(FlatMapTable::new(Box::new(|row: &Row| {
            match row.row_data.as_array() {
                Some(arr) => arr.clone(),
                None => Vec::new(),
            }
        }))),
        HashMap::from([("input".to_string(), "payments-otp-timefold".to_string())]),
    );

    // ─── Item Grant Repeat from OTPs (filter) ──────────────────────────────────
    db.add_table(
        "payments-item-grant-repeat-from-otps",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("item-grant-repeat")
        }))),
        HashMap::from([("input".to_string(), "payments-otp-timefold-events".to_string())]),
    );

    // ─── Item Grant Repeat Events (concat) ─────────────────────────────────────
    db.add_table(
        "payments-item-grant-repeat-events",
        Box::new(ConcatTable::new(vec!["subscription".to_string(), "otp".to_string()])),
        HashMap::from([
            ("subscription".to_string(), "payments-item-grant-repeat-from-subscriptions".to_string()),
            ("otp".to_string(), "payments-item-grant-repeat-from-otps".to_string()),
        ]),
    );

    // ─── Manual Item Quantity Change Events (map) ──────────────────────────────
    db.add_table(
        "payments-manual-item-quantity-change-events",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            json!({
                "changeId": d.get("id"),
                "tenancyId": d.get("tenancyId"),
                "customerId": d.get("customerId"),
                "customerType": d.get("customerType"),
                "itemId": d.get("itemId"),
                "quantity": d.get("quantity"),
                "expiresAtMillis": d.get("expiresAtMillis"),
                "effectiveAtMillis": d.get("createdAtMillis"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), MANUAL_ITEM_QTY_CHANGES.to_string())]),
    );

    // ─── Transaction Tables (map from events to transactions) ──────────────────

    // Subscription Renewal Txn
    db.add_table(
        "payments-txn-subscription-renewal",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            json!({
                "txnId": format!("sub-renewal:{}", d.get("invoiceId").and_then(|v| v.as_str()).unwrap_or("")),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "subscription-renewal",
                "entries": [{"type": "money-transfer", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "chargedAmount": d.get("chargedAmount")}],
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": d.get("paymentProvider"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-renewal-events".to_string())]),
    );

    // Subscription Cancel Txn
    db.add_table(
        "payments-txn-subscription-cancel",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            json!({
                "txnId": format!("sub-cancel:{}", d.get("subscriptionId").and_then(|v| v.as_str()).unwrap_or("")),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "subscription-cancel",
                "entries": [{"type": "active-subscription-change", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "subscriptionId": d.get("subscriptionId"), "changeType": d.get("changeType")}],
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": d.get("paymentProvider"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-cancel-events".to_string())]),
    );

    // Subscription Start Txn
    db.add_table(
        "payments-txn-subscription-start",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let provider = d.get("paymentProvider").and_then(|v| v.as_str()).unwrap_or("test_mode");
            let charged = d.get("chargedAmount").unwrap_or(&Value::Null);
            let has_money = provider != "test_mode" && charged.as_object().map_or(false, |o| !o.is_empty());
            let grants = d.get("itemGrants").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            let mut entries: Vec<Value> = vec![
                json!({"type": "active-subscription-start", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "subscriptionId": d.get("subscriptionId")}),
                json!({"type": "product-grant", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "productId": d.get("productId"), "product": d.get("product"), "productLineId": d.get("productLineId"), "quantity": d.get("quantity"), "subscriptionId": d.get("subscriptionId")}),
            ];
            if has_money {
                entries.push(json!({"type": "money-transfer", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "chargedAmount": charged}));
            }
            for grant in &grants {
                entries.push(json!({"type": "item-quantity-change", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "itemId": grant.get("itemId"), "quantity": grant.get("quantity"), "expiresWhen": grant.get("expiresWhen")}));
            }

            json!({
                "txnId": format!("sub-start:{}", d.get("subscriptionId").and_then(|v| v.as_str()).unwrap_or("")),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "subscription-start",
                "entries": entries,
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": d.get("paymentProvider"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-start-events".to_string())]),
    );

    // Subscription End Events Natural (filter - no revocation)
    db.add_table(
        "payments-subscription-end-events-natural",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("productRevokedAtMillis").map_or(true, |v| v.is_null())
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-end-events".to_string())]),
    );

    // Subscription End Txn
    db.add_table(
        "payments-txn-subscription-end",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let expire_refs = d.get("itemQuantityChangesToExpire").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            let mut entries: Vec<Value> = vec![
                json!({"type": "active-subscription-end", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "subscriptionId": d.get("subscriptionId")}),
                json!({"type": "product-revocation", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "adjustedTransactionId": d.get("startProductGrantRef").and_then(|v| v.get("transactionId")), "adjustedEntryIndex": d.get("startProductGrantRef").and_then(|v| v.get("entryIndex")), "quantity": d.get("quantity"), "productId": d.get("productId"), "productLineId": d.get("productLineId")}),
            ];
            for entry in &expire_refs {
                entries.push(json!({"type": "item-quantity-expire", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "adjustedTransactionId": entry.get("transactionId"), "adjustedEntryIndex": entry.get("entryIndex"), "quantity": entry.get("quantity"), "itemId": entry.get("itemId")}));
            }

            json!({
                "txnId": format!("sub-end:{}", d.get("subscriptionId").and_then(|v| v.as_str()).unwrap_or("")),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "subscription-end",
                "entries": entries,
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": d.get("paymentProvider"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-subscription-end-events-natural".to_string())]),
    );

    // Item Grant Repeat Txn
    db.add_table(
        "payments-txn-item-grant-repeat",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let prev_expire = d.get("previousGrantsToExpire").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let grants = d.get("itemGrants").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            let mut entries: Vec<Value> = Vec::new();
            for entry in &prev_expire {
                entries.push(json!({"type": "item-quantity-expire", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "adjustedTransactionId": entry.get("transactionId"), "adjustedEntryIndex": entry.get("entryIndex"), "quantity": entry.get("quantity"), "itemId": entry.get("itemId")}));
            }
            for grant in &grants {
                entries.push(json!({"type": "item-quantity-change", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "itemId": grant.get("itemId"), "quantity": grant.get("quantity"), "expiresWhen": grant.get("expiresWhen")}));
            }

            json!({
                "txnId": format!("igr:{}:{}", d.get("sourceId").and_then(|v| v.as_str()).unwrap_or(""), d.get("effectiveAtMillis").and_then(|v| v.as_i64()).unwrap_or(0)),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "item-grant-repeat",
                "entries": entries,
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": d.get("paymentProvider"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-item-grant-repeat-events".to_string())]),
    );

    // One Time Purchase Txn
    db.add_table(
        "payments-txn-one-time-purchase",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let provider = d.get("paymentProvider").and_then(|v| v.as_str()).unwrap_or("test_mode");
            let charged = d.get("chargedAmount").unwrap_or(&Value::Null);
            let has_money = provider != "test_mode" && charged.as_object().map_or(false, |o| !o.is_empty());
            let grants = d.get("itemGrants").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            let mut entries: Vec<Value> = vec![
                json!({"type": "product-grant", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "productId": d.get("productId"), "product": d.get("product"), "productLineId": d.get("productLineId"), "quantity": d.get("quantity"), "oneTimePurchaseId": d.get("purchaseId")}),
            ];
            if has_money {
                entries.push(json!({"type": "money-transfer", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "chargedAmount": charged}));
            }
            for grant in &grants {
                entries.push(json!({"type": "item-quantity-change", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "itemId": grant.get("itemId"), "quantity": grant.get("quantity"), "expiresWhen": grant.get("expiresWhen")}));
            }

            json!({
                "txnId": format!("otp:{}", d.get("purchaseId").and_then(|v| v.as_str()).unwrap_or("")),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "one-time-purchase",
                "entries": entries,
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": d.get("paymentProvider"),
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-one-time-purchase-events".to_string())]),
    );

    // Manual Item Quantity Change Txn
    db.add_table(
        "payments-txn-manual-item-quantity-change",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            json!({
                "txnId": format!("miqc:{}", d.get("changeId").and_then(|v| v.as_str()).unwrap_or("")),
                "tenancyId": d.get("tenancyId"),
                "effectiveAtMillis": d.get("effectiveAtMillis"),
                "type": "manual-item-quantity-change",
                "entries": [{"type": "item-quantity-change", "customerType": d.get("customerType"), "customerId": d.get("customerId"), "itemId": d.get("itemId"), "quantity": d.get("quantity"), "expiresWhen": d.get("expiresAtMillis")}],
                "customerType": d.get("customerType"),
                "customerId": d.get("customerId"),
                "paymentProvider": Value::Null,
                "createdAtMillis": d.get("createdAtMillis"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-manual-item-quantity-change-events".to_string())]),
    );

    // Refund filter (from manual transactions)
    db.add_table(
        "payments-txn-refund",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("refund")
        }))),
        HashMap::from([("input".to_string(), MANUAL_TRANSACTIONS.to_string())]),
    );

    // ─── Transactions Concat ───────────────────────────────────────────────────
    db.add_table(
        "payments-transactions",
        Box::new(ConcatTable::new(vec![
            "renewal".to_string(), "cancel".to_string(), "start".to_string(),
            "end".to_string(), "repeat".to_string(), "otp".to_string(),
            "manual".to_string(), "refund".to_string(),
        ])),
        HashMap::from([
            ("renewal".to_string(), "payments-txn-subscription-renewal".to_string()),
            ("cancel".to_string(), "payments-txn-subscription-cancel".to_string()),
            ("start".to_string(), "payments-txn-subscription-start".to_string()),
            ("end".to_string(), "payments-txn-subscription-end".to_string()),
            ("repeat".to_string(), "payments-txn-item-grant-repeat".to_string()),
            ("otp".to_string(), "payments-txn-one-time-purchase".to_string()),
            ("manual".to_string(), "payments-txn-manual-item-quantity-change".to_string()),
            ("refund".to_string(), "payments-txn-refund".to_string()),
        ]),
    );

    // ─── Transactions By Customer (group-by) ───────────────────────────────────
    db.add_table(
        TRANSACTIONS_BY_CUSTOMER,
        Box::new(GroupByTable::new(
            Box::new(|row: &Row| customer_group_key(&row.row_data)),
            Box::new(compare_json),
            Box::new(compare_json),
        )),
        HashMap::from([("input".to_string(), "payments-transactions".to_string())]),
    );

    // ─── Transaction Entries (flatmap) ─────────────────────────────────────────
    db.add_table(
        "payments-transaction-entries",
        Box::new(FlatMapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let entries = d.get("entries").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            entries.into_iter().enumerate().map(|(i, mut entry)| {
                if let Some(obj) = entry.as_object_mut() {
                    obj.insert("index".to_string(), json!(i));
                    obj.insert("txnId".to_string(), d.get("txnId").cloned().unwrap_or(Value::Null));
                    obj.insert("txnEffectiveAtMillis".to_string(), d.get("effectiveAtMillis").cloned().unwrap_or(Value::Null));
                    obj.insert("txnCreatedAtMillis".to_string(), d.get("createdAtMillis").cloned().unwrap_or(Value::Null));
                    obj.insert("txnType".to_string(), d.get("type").cloned().unwrap_or(Value::Null));
                    obj.insert("tenancyId".to_string(), d.get("tenancyId").cloned().unwrap_or(Value::Null));
                    obj.insert("paymentProvider".to_string(), d.get("paymentProvider").cloned().unwrap_or(Value::Null));
                }
                entry
            }).collect()
        }))),
        HashMap::from([("input".to_string(), TRANSACTIONS_BY_CUSTOMER.to_string())]),
    );

    // ─── Item Quantity Change filters ──────────────────────────────────────────
    db.add_table(
        "payments-entries-item-quantity-change-all",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("item-quantity-change")
        }))),
        HashMap::from([("input".to_string(), "payments-transaction-entries".to_string())]),
    );

    db.add_table(
        "payments-entries-item-quantity-change-compactable",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("expiresWhen").map_or(true, |v| v.is_null())
        }))),
        HashMap::from([("input".to_string(), "payments-entries-item-quantity-change-all".to_string())]),
    );

    db.add_table(
        "payments-entries-item-quantity-change-non-compactable",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("expiresWhen").map_or(false, |v| !v.is_null())
        }))),
        HashMap::from([("input".to_string(), "payments-entries-item-quantity-change-all".to_string())]),
    );

    // Compactable -> aggregates
    db.add_table(
        "payments-entries-item-quantity-change-compactable-aggregates",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let item_id = d.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            json!({
                "type": "item-quantity-compaction-aggregate",
                "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                "txnId": d.get("txnId"),
                "index": d.get("index"),
                "items": { item_id: { "firstRow": d, "quantity": d.get("quantity") } },
            })
        }))),
        HashMap::from([("input".to_string(), "payments-entries-item-quantity-change-compactable".to_string())]),
    );

    // Item quantity expire entries
    db.add_table(
        "payments-entries-item-quantity-expire",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("item-quantity-expire")
        }))),
        HashMap::from([("input".to_string(), "payments-transaction-entries".to_string())]),
    );

    // Compaction boundaries
    db.add_table(
        "payments-entries-compaction-boundaries",
        Box::new(MapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            json!({
                "type": "item-quantity-compaction-boundary",
                "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                "txnId": d.get("txnId"),
                "index": d.get("index"),
            })
        }))),
        HashMap::from([("input".to_string(), "payments-entries-item-quantity-expire".to_string())]),
    );

    // Compaction input (concat)
    db.add_table(
        "payments-entries-compaction-input",
        Box::new(ConcatTable::new(vec!["compactable".to_string(), "boundary".to_string()])),
        HashMap::from([
            ("compactable".to_string(), "payments-entries-item-quantity-change-compactable-aggregates".to_string()),
            ("boundary".to_string(), "payments-entries-compaction-boundaries".to_string()),
        ]),
    );

    // Compaction input sorted
    db.add_table(
        "payments-entries-compaction-input-sorted",
        Box::new(SortTable::new(
            Box::new(|row: &Row| {
                let d = &row.row_data;
                let is_boundary = d.get("type").and_then(|v| v.as_str()) == Some("item-quantity-compaction-boundary");
                json!({
                    "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                    "boundaryOrder": if is_boundary { 0 } else { 1 },
                    "txnId": d.get("txnId").cloned().unwrap_or_else(|| json!(row.row_identifier)),
                    "index": d.get("index").cloned().unwrap_or(json!(0)),
                    "rowIdentifier": row.row_identifier.clone(),
                })
            }),
            Box::new(|a: &Value, b: &Value| {
                let cmp_field = |field: &str| -> std::cmp::Ordering {
                    let va = a.get(field);
                    let vb = b.get(field);
                    match (va, vb) {
                        (Some(va), Some(vb)) => {
                            let na = va.as_f64().unwrap_or(0.0);
                            let nb = vb.as_f64().unwrap_or(0.0);
                            na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                        }
                        _ => std::cmp::Ordering::Equal,
                    }
                };
                cmp_field("txnEffectiveAtMillis")
                    .then(cmp_field("boundaryOrder"))
                    .then_with(|| {
                        let sa = a.get("txnId").and_then(|v| v.as_str()).unwrap_or("");
                        let sb = b.get("txnId").and_then(|v| v.as_str()).unwrap_or("");
                        sa.cmp(sb)
                    })
                    .then(cmp_field("index"))
                    .then_with(|| {
                        let sa = a.get("rowIdentifier").and_then(|v| v.as_str()).unwrap_or("");
                        let sb = b.get("rowIdentifier").and_then(|v| v.as_str()).unwrap_or("");
                        sa.cmp(sb)
                    })
            }),
        )),
        HashMap::from([("input".to_string(), "payments-entries-compaction-input".to_string())]),
    );

    // Compacted raw (compact table)
    db.add_table(
        "payments-entries-compacted-raw",
        Box::new(CompactTable::new(
            Box::new(|left: &Value, right: &Value| {
                let left_is_boundary = left.get("type").and_then(|v| v.as_str()) == Some("item-quantity-compaction-boundary");
                let right_is_boundary = right.get("type").and_then(|v| v.as_str()) == Some("item-quantity-compaction-boundary");
                if left_is_boundary || right_is_boundary {
                    vec![left.clone(), right.clone()]
                } else {
                    // Merge aggregates
                    vec![merge_compaction_aggregates(left, right)]
                }
            }),
            Box::new(|a: &Value, b: &Value| {
                let cmp_field = |field: &str| -> std::cmp::Ordering {
                    let na = a.get(field).and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let nb = b.get(field).and_then(|v| v.as_f64()).unwrap_or(0.0);
                    na.partial_cmp(&nb).unwrap_or(std::cmp::Ordering::Equal)
                };
                cmp_field("txnEffectiveAtMillis")
                    .then_with(|| {
                        let la = a.get("type").and_then(|v| v.as_str()) == Some("item-quantity-compaction-boundary");
                        let lb = b.get("type").and_then(|v| v.as_str()) == Some("item-quantity-compaction-boundary");
                        (if la { 0i32 } else { 1 }).cmp(&(if lb { 0 } else { 1 }))
                    })
                    .then_with(|| {
                        let sa = a.get("txnId").and_then(|v| v.as_str()).unwrap_or("");
                        let sb = b.get("txnId").and_then(|v| v.as_str()).unwrap_or("");
                        sa.cmp(sb)
                    })
                    .then(cmp_field("index"))
            }),
        )),
        HashMap::from([("input".to_string(), "payments-entries-compaction-input-sorted".to_string())]),
    );

    // Compacted aggregates (filter)
    db.add_table(
        "payments-entries-compacted-aggregates",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) == Some("item-quantity-compaction-aggregate")
        }))),
        HashMap::from([("input".to_string(), "payments-entries-compacted-raw".to_string())]),
    );

    // Compacted item quantity change (flatmap from aggregates)
    db.add_table(
        "payments-entries-compacted-item-quantity-change",
        Box::new(FlatMapTable::new(Box::new(|row: &Row| {
            let items = row.row_data.get("items").and_then(|v| v.as_object()).cloned().unwrap_or_default();
            items.values().map(|item| {
                let first_row = item.get("firstRow").unwrap_or(&Value::Null);
                let mut result = first_row.clone();
                if let Some(obj) = result.as_object_mut() {
                    obj.insert("type".to_string(), json!("compacted-item-quantity-change"));
                    obj.insert("quantity".to_string(), item.get("quantity").cloned().unwrap_or(json!(0)));
                    obj.insert("expiresWhen".to_string(), Value::Null);
                }
                result
            }).collect()
        }))),
        HashMap::from([("input".to_string(), "payments-entries-compacted-aggregates".to_string())]),
    );

    // Passthrough non-item-quantity-change entries
    db.add_table(
        "payments-entries-passthrough-non-item-quantity-change",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            row.row_data.get("type").and_then(|v| v.as_str()) != Some("item-quantity-change")
        }))),
        HashMap::from([("input".to_string(), "payments-transaction-entries".to_string())]),
    );

    // Compacted transaction entries (concat)
    db.add_table(
        "payments-compacted-transaction-entries",
        Box::new(ConcatTable::new(vec!["passthrough".to_string(), "compacted".to_string(), "nonCompactable".to_string()])),
        HashMap::from([
            ("passthrough".to_string(), "payments-entries-passthrough-non-item-quantity-change".to_string()),
            ("compacted".to_string(), "payments-entries-compacted-item-quantity-change".to_string()),
            ("nonCompactable".to_string(), "payments-entries-item-quantity-change-non-compactable".to_string()),
        ]),
    );

    // ─── Product entries ───────────────────────────────────────────────────────
    db.add_table(
        "payments-product-entries",
        Box::new(FilterTable::new(Box::new(|row: &Row| {
            let t = row.row_data.get("type").and_then(|v| v.as_str()).unwrap_or("");
            t == "product-grant" || t == "product-revocation"
        }))),
        HashMap::from([("input".to_string(), "payments-compacted-transaction-entries".to_string())]),
    );

    db.add_table(
        "payments-product-entries-sorted",
        Box::new(SortTable::new(
            Box::new(|row: &Row| row.row_data.get("txnEffectiveAtMillis").cloned().unwrap_or(json!(0))),
            Box::new(compare_numbers),
        )),
        HashMap::from([("input".to_string(), "payments-product-entries".to_string())]),
    );

    // Owned Products (left-fold)
    db.add_table(
        OWNED_PRODUCTS,
        Box::new(LeftFoldTable::new(
            json!({}),
            Box::new(|state: &Value, row: &Row| {
                let d = &row.row_data;
                let entry_type = d.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let product_id = d.get("productId").and_then(|v| v.as_str()).unwrap_or("__null__");
                let key = if d.get("productId").map_or(true, |v| v.is_null()) { "__null__" } else { product_id };
                let quantity = d.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);

                let mut current = state.as_object().cloned().unwrap_or_default();
                let old = current.get(key).and_then(|v| v.get("quantity")).and_then(|v| v.as_i64()).unwrap_or(0);
                let next_qty = if entry_type == "product-grant" {
                    (old + quantity).max(0)
                } else {
                    (old - quantity).max(0)
                };

                let product_val = if entry_type == "product-grant" {
                    d.get("product").cloned().unwrap_or(Value::Null)
                } else {
                    current.get(key).and_then(|v| v.get("product")).cloned().unwrap_or(Value::Null)
                };
                let pline = if entry_type == "product-grant" {
                    d.get("productLineId").cloned().unwrap_or(Value::Null)
                } else {
                    current.get(key).and_then(|v| v.get("productLineId")).cloned().unwrap_or(Value::Null)
                };

                current.insert(key.to_string(), json!({"quantity": next_qty, "product": product_val, "productLineId": pline}));
                let next = Value::Object(current);
                let output = json!({
                    "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                    "txnId": d.get("txnId"),
                    "ownedProducts": next,
                    "customerType": d.get("customerType"),
                    "customerId": d.get("customerId"),
                    "tenancyId": d.get("tenancyId"),
                });
                (next, output)
            }),
            Box::new(compare_numbers),
        )),
        HashMap::from([("input".to_string(), "payments-product-entries-sorted".to_string())]),
    );

    // ─── Item Quantities ───────────────────────────────────────────────────────

    // Split item changes with expiry
    db.add_table(
        "payments-split-item-changes-with-expiry",
        Box::new(FlatMapTable::new(Box::new(|row: &Row| {
            let d = &row.row_data;
            let entry_type = d.get("type").and_then(|v| v.as_str()).unwrap_or("");

            if entry_type == "item-quantity-expire" {
                return vec![json!({
                    "txnId": d.get("txnId"), "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                    "customerType": d.get("customerType"), "customerId": d.get("customerId"),
                    "tenancyId": d.get("tenancyId"), "itemId": d.get("itemId"),
                    "quantity": d.get("quantity").and_then(|v| v.as_i64()).map(|q| -q),
                    "expiresAtMillis": Value::Null,
                })];
            }
            if entry_type == "compacted-item-quantity-change" {
                return vec![json!({
                    "txnId": d.get("txnId"), "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                    "customerType": d.get("customerType"), "customerId": d.get("customerId"),
                    "tenancyId": d.get("tenancyId"), "itemId": d.get("itemId"),
                    "quantity": d.get("quantity"), "expiresAtMillis": Value::Null,
                })];
            }
            if entry_type != "item-quantity-change" {
                return Vec::new();
            }

            let expires_when = d.get("expiresWhen").unwrap_or(&Value::Null);
            let effective = d.get("txnEffectiveAtMillis").and_then(|v| v.as_i64()).unwrap_or(0);
            let qty = d.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);

            if let Some(exp_millis) = expires_when.as_i64() {
                if exp_millis > effective && qty > 0 {
                    return vec![
                        json!({
                            "txnId": d.get("txnId"), "txnEffectiveAtMillis": effective,
                            "customerType": d.get("customerType"), "customerId": d.get("customerId"),
                            "tenancyId": d.get("tenancyId"), "itemId": d.get("itemId"),
                            "quantity": qty, "expiresAtMillis": exp_millis,
                        }),
                        json!({
                            "txnId": d.get("txnId"), "txnEffectiveAtMillis": exp_millis,
                            "customerType": d.get("customerType"), "customerId": d.get("customerId"),
                            "tenancyId": d.get("tenancyId"), "itemId": d.get("itemId"),
                            "quantity": -qty, "expiresAtMillis": Value::Null,
                        }),
                    ];
                }
            }

            vec![json!({
                "txnId": d.get("txnId"), "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                "customerType": d.get("customerType"), "customerId": d.get("customerId"),
                "tenancyId": d.get("tenancyId"), "itemId": d.get("itemId"),
                "quantity": d.get("quantity"), "expiresAtMillis": Value::Null,
            })]
        }))),
        HashMap::from([("input".to_string(), "payments-compacted-transaction-entries".to_string())]),
    );

    // Changes sorted for ledger
    db.add_table(
        "payments-changes-sorted-for-ledger",
        Box::new(SortTable::new(
            Box::new(|row: &Row| row.row_data.get("txnEffectiveAtMillis").cloned().unwrap_or(json!(0))),
            Box::new(compare_numbers),
        )),
        HashMap::from([("input".to_string(), "payments-split-item-changes-with-expiry".to_string())]),
    );

    // Item Quantities (left-fold)
    db.add_table(
        ITEM_QUANTITIES,
        Box::new(LeftFoldTable::new(
            json!({}),
            Box::new(|state: &Value, row: &Row| {
                let d = &row.row_data;
                let item_id = d.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let quantity = d.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);
                let expires_at = d.get("expiresAtMillis").and_then(|v| v.as_i64());

                let mut current = state.as_object().cloned().unwrap_or_default();
                let old_item = current.get(&item_id).cloned().unwrap_or(json!({"grants": [], "debt": 0}));
                let mut grants: Vec<(i64, Option<i64>)> = old_item.get("grants").and_then(|v| v.as_array())
                    .map(|arr| arr.iter().map(|g| {
                        let q = g.get("q").and_then(|v| v.as_i64()).unwrap_or(0);
                        let e = g.get("e").and_then(|v| v.as_i64());
                        (q, e)
                    }).collect())
                    .unwrap_or_default();
                let mut debt = old_item.get("debt").and_then(|v| v.as_i64()).unwrap_or(0);

                if quantity > 0 {
                    let after = quantity + debt;
                    if after > 0 {
                        grants.push((after, expires_at));
                        debt = 0;
                    } else {
                        debt = after;
                    }
                } else if quantity < 0 {
                    let mut remaining = quantity.unsigned_abs() as i64;
                    // Sort grants by expiry (earliest first, null = infinity)
                    grants.sort_by(|a, b| {
                        let ea = a.1.unwrap_or(i64::MAX);
                        let eb = b.1.unwrap_or(i64::MAX);
                        ea.cmp(&eb)
                    });
                    let mut next_grants = Vec::new();
                    for (q, e) in &grants {
                        let consumed = (*q).min(remaining);
                        remaining -= consumed;
                        if *q > consumed {
                            next_grants.push((*q - consumed, *e));
                        }
                    }
                    grants = next_grants;
                    debt -= remaining;
                } else {
                    // quantity == 0: filter out expired grants
                    let effective = d.get("txnEffectiveAtMillis").and_then(|v| v.as_i64()).unwrap_or(0);
                    grants.retain(|(_, e)| e.is_none() || e.unwrap() > effective);
                }

                let grants_json: Vec<Value> = grants.iter().map(|(q, e)| {
                    json!({"q": q, "e": e})
                }).collect();

                current.insert(item_id, json!({"grants": grants_json, "debt": debt}));

                // Compute current quantities
                let quantities: serde_json::Map<String, Value> = current.iter().map(|(k, v)| {
                    let item_grants = v.get("grants").and_then(|g| g.as_array())
                        .map(|arr| arr.iter().map(|g| g.get("q").and_then(|v| v.as_i64()).unwrap_or(0)).sum::<i64>())
                        .unwrap_or(0);
                    let item_debt = v.get("debt").and_then(|d| d.as_i64()).unwrap_or(0);
                    (k.clone(), json!(item_grants + item_debt))
                }).collect();

                let next = Value::Object(current);
                let output = json!({
                    "txnEffectiveAtMillis": d.get("txnEffectiveAtMillis"),
                    "txnId": d.get("txnId"),
                    "itemQuantities": Value::Object(quantities),
                    "customerType": d.get("customerType"),
                    "customerId": d.get("customerId"),
                    "tenancyId": d.get("tenancyId"),
                });
                (next, output)
            }),
            Box::new(compare_numbers),
        )),
        HashMap::from([("input".to_string(), "payments-changes-sorted-for-ledger".to_string())]),
    );

    db
}

// ═══════════════════════════════════════════════════════════════════════════════
// Business Logic Helpers (subscription/OTP event generation)
// ═══════════════════════════════════════════════════════════════════════════════

fn subscription_end_event(state: &Value) -> Value {
    json!({
        "type": "subscription-end",
        "subscriptionId": state.get("subscriptionId"),
        "tenancyId": state.get("tenancyId"),
        "customerId": state.get("customerId"),
        "customerType": state.get("customerType"),
        "productId": state.get("productId"),
        "productLineId": state.get("productLineId"),
        "quantity": state.get("quantity"),
        "startProductGrantRef": {
            "transactionId": state.get("startTxnId"),
            "entryIndex": state.get("startProductGrantEntryIndex"),
        },
        "itemQuantityChangesToExpire": grant_refs_to_expire(
            state.get("outstandingGrants").unwrap_or(&Value::Null),
            "both",
            None,
        ),
        "productRevokedAtMillis": state.get("productRevokedAtMillis"),
        "paymentProvider": state.get("paymentProvider"),
        "effectiveAtMillis": state.get("endedAtMillis"),
        "createdAtMillis": state.get("endedAtMillis"),
    })
}

fn subscription_repeat_step(state: &Value, current_millis: i64) -> (Value, Value) {
    let schedule = state.get("itemRepeatSchedule").unwrap_or(&Value::Null);
    let due_items = due_item_entries(schedule, current_millis);
    let due_ids: Vec<String> = due_items.iter().map(|(id, _)| id.clone()).collect();

    let prev_expire = grant_refs_to_expire(
        state.get("outstandingGrants").unwrap_or(&Value::Null),
        "when-repeated",
        Some(&due_ids),
    );

    let item_repeat_grants: Vec<Value> = due_items.iter().map(|(item_id, item)| {
        json!({
            "itemId": item_id,
            "quantity": item.get("quantity"),
            "expiresWhen": item.get("expiresWhen"),
        })
    }).collect();

    let sub_id = state.get("subscriptionId").and_then(|v| v.as_str()).unwrap_or("");
    let txn_id = format!("igr:{}:{}", sub_id, current_millis);

    // Update outstanding grants
    let old_grants = state.get("outstandingGrants").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut next_grants: Vec<Value> = old_grants.into_iter().filter(|grant| {
        let ew = grant.get("expiresWhen").and_then(|v| v.as_str()).unwrap_or("");
        let gid = grant.get("itemId").and_then(|v| v.as_str()).unwrap_or("");
        !(ew == "when-repeated" && due_ids.contains(&gid.to_string()))
    }).collect();
    for (i, (item_id, item)) in due_items.iter().enumerate() {
        next_grants.push(json!({
            "txnId": txn_id,
            "entryIndex": prev_expire.len() + i,
            "itemId": item_id,
            "quantity": item.get("quantity"),
            "expiresWhen": item.get("expiresWhen"),
        }));
    }

    // Update schedule
    let mut next_schedule = schedule.as_object().cloned().unwrap_or_default();
    for (item_id, item) in &next_schedule.clone() {
        let next_repeat = item.get("nextRepeatMillis").and_then(|v| v.as_i64());
        let interval = item.get("repeatIntervalMs").and_then(|v| v.as_i64());
        if let (Some(nr), Some(int)) = (next_repeat, interval) {
            if nr <= current_millis {
                let mut updated = item.clone();
                if let Some(obj) = updated.as_object_mut() {
                    obj.insert("nextRepeatMillis".to_string(), json!(nr + int));
                }
                next_schedule.insert(item_id.clone(), updated);
            }
        }
    }

    let repeat_count = state.get("repeatCount").and_then(|v| v.as_i64()).unwrap_or(0);

    let mut new_state = state.clone();
    if let Some(obj) = new_state.as_object_mut() {
        obj.insert("outstandingGrants".to_string(), json!(next_grants));
        obj.insert("itemRepeatSchedule".to_string(), Value::Object(next_schedule));
        obj.insert("repeatCount".to_string(), json!(repeat_count + 1));
    }

    let event = json!({
        "type": "item-grant-repeat",
        "sourceType": "subscription",
        "sourceId": state.get("subscriptionId"),
        "tenancyId": state.get("tenancyId"),
        "customerId": state.get("customerId"),
        "customerType": state.get("customerType"),
        "itemGrants": item_repeat_grants,
        "previousGrantsToExpire": prev_expire,
        "paymentProvider": state.get("paymentProvider"),
        "effectiveAtMillis": current_millis,
        "createdAtMillis": current_millis,
    });

    (new_state, event)
}

fn otp_repeat_step(state: &Value, current_millis: i64) -> (Value, Value) {
    let schedule = state.get("itemRepeatSchedule").unwrap_or(&Value::Null);
    let due_items = due_item_entries(schedule, current_millis);
    let due_ids: Vec<String> = due_items.iter().map(|(id, _)| id.clone()).collect();

    let prev_expire = grant_refs_to_expire(
        state.get("outstandingGrants").unwrap_or(&Value::Null),
        "when-repeated",
        Some(&due_ids),
    );

    let item_repeat_grants: Vec<Value> = due_items.iter().map(|(item_id, item)| {
        json!({
            "itemId": item_id,
            "quantity": item.get("quantity"),
            "expiresWhen": item.get("expiresWhen"),
        })
    }).collect();

    let purchase_id = state.get("purchaseId").and_then(|v| v.as_str()).unwrap_or("");
    let txn_id = format!("igr:{}:{}", purchase_id, current_millis);

    let old_grants = state.get("outstandingGrants").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut next_grants: Vec<Value> = old_grants.into_iter().filter(|grant| {
        let ew = grant.get("expiresWhen").and_then(|v| v.as_str()).unwrap_or("");
        let gid = grant.get("itemId").and_then(|v| v.as_str()).unwrap_or("");
        !(ew == "when-repeated" && due_ids.contains(&gid.to_string()))
    }).collect();
    for (i, (item_id, item)) in due_items.iter().enumerate() {
        next_grants.push(json!({
            "txnId": txn_id,
            "entryIndex": prev_expire.len() + i,
            "itemId": item_id,
            "quantity": item.get("quantity"),
            "expiresWhen": item.get("expiresWhen"),
        }));
    }

    let mut next_schedule = schedule.as_object().cloned().unwrap_or_default();
    for (item_id, item) in &next_schedule.clone() {
        let next_repeat = item.get("nextRepeatMillis").and_then(|v| v.as_i64());
        let interval = item.get("repeatIntervalMs").and_then(|v| v.as_i64());
        if let (Some(nr), Some(int)) = (next_repeat, interval) {
            if nr <= current_millis {
                let mut updated = item.clone();
                if let Some(obj) = updated.as_object_mut() {
                    obj.insert("nextRepeatMillis".to_string(), json!(nr + int));
                }
                next_schedule.insert(item_id.clone(), updated);
            }
        }
    }

    let repeat_count = state.get("repeatCount").and_then(|v| v.as_i64()).unwrap_or(0);

    let mut new_state = state.clone();
    if let Some(obj) = new_state.as_object_mut() {
        obj.insert("outstandingGrants".to_string(), json!(next_grants));
        obj.insert("itemRepeatSchedule".to_string(), Value::Object(next_schedule));
        obj.insert("repeatCount".to_string(), json!(repeat_count + 1));
    }

    let event = json!({
        "type": "item-grant-repeat",
        "sourceType": "one_time_purchase",
        "sourceId": state.get("purchaseId"),
        "tenancyId": state.get("tenancyId"),
        "customerId": state.get("customerId"),
        "customerType": state.get("customerType"),
        "itemGrants": item_repeat_grants,
        "previousGrantsToExpire": prev_expire,
        "paymentProvider": state.get("paymentProvider"),
        "effectiveAtMillis": current_millis,
        "createdAtMillis": current_millis,
    });

    (new_state, event)
}

fn merge_compaction_aggregates(a: &Value, b: &Value) -> Value {
    let a_items = a.get("items").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let b_items = b.get("items").and_then(|v| v.as_object()).cloned().unwrap_or_default();

    let mut merged = a_items.clone();
    for (item_id, b_item) in &b_items {
        let b_qty = b_item.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);
        if let Some(existing) = merged.get_mut(item_id) {
            let old_qty = existing.get("quantity").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(obj) = existing.as_object_mut() {
                obj.insert("quantity".to_string(), json!(old_qty + b_qty));
            }
        } else {
            merged.insert(item_id.clone(), b_item.clone());
        }
    }

    json!({
        "type": "item-quantity-compaction-aggregate",
        "txnEffectiveAtMillis": a.get("txnEffectiveAtMillis"),
        "txnId": a.get("txnId"),
        "index": a.get("index"),
        "items": merged,
    })
}
