use serde_json::{json, Value};
use std::fs;
use std::time::Instant;

use crate::payments_schema::*;

const USER_COUNT: usize = 6;
const ITEM_UPDATES_PER_USER: usize = 10;
const PREFILL_USER_COUNT: usize = 200;
const PREFILL_ITEM_UPDATES_PER_USER: usize = 4;
const MONTH_MS: i64 = 2_592_000_000;

#[derive(Clone)]
struct Metric {
    name: String,
    count: usize,
    elapsed_ms: f64,
    ops_per_second: f64,
}

fn measure<T, F: FnOnce() -> T>(metrics: &mut Vec<Metric>, name: &str, count: usize, operation: F) -> T {
    let start = Instant::now();
    let value = operation();
    let elapsed = start.elapsed();
    let elapsed_ms = elapsed.as_secs_f64() * 1000.0;
    let ops_per_second = count as f64 / elapsed_ms * 1000.0;
    metrics.push(Metric {
        name: name.to_string(),
        count,
        elapsed_ms,
        ops_per_second,
    });
    eprintln!("[bulldozer-payments-schema-perf-rs] {}: {:.1} ms ({} ops, {:.2} ops/s)", name, elapsed_ms, count, ops_per_second);
    value
}

fn product(included_items: Value) -> ProductSnapshot {
    serde_json::from_value(json!({
        "displayName": "Perf Product",
        "customerType": "user",
        "productLineId": "line-perf",
        "prices": { "p1": { "USD": "10.00" } },
        "includedItems": included_items,
    })).unwrap()
}

fn customer_id(namespace: &str, index: usize) -> String {
    format!("{}user-{}", namespace, index)
}

fn subscription(index: usize, namespace: &str) -> SubscriptionRow {
    SubscriptionRow {
        id: format!("{}sub-{}", namespace, index),
        tenancy_id: "t1".to_string(),
        customer_id: customer_id(namespace, index),
        customer_type: "user".to_string(),
        product_id: Some("prod-sub".to_string()),
        price_id: Some("p1".to_string()),
        product: product(json!({
            "credits": { "quantity": 100, "expires": "never" },
            "seats": { "quantity": 1, "expires": "when-purchase-expires" },
        })),
        quantity: 1,
        stripe_subscription_id: None,
        status: "active".to_string(),
        current_period_start_millis: 0,
        current_period_end_millis: MONTH_MS,
        cancel_at_period_end: false,
        canceled_at_millis: None,
        ended_at_millis: None,
        refunded_at_millis: None,
        product_revoked_at_millis: None,
        creation_source: "TEST_MODE".to_string(),
        created_at_millis: 1_000 + index as i64,
    }
}

fn one_time_purchase(index: usize, namespace: &str) -> OneTimePurchaseRow {
    OneTimePurchaseRow {
        id: format!("{}otp-{}", namespace, index),
        tenancy_id: "t1".to_string(),
        customer_id: customer_id(namespace, index),
        customer_type: "user".to_string(),
        product_id: Some("prod-otp".to_string()),
        price_id: Some("p1".to_string()),
        product: product(json!({
            "coins": { "quantity": 50, "expires": "never" },
        })),
        quantity: 2,
        stripe_payment_intent_id: None,
        revoked_at_millis: None,
        refunded_at_millis: None,
        creation_source: "TEST_MODE".to_string(),
        created_at_millis: 2_000 + index as i64,
    }
}

fn manual_item_quantity_change(user_index: usize, update_index: usize, namespace: &str) -> ManualItemQuantityChangeRow {
    ManualItemQuantityChangeRow {
        id: format!("{}miqc-{}-{}", namespace, user_index, update_index),
        tenancy_id: "t1".to_string(),
        customer_id: customer_id(namespace, user_index),
        customer_type: "user".to_string(),
        item_id: if update_index % 2 == 0 { "credits".to_string() } else { "coins".to_string() },
        quantity: if update_index % 3 == 0 { -1 } else { 3 },
        description: None,
        expires_at_millis: None,
        created_at_millis: 10_000 + user_index as i64 * 1_000 + update_index as i64,
    }
}

