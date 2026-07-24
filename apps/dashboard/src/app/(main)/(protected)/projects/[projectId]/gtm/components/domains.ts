import type { GtmDomainId } from "@/lib/gtm/gtm-types";
import {
  ArticleIcon,
  CalendarDotsIcon,
  CubeIcon,
  CurrencyDollarIcon,
  MegaphoneIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";

export const GTM_DOMAIN_PRESENTATIONS: {
  id: GtmDomainId,
  label: string,
  scope: string,
  icon: Icon,
}[] = [
  { id: "product", label: "Product", scope: "Activation · friction · direction", icon: CubeIcon },
  { id: "users", label: "Users", scope: "Segments · behavior · lifecycle", icon: UsersThreeIcon },
  { id: "ads", label: "Ads", scope: "Campaigns · creative · reach", icon: MegaphoneIcon },
  { id: "outreach", label: "Outreach", scope: "Community · events · email", icon: CalendarDotsIcon },
  { id: "content", label: "Content", scope: "SEO · docs · editorial", icon: ArticleIcon },
  { id: "revenue", label: "Revenue", scope: "Conversion · pricing · retention", icon: CurrencyDollarIcon },
];
