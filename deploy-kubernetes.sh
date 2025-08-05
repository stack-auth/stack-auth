#!/bin/bash
set -ae

# shellcheck source=/dev/null
source /root/shared.sh

# Verify required environment variables
: "${MODULE:?MODULE is required}"
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${PROJECT:?PROJECT is required}"
: "${ENVIRONMENT:?ENVIRONMENT is required}"

# If COMMIT_ID is not provided, try to get it from git
if [ -z "${COMMIT_ID:-}" ]; then
	if [ -d "applications/${MODULE}" ]; then
		FULL_COMMIT_ID=$(cd "applications/${MODULE}/" && git log --pretty=tformat:"%H" -n1 .)
		export COMMIT_ID="${FULL_COMMIT_ID:0:7}"
		echo "Using commit ID from git: ${COMMIT_ID}"
	else
		echo "Warning: COMMIT_ID not provided and could not be determined from git"
		echo "Deployment will proceed with provided COMMIT_ID: ${COMMIT_ID:-not provided}"
	fi
fi

#DEPLOY_DIR="deployment/kubernetes/helm-values/${ENVIRONMENT}/${MODULE}" #need hardcoded
DEPLOY_DIR="deployment/kubernetes/helm-values/${ENVIRONMENT}/infra-add-ons"
# shellcheck disable=SC2034
BASE_MODULE=${MODULE}

cd "${DEPLOY_DIR}"
VALUES_FILES=$(find . -type f -iname "values.yaml" | sort)


run_deploy() {
	local log_file=$1
	local values_file=$2
	
	{		
		SUBMODULE="$(basename "$(dirname "${values_file}")")"
		if [[ "${SUBMODULE}" != "." ]]; then
			cd "${SUBMODULE}"

			# Context: https://github.com/GDP-ADMIN/gen-ai-template/pull/434#discussion_r1843275260
			find ../ -maxdepth 1 -type f -exec cp {} . \;

			MODULE="${BASE_MODULE}-${SUBMODULE}"
			sed -i "s|\${SUBMODULE}|${SUBMODULE}|g" ./*.yaml
		fi

		echo "=== Starting deployment for: ${MODULE} ==="
		echo "Timestamp: $(date)"

		# shellcheck source=/dev/null
		source chart.env
		download_and_prepare_helm_chart
		prepare_helm_values
		collect_helm_values
		deploy_helm_release
		show_post_deployment_info
		
		echo "=== Deployment completed for: ${MODULE} ==="

		MODULE=${BASE_MODULE}
		cd ../
	} >"$log_file" 2>&1
}

# Function to show logs on exit (even if script fails)
show_logs_on_exit() {
	for i in "${!PIDS[@]}"; do
		if [ -f "${LOG_FILES[$i]}" ]; then
			echo
			echo "========== Logs for deploy: ${VALUES_FILES_ARRAY[$i]} =========="
			echo "=================================================="
			cat "${LOG_FILES[$i]}"
			echo "=================================================="
			rm -f "${LOG_FILES[$i]}"
		fi
	done
}

# Trap to show logs on any exit (success or failure)
trap show_logs_on_exit EXIT

# Run all in background and collect PIDs
PIDS=()
LOG_FILES=()
VALUES_FILES_ARRAY=()

echo "Starting deployment in parallel..."
echo "=================================================="

for values_file in ${VALUES_FILES}; do
	# Create log file with timestamp and index for better portability
	# Use /tmp if available, otherwise use current directory
	if [ -w "/tmp" ]; then
		log_file="/tmp/deploy_$(date +%s)_$$_$(( ${#PIDS[@]} )).log"
	else
		log_file="./deploy_$(date +%s)_$$_$(( ${#PIDS[@]} )).log"
	fi
	run_deploy "$log_file" "$values_file" &
	pid=$!
	PIDS+=($pid)
	LOG_FILES+=("$log_file")
	VALUES_FILES_ARRAY+=("$values_file")
	
	echo "[$(( ${#PIDS[@]} ))] Started deployment for: ${values_file} (PID: $pid)"
done

echo "=================================================="
echo "Waiting for all deployments to complete..."

# Wait for all and show logs in order
for i in "${!PIDS[@]}"; do
	pid=${PIDS[$i]}
	wait "$pid"
	echo
	echo "========== Logs for deploy: ${VALUES_FILES_ARRAY[$i]} =========="
	echo "=================================================="
	cat "${LOG_FILES[$i]}"
	echo "=================================================="
	rm -f "${LOG_FILES[$i]}"
done
