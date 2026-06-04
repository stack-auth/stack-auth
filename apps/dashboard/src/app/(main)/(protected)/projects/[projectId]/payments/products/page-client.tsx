"use client";

import { PageLayout } from "../../page-layout";
import PageClientListView from "./page-client-list-view";

/**
 * @dashboardReference payments/products-and-items
 * @dashboardReferenceDescription Manage products, prices (items), and checkout URLs.
 *
 * ## Layout
 *
 * Two-column list: **Products** (left) and **Items / prices** (right). Selecting a product filters its items.
 *
 * ## Product actions
 *
 * - **Create product** — dialog (display name, customer type user/team, product line)
 * - Row menu: **Edit**, **Copy checkout URL**, **Delete**
 * - Row click opens product detail (`payments/products/[productId]`)
 *
 * ## Item actions
 *
 * - **Create item** — price, billing interval, entitlements
 * - **Edit** / **Delete** per item; checkout URL validation surfaces config errors inline
 *
 * Revenue sparklines may appear on product rows when analytics data exists.
 */

export default function PageClient() {
  return (
    <PageLayout title='Products & Items'>
      <div data-walkthrough="payments-products">
        <PageClientListView />
      </div>
    </PageLayout>
  );
}
