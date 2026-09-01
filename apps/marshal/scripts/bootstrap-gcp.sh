#!/usr/bin/env bash
# Marshal (Hexclave Deployments) — one-time GCP org bootstrap.
# Paste into Cloud Shell. Idempotent: safe to re-run.
#
# Requires, on the identity running it:
#   roles/resourcemanager.folderCreator + projectCreator on the org
#   roles/orgpolicy.policyAdmin        on the org  (for the org-policy section)
#   roles/billing.admin                on the billing account
set -euo pipefail

############################  FILL THESE IN  ############################
ORG_ID="000000000000"                       # gcloud organizations list
BILLING_ACCOUNT="000000-000000-000000"      # gcloud billing accounts list
PLATFORM_PROJECT="hexclave-marshal-prd"     # NEW project; holds the shared LB + Certificate Manager
TENANT_FOLDER_NAME="hexclave-tenants-prd"   # folder that will hold every tenant project
SA_NAME="marshal-controller"

# Workload Identity Federation (recommended auth from Vercel). Set USE_WIF=0 to skip.
USE_WIF=1
VERCEL_TEAM_SLUG="my-team"                  # Vercel team slug
VERCEL_PROJECT_NAME="hexclave-marshal"      # Vercel project name
VERCEL_ENVIRONMENT="production"
VERCEL_ISSUER="https://oidc.vercel.com/${VERCEL_TEAM_SLUG}"
VERCEL_AUDIENCE="https://vercel.com/${VERCEL_TEAM_SLUG}"
#########################################################################

SA_EMAIL="${SA_NAME}@${PLATFORM_PROJECT}.iam.gserviceaccount.com"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1/8  Tenant folder"
FOLDER_ID="$(gcloud resource-manager folders list --organization="$ORG_ID" \
  --filter="displayName=$TENANT_FOLDER_NAME" --format='value(name)' | sed 's|folders/||' | head -n1)"
if [[ -z "$FOLDER_ID" ]]; then
  gcloud resource-manager folders create --display-name="$TENANT_FOLDER_NAME" --organization="$ORG_ID"
  FOLDER_ID="$(gcloud resource-manager folders list --organization="$ORG_ID" \
    --filter="displayName=$TENANT_FOLDER_NAME" --format='value(name)' | sed 's|folders/||' | head -n1)"
fi
echo "tenant folder: folders/${FOLDER_ID}"

say "2/8  Platform project (deliberately OUTSIDE the tenant folder)"
gcloud projects describe "$PLATFORM_PROJECT" >/dev/null 2>&1 \
  || gcloud projects create "$PLATFORM_PROJECT" --organization="$ORG_ID"
gcloud billing projects link "$PLATFORM_PROJECT" --billing-account="$BILLING_ACCOUNT"
PLATFORM_NUMBER="$(gcloud projects describe "$PLATFORM_PROJECT" --format='value(projectNumber)')"

say "3/8  APIs in the platform project"
# compute + certificatemanager are what Marshal's shared frontend needs and does NOT enable itself.
# The rest are the control-plane APIs the controller calls out through.
gcloud services enable \
  compute.googleapis.com \
  certificatemanager.googleapis.com \
  cloudresourcemanager.googleapis.com \
  cloudbilling.googleapis.com \
  serviceusage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  logging.googleapis.com \
  --project="$PLATFORM_PROJECT"

say "4/8  Controller service account"
gcloud iam service-accounts describe "$SA_EMAIL" --project="$PLATFORM_PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project="$PLATFORM_PROJECT" \
       --display-name="Marshal deployments controller"

say "5/8  Folder-level roles (tenant projects)"
for ROLE in \
  roles/resourcemanager.projectCreator \
  roles/resourcemanager.projectDeleter \
  roles/browser \
  roles/billing.projectManager \
  roles/serviceusage.serviceUsageAdmin \
  roles/resourcemanager.projectIamAdmin \
  roles/compute.admin \
  roles/run.admin \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/logging.viewer \
  roles/compute.loadBalancerServiceUser
do
  gcloud resource-manager folders add-iam-policy-binding "$FOLDER_ID" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" --condition=None >/dev/null
  echo "  folder += $ROLE"
done

say "6/8  Billing account + platform project roles"
gcloud billing accounts add-iam-policy-binding "$BILLING_ACCOUNT" \
  --member="serviceAccount:${SA_EMAIL}" --role=roles/billing.user >/dev/null
echo "  billing += roles/billing.user"
# certificatemanager.owner, not .editor: the editor role omits deletion, so it cannot clean up
# certificates, map entries, or maps.
for ROLE in roles/compute.loadBalancerAdmin roles/certificatemanager.owner; do
  gcloud projects add-iam-policy-binding "$PLATFORM_PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" --condition=None >/dev/null
  echo "  platform += $ROLE"
