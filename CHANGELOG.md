# Stack Auth Changelog

---

## 4/14/26

### Developer Tools
Introduced a new Developer Tools panel that appears automatically on localhost to help debug and test your Stack Auth integration.

- **Overview**: View current user identity, project info, SDK version, and quickly sign in/out with test users
- **Components**: Track component versions and get update notifications
- **AI Chat**: Get AI-powered assistance for debugging your integration
- **Console**: Monitor API requests and events in real-time
- **Docs**: Quick access to Stack Auth documentation
- **Dashboard**: Direct link to your project dashboard
- **Support**: Submit bug reports and feature requests

Use console commands to control visibility: `StackDevTool.enable()`, `StackDevTool.disable()`, `StackDevTool.reset()`

---

## 1/23/26

### Payments
Introduced a redesigned payments onboarding flow
![Payments Onboarding](https://raw.githubusercontent.com/stack-auth/stack-auth/dev/apps/dashboard/public/changelog/payments-onboarding.png)

## 1/21/26

### Payments
- Payments page updated with new UI changes
![Create Product](https://raw.githubusercontent.com/stack-auth/stack-auth/refs/heads/dev/apps/dashboard/public/changelog/payments-create-product.png)
- Added a new Payments Settings page with an option to temporarily disable all payments
![Payments Setting](https://raw.githubusercontent.com/stack-auth/stack-auth/refs/heads/dev/apps/dashboard/public/changelog/payments-settings-1.png)
- Subscription renewal emails are now sent automatically to users
- Past payment invoices are now visible on the Account Settings page
![Past Payments Invoices](https://raw.githubusercontent.com/stack-auth/stack-auth/refs/heads/dev/apps/dashboard/public/changelog/account-settings-invoices.png)

### Documentation
- Updated JWT documentation to include `isRestricted` and `restrictedReason`

## 1/19/26
- Updated package dependencies to their newest versions.

## 12/19/25
- Introduces new changelog and deprecates all older changelogs. 
- Date versioning for public view.

---

> **Note:** All older changelogs are deprecated and have been removed. The source of true is this single changelog file.
> 
> Going forward, all changes should be documented in this file only.

---
