import { PageLayout } from "../../page-layout";
import ProductDetailsClient from "./page-client";

export default function ProductDetailsPage() {
  return (
    <PageLayout
      title="Product Details"
      description="View and manage product pricing details"
    >
      <ProductDetailsClient />
    </PageLayout>
  );
}