done

say "7/8  Org policies on the tenant folder"
POLICY_DIR="$(mktemp -d)"
# Builder VMs and server VMs both request an ephemeral external IP for egress (there is no
# Cloud NAT in this code path), so external IPs must be permitted in the tenant folder.
cat > "${POLICY_DIR}/vm-external-ip.yaml" <<EOF
name: folders/${FOLDER_ID}/policies/compute.vmExternalIpAccess
spec:
  inheritFromParent: false
  rules:
  - allowAll: true
EOF
# Marshal reads serial port 1 both to detect container readiness and to parse MARSHAL_IMAGE_REF
# off the builder. With serial access disabled, every build and every server deploy times out.
cat > "${POLICY_DIR}/serial-port.yaml" <<EOF
name: folders/${FOLDER_ID}/policies/compute.disableSerialPortAccess
spec:
  inheritFromParent: false
  rules:
  - enforce: false
EOF
for FILE in "${POLICY_DIR}"/*.yaml; do
  gcloud org-policies set-policy "$FILE" >/dev/null
  echo "  applied $(basename "$FILE")"
done

# Cross-project backend references: the platform URL map points at tenant backend services.
# Verify the accepted value format for your org before relying on this one.
cat > "${POLICY_DIR}/cross-project.yaml" <<EOF
name: folders/${FOLDER_ID}/policies/compute.restrictCrossProjectServices
spec:
  inheritFromParent: false
  rules:
  - values:
      allowedValues:
      - projects/${PLATFORM_PROJECT}
EOF
gcloud org-policies set-policy "${POLICY_DIR}/cross-project.yaml" >/dev/null \
  && echo "  applied cross-project.yaml" \
  || echo "  SKIPPED cross-project.yaml (constraint absent or value format differs — check manually)"

say "8/8  Workload Identity Federation for Vercel"
if [[ "$USE_WIF" == "1" ]]; then
  gcloud iam workload-identity-pools describe vercel --location=global --project="$PLATFORM_PROJECT" >/dev/null 2>&1 \
    || gcloud iam workload-identity-pools create vercel --location=global --project="$PLATFORM_PROJECT" \
         --display-name="Vercel OIDC"
  gcloud iam workload-identity-pools providers describe vercel \
      --workload-identity-pool=vercel --location=global --project="$PLATFORM_PROJECT" >/dev/null 2>&1 \
    || gcloud iam workload-identity-pools providers create-oidc vercel \
         --workload-identity-pool=vercel --location=global --project="$PLATFORM_PROJECT" \
         --issuer-uri="$VERCEL_ISSUER" \
         --allowed-audiences="$VERCEL_AUDIENCE" \
         --attribute-mapping="google.subject=assertion.sub"
  PRINCIPAL="principal://iam.googleapis.com/projects/${PLATFORM_NUMBER}/locations/global/workloadIdentityPools/vercel/subject/owner:${VERCEL_TEAM_SLUG}:project:${VERCEL_PROJECT_NAME}:environment:${VERCEL_ENVIRONMENT}"
  gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project="$PLATFORM_PROJECT" \
    --member="$PRINCIPAL" --role=roles/iam.workloadIdentityUser >/dev/null
  echo "  bound $PRINCIPAL"
  WIF_ENV="  HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_AUDIENCE=//iam.googleapis.com/projects/${PLATFORM_NUMBER}/locations/global/workloadIdentityPools/vercel/providers/vercel
  HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT=${SA_EMAIL}
"
else
  echo "  skipped (USE_WIF=0) — Marshal will need GOOGLE_APPLICATION_CREDENTIALS or a metadata server"
  WIF_ENV=""
fi

cat <<EOF

============================================================
Done. Marshal env vars:

  HEXCLAVE_MARSHAL_GCP_PROJECT_PARENT=folders/${FOLDER_ID}
  HEXCLAVE_MARSHAL_GCP_PLATFORM_PROJECT_ID=${PLATFORM_PROJECT}
  HEXCLAVE_MARSHAL_GCP_BILLING_ACCOUNT=${BILLING_ACCOUNT}
${WIF_ENV}
Controller identity: ${SA_EMAIL}

Still manual:
  1. Raise the org's PROJECT CREATION quota. The pool creates continuously and deleted
     projects hold quota for 30 days: IAM & Admin > Quotas, "Projects per organization".
  2. Confirm the org/folder Logging default sink still writes Cloud Run + Compute entries to
     each project's _Default bucket, or the logs API returns nothing.
  3. Raise per-region Compute CPUs / in-use external IPs if you expect more than a few tenants.
============================================================
EOF