fn group_key_value(index: usize) -> Value {
    json!({
        "tenancyId": "t1",
        "customerType": "user",
        "customerId": customer_id("", index),
    })
}

pub fn run_performance_test() {
    let mut metrics: Vec<Metric> = Vec::new();
    let prefill_source_fact_count = PREFILL_USER_COUNT * (2 + PREFILL_ITEM_UPDATES_PER_USER);

    eprintln!("\n[bulldozer-payments-schema-perf-rs] Running payments schema performance test...\n");

    let mut db = measure(&mut metrics, "initialize schema", 1, || {
        PaymentsDatabase::new()
    });

    measure(&mut metrics, "prefill baseline rows", prefill_source_fact_count, || {
        for i in 0..PREFILL_USER_COUNT {
            let sub = subscription(i, "prefill-");
            db.set_subscription(&format!("prefill-sub-{}", i), sub);
            let otp = one_time_purchase(i, "prefill-");
            db.set_one_time_purchase(&format!("prefill-otp-{}", i), otp);
            for update_index in 0..PREFILL_ITEM_UPDATES_PER_USER {
                let miqc = manual_item_quantity_change(i, update_index, "prefill-");
                db.set_manual_item_quantity_change(&format!("prefill-miqc-{}-{}", i, update_index), miqc);
            }
        }
    });

    measure(&mut metrics, "write subscriptions", USER_COUNT, || {
        for i in 0..USER_COUNT {
            let sub = subscription(i, "");
            db.set_subscription(&format!("sub-{}", i), sub);
        }
    });

    measure(&mut metrics, "write one-time purchases", USER_COUNT, || {
        for i in 0..USER_COUNT {
            let otp = one_time_purchase(i, "");
            db.set_one_time_purchase(&format!("otp-{}", i), otp);
        }
    });

    measure(&mut metrics, "write manual item quantity changes", USER_COUNT * ITEM_UPDATES_PER_USER, || {
        for user_index in 0..USER_COUNT {
            for update_index in 0..ITEM_UPDATES_PER_USER {
                let miqc = manual_item_quantity_change(user_index, update_index, "");
                db.set_manual_item_quantity_change(&format!("miqc-{}-{}", user_index, update_index), miqc);
            }
        }
    });

    measure(&mut metrics, "read owned products", USER_COUNT, || {
        for i in 0..USER_COUNT {
            let gk = group_key_value(i);
            let _rows = db.read_owned_products(&gk);
        }
    });

    measure(&mut metrics, "read item quantities", USER_COUNT * 3, || {
        for i in 0..USER_COUNT {
            for _item_id in &["credits", "coins", "seats"] {
                let gk = group_key_value(i);
                let _rows = db.read_item_quantities(&gk);
            }
        }
    });

    let transaction_rows = measure(&mut metrics, "read transactions", USER_COUNT, || {
        let mut count = 0;
        for i in 0..USER_COUNT {
            let gk = group_key_value(i);
            count += db.read_transactions(&gk).len();
        }
        count
    });

    let expected_transactions = USER_COUNT * (2 + ITEM_UPDATES_PER_USER);
    assert_eq!(
        transaction_rows, expected_transactions,
        "Expected {} transaction rows, got {}",
        expected_transactions, transaction_rows
    );

    let summary = json!({
        "engine": "bulldozer-rs",
        "backend": "in-memory",
        "users": USER_COUNT,
        "prefillUsers": PREFILL_USER_COUNT,
        "prefillSourceFacts": prefill_source_fact_count,
        "transactions": transaction_rows,
        "metrics": metrics.iter().map(|m| json!({
            "name": m.name,
            "count": m.count,
            "elapsedMs": m.elapsed_ms,
            "opsPerSecond": m.ops_per_second,
        })).collect::<Vec<_>>(),
    });

    fs::write("bulldozer-payments-schema-perf-rs.untracked.json", serde_json::to_string_pretty(&summary).unwrap())
        .expect("Failed to write performance results");

    eprintln!("\n[bulldozer-payments-schema-perf-rs] summary={}\n", serde_json::to_string(&summary).unwrap());
}
