//! Performance test matching bulldozer-js payments schema tests.

use serde_json::{json, Value};
use std::time::Instant;

use crate::payments_schema::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Test Constants (matching JS test)
// ═══════════════════════════════════════════════════════════════════════════════

const USER_COUNT: usize = 6;
const ITEM_UPDATES_PER_USER: usize = 10;
const PREFILL_USER_COUNT: usize = 200;
const PREFILL_ITEM_UPDATES_PER_USER: usize = 4;
const MONTH_MS: i64 = 2_592_000_000;

// ═══════════════════════════════════════════════════════════════════════════════
// Test Data Generation
// ═══════════════════════════════════════════════════════════════════════════════

fn product(items: &[(&str, i64, &str)]) -> Value {
    let mut included = serde_json::Map::new();
    for (name, qty, expires) in items {
        let mut item = serde_json::Map::new();
        item.insert("quantity".to_string(), json!(qty));
        if *expires != "never" {
            item.insert("expires".to_string(), json!(expires));
        }
        included.insert(name.to_string(), Value::Object(item));
    }
    json!({
        "customerType": "user",
        "prices": {
            "price-1": {
                "usd": "1000",
                "interval": "month"
            }
        },
        "includedItems": included,
        "productLineId": "test-product-line"
    })
}

fn create_subscription(user_idx: usize, base_time: i64) -> (String, Value) {
    let id = format!("sub-{}", user_idx);
    let customer_id = format!("user-{}", user_idx);
    let data = json!({
        "id": id,
        "tenancyId": "tenancy-1",
        "customerId": customer_id,
        "customerType": "user",
        "productId": "prod-1",
        "priceId": "price-1",
        "product": product(&[
            ("credits", 100, "never"),
            ("seats", 1, "when-purchase-expires"),
        ]),
        "quantity": 1,
        "stripeSubscriptionId": format!("stripe-sub-{}", user_idx),
        "status": "active",
        "currentPeriodStartMillis": base_time,
        "currentPeriodEndMillis": base_time + MONTH_MS,
        "cancelAtPeriodEnd": false,
        "canceledAtMillis": null,
        "endedAtMillis": null,
        "refundedAtMillis": null,
        "productRevokedAtMillis": null,
        "creationSource": "TEST_MODE",
        "createdAtMillis": base_time,
    });
    (id, data)
}

fn create_one_time_purchase(user_idx: usize, base_time: i64) -> (String, Value) {
    let id = format!("otp-{}", user_idx);
    let customer_id = format!("user-{}", user_idx);
    let data = json!({
        "id": id,
        "tenancyId": "tenancy-1",
        "customerId": customer_id,
        "customerType": "user",
        "productId": "prod-2",
        "priceId": "price-1",
        "product": product(&[
            ("coins", 50, "never"),
        ]),
        "quantity": 1,
        "stripePaymentIntentId": format!("stripe-pi-{}", user_idx),
        "revokedAtMillis": null,
        "refundedAtMillis": null,
        "creationSource": "TEST_MODE",
        "createdAtMillis": base_time + 1000,
    });
    (id, data)
}

fn create_manual_item_qty_change(user_idx: usize, item_idx: usize, base_time: i64) -> (String, Value) {
    let id = format!("miqc-{}-{}", user_idx, item_idx);
    let customer_id = format!("user-{}", user_idx);
    let data = json!({
        "id": id,
        "tenancyId": "tenancy-1",
        "customerId": customer_id,
        "customerType": "user",
        "itemId": format!("item-{}", item_idx % 3),
        "quantity": 10,
        "description": "Manual adjustment",
        "expiresAtMillis": null,
        "createdAtMillis": base_time + 2000 + (item_idx as i64 * 100),
    });
    (id, data)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Performance Metrics
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Debug)]
pub struct PerfMetric {
    pub name: String,
    pub count: usize,
    pub elapsed_ms: f64,
    pub ops_per_second: f64,
}

pub fn run_performance_test() -> Vec<PerfMetric> {
    let mut metrics: Vec<PerfMetric> = Vec::new();
    let base_time = 1_700_000_000_000i64;

    // ─── Initialize Schema ─────────────────────────────────────────────────────
    let start = Instant::now();
    let mut db = create_payments_database();
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "initialize schema".to_string(),
        count: 1,
        elapsed_ms: elapsed,
        ops_per_second: 1000.0 / elapsed,
    });

    // ─── Prefill Baseline Rows ─────────────────────────────────────────────────
    let count = PREFILL_USER_COUNT * (1 + 1 + PREFILL_ITEM_UPDATES_PER_USER);
    let start = Instant::now();
    for i in 0..PREFILL_USER_COUNT {
        let user_idx = USER_COUNT + i; // offset to not conflict with test users
        let (id, data) = create_subscription(user_idx, base_time - MONTH_MS);
        db.set_or_delete_row(SUBSCRIPTIONS, &id, Some(data));
        let (id, data) = create_one_time_purchase(user_idx, base_time - MONTH_MS);
        db.set_or_delete_row(ONE_TIME_PURCHASES, &id, Some(data));
        for j in 0..PREFILL_ITEM_UPDATES_PER_USER {
            let (id, data) = create_manual_item_qty_change(user_idx, j, base_time - MONTH_MS);
            db.set_or_delete_row(MANUAL_ITEM_QTY_CHANGES, &id, Some(data));
        }
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "prefill baseline rows".to_string(),
        count,
        elapsed_ms: elapsed,
        ops_per_second: (count as f64) / (elapsed / 1000.0),
    });

    // ─── Write Subscriptions ───────────────────────────────────────────────────
    let start = Instant::now();
    for i in 0..USER_COUNT {
        let (id, data) = create_subscription(i, base_time);
        db.set_or_delete_row(SUBSCRIPTIONS, &id, Some(data));
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "write subscriptions".to_string(),
        count: USER_COUNT,
        elapsed_ms: elapsed,
        ops_per_second: (USER_COUNT as f64) / (elapsed / 1000.0),
    });

    // ─── Write One-Time Purchases ──────────────────────────────────────────────
    let start = Instant::now();
    for i in 0..USER_COUNT {
        let (id, data) = create_one_time_purchase(i, base_time);
        db.set_or_delete_row(ONE_TIME_PURCHASES, &id, Some(data));
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "write one-time purchases".to_string(),
        count: USER_COUNT,
        elapsed_ms: elapsed,
        ops_per_second: (USER_COUNT as f64) / (elapsed / 1000.0),
    });

    // ─── Write Manual Item Quantity Changes ────────────────────────────────────
    let total_changes = USER_COUNT * ITEM_UPDATES_PER_USER;
    let start = Instant::now();
    for i in 0..USER_COUNT {
        for j in 0..ITEM_UPDATES_PER_USER {
            let (id, data) = create_manual_item_qty_change(i, j, base_time);
            db.set_or_delete_row(MANUAL_ITEM_QTY_CHANGES, &id, Some(data));
        }
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "write manual item qty changes".to_string(),
        count: total_changes,
        elapsed_ms: elapsed,
        ops_per_second: (total_changes as f64) / (elapsed / 1000.0),
    });

    // ─── Read Owned Products ───────────────────────────────────────────────────
    let start = Instant::now();
    for i in 0..USER_COUNT {
        let customer_id = format!("user-{}", i);
        let group_key = json!({"tenancyId": "tenancy-1", "customerType": "user", "customerId": customer_id});
        let _rows = db.list_rows_in_group(OWNED_PRODUCTS, &group_key);
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "read owned products".to_string(),
        count: USER_COUNT,
        elapsed_ms: elapsed,
        ops_per_second: (USER_COUNT as f64) / (elapsed / 1000.0),
    });

    // ─── Read Item Quantities ──────────────────────────────────────────────────
    let items_per_user = 3; // item-0, item-1, item-2
    let total_reads = USER_COUNT * items_per_user;
    let start = Instant::now();
    for i in 0..USER_COUNT {
        let customer_id = format!("user-{}", i);
        let group_key = json!({"tenancyId": "tenancy-1", "customerType": "user", "customerId": customer_id});
        let _rows = db.list_rows_in_group(ITEM_QUANTITIES, &group_key);
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "read item quantities".to_string(),
        count: total_reads,
        elapsed_ms: elapsed,
        ops_per_second: (total_reads as f64) / (elapsed / 1000.0),
    });

    // ─── Read Transactions ─────────────────────────────────────────────────────
    let start = Instant::now();
    let mut total_txn_count = 0usize;
    for i in 0..USER_COUNT {
        let customer_id = format!("user-{}", i);
        let group_key = json!({"tenancyId": "tenancy-1", "customerType": "user", "customerId": customer_id});
        let rows = db.list_rows_in_group(TRANSACTIONS_BY_CUSTOMER, &group_key);
        total_txn_count += rows.len();
    }
    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    metrics.push(PerfMetric {
        name: "read transactions".to_string(),
        count: USER_COUNT,
        elapsed_ms: elapsed,
        ops_per_second: (USER_COUNT as f64) / (elapsed / 1000.0),
    });

    // ─── Verification ──────────────────────────────────────────────────────────
    let expected_txns = USER_COUNT * (2 + ITEM_UPDATES_PER_USER); // sub + otp + miqcs
    println!("\n═══ bulldozer-rs Performance Results (in-memory) ═══\n");
    println!("Backend: in-memory (generic engine)");
    println!("Transaction count: {} (expected: {})", total_txn_count, expected_txns);
    if total_txn_count != expected_txns {
        println!("⚠ WARNING: Transaction count mismatch!");
    } else {
        println!("✓ Transaction count correct");
    }
    println!("\n{:<40} {:>8} {:>12} {:>14}", "Operation", "Count", "Elapsed(ms)", "Ops/sec");
    println!("{}", "-".repeat(78));
    for m in &metrics {
        println!("{:<40} {:>8} {:>12.3} {:>14.1}", m.name, m.count, m.elapsed_ms, m.ops_per_second);
    }
    println!();

    // Output JSON for comparison
    let json_results: Vec<Value> = metrics.iter().map(|m| json!({
        "name": m.name,
        "count": m.count,
        "elapsedMs": m.elapsed_ms,
        "opsPerSecond": m.ops_per_second,
    })).collect();
    println!("JSON: {}", serde_json::to_string_pretty(&json_results).unwrap());

    metrics
}
