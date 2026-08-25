#!/usr/bin/env bash
# image-shipper.sh — build/select, save, SCP, load, run, and verify an OCI image.
# Requires Bash 3.2+, OpenSSH, gzip, curl (for HTTP verification), and Docker
# or Podman locally and remotely. SSH authentication is handled by ssh/scp.

set -Eeuo pipefail

SCRIPT_VERSION="1.0.0"

if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi

usage() {
  cat <<'EOF'
Image Shipper — build or select an OCI image and deploy it over SSH

Usage:
  scripts/image-shipper.sh [options]

Selection/build:
  --image IMAGE             Existing local image reference to ship
  --build-context PATH      Build locally from this context before shipping
  --dockerfile PATH         Dockerfile/Containerfile path for the local build
  --tag IMAGE               Tag assigned to the locally built image
  --engine docker|podman    Local engine (auto-detected or prompted otherwise)

Destination:
  --host HOST               Destination FQDN, hostname, or IP
  --user USER               Destination SSH user
  --port PORT               SSH port (default: 22)
  --destination PATH        Absolute remote folder receiving the image archive
  --remote-engine ENGINE    Remote docker or podman command (auto-detected)

Run/verify:
  --container NAME          Remote container name
  --run-option VALUE        One docker/podman run argument; repeat as needed
  --health-url URL          URL checked with curl after startup; '-' skips HTTP
  --no-start                Load the image without starting a container
  --yes                     Replace an existing named container without prompting

Information:
  --changelog               Print this script's changelog
  -h, --help                Show this help

Examples:
  scripts/image-shipper.sh --build-context . --tag mygarage:3.1.4

  scripts/image-shipper.sh --image myapp:latest --host server.example.test \
    --user deploy --destination /srv/images --container myapp \
    --run-option=--restart --run-option=unless-stopped \
    --run-option=-p --run-option=8080:8000 \
    --health-url http://server.example.test:8080/health

Passwords and key passphrases are intentionally never accepted as arguments,
stored, or echoed. OpenSSH prompts for credentials directly on every execution.
The first SSH connection is reused for SCP and subsequent commands during that
single run, so credentials normally need to be entered only once.
EOF
}

changelog() {
  cat <<'EOF'
Image Shipper changelog

1.0.0 — 2026-08-24
  • Added interactive Docker/Podman engine and image selection using both
    running containers and the local image catalog.
  • Added optional local Dockerfile/Containerfile builds for hosts where the
    source repository should not be copied to the destination.
  • Added compressed image save, SCP transfer, remote image load, optional
    container replacement/start, remote image-identity verification, recent
    container logs, and retrying curl health verification.
  • Added argument-driven unattended setup while retaining direct OpenSSH
    credential prompts, colored progress output, aligned summaries, and safe
    temporary-file cleanup.
EOF
}

banner() {
  printf '%s%s╭──────────────────────────────────────────────────────────╮%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET"
  printf '%s%s│  IMAGE SHIPPER %-41s│%s\n' "$C_CYAN" "$C_BOLD" "v$SCRIPT_VERSION" "$C_RESET"
  printf '%s%s│  build · save · scp · load · run · verify              │%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET"
  printf '%s%s╰──────────────────────────────────────────────────────────╯%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET"
}

step() { printf '\n%s%s▶ %-58s%s\n' "$C_CYAN" "$C_BOLD" "$1" "$C_RESET"; }
ok() { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
die() { printf '  %s× %s%s\n' "$C_RED" "$1" "$C_RESET" >&2; exit 1; }
field() { printf '  %s%-18s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2"; }

prompt_required() {
  local label=$1 value=${2:-}
  while [[ -z "$value" ]]; do
    read -r -p "$(printf '%s?%s %s: ' "$C_CYAN" "$C_RESET" "$label")" value
  done
  printf '%s' "$value"
}

prompt_default() {
  local label=$1 default=$2 value
  read -r -p "$(printf '%s?%s %s [%s]: ' "$C_CYAN" "$C_RESET" "$label" "$default")" value
  printf '%s' "${value:-$default}"
}

confirm() {
  local question=$1 answer
  read -r -p "$(printf '%s?%s %s [y/N]: ' "$C_YELLOW" "$C_RESET" "$question")" answer
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

shell_quote() {
  local value=$1
  printf "'%s'" "${value//\'/\'\\\'\'}"
}

choose_local_engine() {
  local requested=$1 have_docker=0 have_podman=0 choice
  command -v docker >/dev/null 2>&1 && have_docker=1
  command -v podman >/dev/null 2>&1 && have_podman=1
  if [[ -n "$requested" ]]; then
    command -v "$requested" >/dev/null 2>&1 || die "$requested is not installed locally."
    printf '%s' "$requested"; return
  fi
  if (( have_docker && have_podman )); then
    printf '  1) docker\n  2) podman\n' >&2
    choice=$(prompt_default 'Local container engine' '1')
    [[ "$choice" == 2 ]] && printf 'podman' || printf 'docker'
  elif (( have_docker )); then printf 'docker'
  elif (( have_podman )); then printf 'podman'
  else die 'Neither docker nor podman is installed locally.'
  fi
}

select_existing_image() {
  local engine=$1 mode=$2 index choice
  local -a refs labels
  refs=(); labels=()
  if [[ "$mode" == running ]]; then
    while IFS=$'\t' read -r ref name status; do
      [[ -z "$ref" ]] && continue
      refs+=("$ref"); labels+=("$ref  ·  $name  ·  $status")
    done < <("$engine" ps --format '{{.Image}}\t{{.Names}}\t{{.Status}}')
  else
    while IFS=$'\t' read -r ref id size; do
      [[ -z "$ref" || "$ref" == '<none>:<none>' ]] && continue
      refs+=("$ref"); labels+=("$ref  ·  $id  ·  $size")
    done < <("$engine" images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}')
  fi
  ((${#refs[@]})) || die "No ${mode} images were found."
  printf '\n' >&2
  for ((index=0; index<${#refs[@]}; index++)); do
    printf '  %s%2d)%s %s\n' "$C_CYAN" "$((index + 1))" "$C_RESET" "${labels[$index]}" >&2
  done
  while :; do
    choice=$(prompt_required 'Select image number')
    [[ "$choice" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= ${#refs[@]})) && break
    warn "Choose a number from 1 to ${#refs[@]}." >&2
  done
  printf '%s' "${refs[$((choice - 1))]}"
}

local_engine=''; remote_engine=''; image=''; build_context=''; dockerfile=''; tag=''
ssh_host=''; ssh_user=''; ssh_port='22'; remote_destination=''; container_name=''
health_url=''; start_container=1; assume_yes=0
declare -a run_options
run_options=()

while (($#)); do
  case "$1" in
    --engine) local_engine=${2:?}; shift 2 ;;
    --engine=*) local_engine=${1#*=}; shift ;;
    --remote-engine) remote_engine=${2:?}; shift 2 ;;
    --remote-engine=*) remote_engine=${1#*=}; shift ;;
    --image) image=${2:?}; shift 2 ;;
    --image=*) image=${1#*=}; shift ;;
    --build-context) build_context=${2:?}; shift 2 ;;
    --build-context=*) build_context=${1#*=}; shift ;;
    --dockerfile) dockerfile=${2:?}; shift 2 ;;
    --dockerfile=*) dockerfile=${1#*=}; shift ;;
    --tag) tag=${2:?}; shift 2 ;;
    --tag=*) tag=${1#*=}; shift ;;
    --host) ssh_host=${2:?}; shift 2 ;;
    --host=*) ssh_host=${1#*=}; shift ;;
    --user) ssh_user=${2:?}; shift 2 ;;
    --user=*) ssh_user=${1#*=}; shift ;;
    --port) ssh_port=${2:?}; shift 2 ;;
    --port=*) ssh_port=${1#*=}; shift ;;
    --destination) remote_destination=${2:?}; shift 2 ;;
    --destination=*) remote_destination=${1#*=}; shift ;;
    --container) container_name=${2:?}; shift 2 ;;
    --container=*) container_name=${1#*=}; shift ;;
    --health-url) health_url=${2:?}; shift 2 ;;
    --health-url=*) health_url=${1#*=}; shift ;;
    --run-option) run_options+=("${2:?}"); shift 2 ;;
    --run-option=*) run_options+=("${1#*=}"); shift ;;
    --no-start) start_container=0; shift ;;
    --yes) assume_yes=1; shift ;;
    --changelog) changelog; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1 (use --help)." ;;
  esac
done

[[ "$ssh_port" =~ ^[0-9]+$ ]] || die 'SSH port must be numeric.'
[[ -z "$local_engine" || "$local_engine" == docker || "$local_engine" == podman ]] || die 'Local engine must be docker or podman.'
[[ -z "$remote_engine" || "$remote_engine" == docker || "$remote_engine" == podman ]] || die 'Remote engine must be docker or podman.'

banner
step 'Resolve local engine and image'
local_engine=$(choose_local_engine "$local_engine")
ok "Using local engine: $local_engine"

if [[ -n "$build_context" ]]; then
  [[ -d "$build_context" ]] || die "Build context does not exist: $build_context"
  tag=${tag:-$image}
  tag=$(prompt_required 'Image tag for the build' "$tag")
  dockerfile=${dockerfile:-"$build_context/Dockerfile"}
  [[ -f "$dockerfile" ]] || die "Build file does not exist: $dockerfile"
  field 'Build context' "$build_context"
  field 'Build file' "$dockerfile"
  field 'Image tag' "$tag"
  "$local_engine" build -f "$dockerfile" -t "$tag" "$build_context"
  image=$tag
  ok "Built $image"
elif [[ -z "$image" ]]; then
  printf '  1) Build a new image locally\n  2) Select an image used by a running container\n  3) Select from all local images\n'
  selection=$(prompt_default 'Image source' '1')
  case "$selection" in
    1)
      build_context=$(prompt_default 'Local build context' '.')
      tag=$(prompt_required 'Image tag for the build')
      dockerfile=$(prompt_default 'Dockerfile / Containerfile' "$build_context/Dockerfile")
      [[ -d "$build_context" ]] || die "Build context does not exist: $build_context"
      [[ -f "$dockerfile" ]] || die "Build file does not exist: $dockerfile"
      "$local_engine" build -f "$dockerfile" -t "$tag" "$build_context"
      image=$tag
      ;;
    2) image=$(select_existing_image "$local_engine" running) ;;
    3) image=$(select_existing_image "$local_engine" local) ;;
    *) die 'Image source must be 1, 2, or 3.' ;;
  esac
fi
"$local_engine" image inspect "$image" >/dev/null 2>&1 || die "Local image not found: $image"
local_image_id=$("$local_engine" image inspect --format '{{.Id}}' "$image")
ok "Selected $image"

step 'Collect destination and runtime details'
ssh_host=$(prompt_required 'Target FQDN / hostname / IP' "$ssh_host")
ssh_user=$(prompt_required 'SSH user' "$ssh_user")
remote_destination=$(prompt_required 'Remote image destination folder' "$remote_destination")
ssh_port=$(prompt_default 'SSH port' "$ssh_port")
[[ "$ssh_port" =~ ^[0-9]+$ ]] || die 'SSH port must be numeric.'
[[ "$remote_destination" == /* ]] || die 'Remote destination must be an absolute path.'
target="$ssh_user@$ssh_host"
scp_target=$target
[[ "$ssh_host" == *:* ]] && scp_target="$ssh_user@[$ssh_host]"

if (( start_container )); then
  default_name=$(printf '%s' "$image" | sed 's|.*/||; s|[:@].*||; s|[^A-Za-z0-9_.-]|-|g')
  container_name=$(prompt_default 'Remote container name' "${container_name:-$default_name}")
  if ((${#run_options[@]} == 0)); then
    printf '  %sEnter container run options separated by spaces.%s\n' "$C_DIM" "$C_RESET"
    printf '  %sFor values containing spaces, use repeated --run-option arguments instead.%s\n' "$C_DIM" "$C_RESET"
    read -r -p "$(printf '%s?%s Run options (ports, volumes, restart policy; blank for none): ' "$C_CYAN" "$C_RESET")" run_option_line
    if [[ -n "$run_option_line" ]]; then
      # Intentional shell-word splitting without eval: no substitutions execute.
      read -r -a run_options <<< "$run_option_line"
    fi
  fi
  health_url=$(prompt_default "HTTP health URL ('-' to skip)" "${health_url:--}")
fi

field 'SSH target' "$target:$ssh_port"
field 'Destination' "$remote_destination"
field 'Image' "$image"
(( start_container )) && field 'Container' "$container_name"

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/image-shipper.XXXXXX")
control_path="$tmp_dir/ssh-control"
archive_slug=$(printf '%s' "$image" | sed 's|[^A-Za-z0-9_.-]|-|g')
archive="$tmp_dir/${archive_slug}.tar.gz"
remote_archive="$remote_destination/${archive_slug}.tar.gz"
declare -a ssh_cmd scp_cmd
ssh_cmd=(ssh -p "$ssh_port" -o ControlMaster=auto -o ControlPersist=10m -o ControlPath="$control_path")
scp_cmd=(scp -P "$ssh_port" -o ControlMaster=auto -o ControlPersist=10m -o ControlPath="$control_path")

cleanup() {
  "${ssh_cmd[@]}" -O exit "$target" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT INT TERM

step 'Open authenticated SSH session'
printf '  %sOpenSSH will request the destination password or key passphrase directly.%s\n' "$C_DIM" "$C_RESET"
remote_destination_q=$(shell_quote "$remote_destination")
"${ssh_cmd[@]}" "$target" "mkdir -p $remote_destination_q"
if [[ -z "$remote_engine" ]]; then
  remote_engine=$("${ssh_cmd[@]}" "$target" 'if command -v docker >/dev/null 2>&1; then printf docker; elif command -v podman >/dev/null 2>&1; then printf podman; else exit 127; fi') || die 'Neither docker nor podman is installed remotely.'
fi
"${ssh_cmd[@]}" "$target" "command -v $(shell_quote "$remote_engine") >/dev/null" || die "$remote_engine is not installed remotely."
ok "Authenticated; remote engine is $remote_engine"

step 'Save and compress image'
"$local_engine" save "$image" | gzip -1 > "$archive"
archive_size=$(du -h "$archive" | awk '{print $1}')
ok "Created $(basename "$archive") ($archive_size)"

step 'Transfer image archive with SCP'
"${scp_cmd[@]}" "$archive" "$scp_target:$remote_archive"
ok "Transferred archive to $remote_archive"

step 'Load image on destination'
remote_archive_q=$(shell_quote "$remote_archive")
"${ssh_cmd[@]}" "$target" "gzip -dc $remote_archive_q | $remote_engine load"
remote_image_id=$("${ssh_cmd[@]}" "$target" "$remote_engine image inspect --format '{{.Id}}' $(shell_quote "$image")")
ok "Loaded $image"
field 'Local image ID' "$local_image_id"
field 'Remote image ID' "$remote_image_id"

if (( start_container )); then
  step 'Start destination container'
  container_q=$(shell_quote "$container_name")
  if "${ssh_cmd[@]}" "$target" "$remote_engine container inspect $container_q >/dev/null 2>&1"; then
    if (( assume_yes )) || confirm "Replace existing container '$container_name'?"; then
      "${ssh_cmd[@]}" "$target" "$remote_engine container rm -f $container_q >/dev/null"
      ok "Removed previous $container_name container"
    else
      die 'Deployment cancelled before replacing the existing container.'
    fi
  fi
  remote_run="$remote_engine run -d --name $container_q"
  for option in "${run_options[@]}"; do remote_run+=" $(shell_quote "$option")"; done
  remote_run+=" $(shell_quote "$image")"
  "${ssh_cmd[@]}" "$target" "$remote_run"
  ok "Started $container_name"

  step 'Verify image identity and inspect recent logs'
  running_image_id=$("${ssh_cmd[@]}" "$target" "$remote_engine inspect --format '{{.Image}}' $container_q")
  [[ "$running_image_id" == "$remote_image_id" ]] || die "Container image ID $running_image_id does not match loaded image $remote_image_id."
  ok 'Running container uses the newly loaded image'
  printf '%s%s── remote logs (last 80 lines) ───────────────────────────%s\n' "$C_DIM" "$C_BOLD" "$C_RESET"
  "${ssh_cmd[@]}" "$target" "$remote_engine logs --tail 80 $container_q" || warn 'Container logs returned a non-zero status.'
  printf '%s────────────────────────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"

  if [[ "$health_url" != '-' ]]; then
    step 'Confirm HTTP health with curl'
    command -v curl >/dev/null 2>&1 || die 'curl is required for HTTP verification.'
    healthy=0
    for attempt in {1..12}; do
      printf '  %s[%02d/12]%s GET %s ... ' "$C_DIM" "$attempt" "$C_RESET" "$health_url"
      if curl --fail --silent --show-error --max-time 8 --output /dev/null "$health_url"; then
        printf '%sOK%s\n' "$C_GREEN" "$C_RESET"; healthy=1; break
      fi
      printf '%sretrying%s\n' "$C_YELLOW" "$C_RESET"
      sleep 3
    done
    (( healthy )) || die "Health check did not succeed: $health_url"
    ok 'The new deployment is live over HTTP'
  else
    warn 'HTTP verification skipped; container identity and docker/podman logs were verified.'
  fi
else
  warn 'Image was loaded successfully; --no-start suppressed container startup.'
fi

step 'Deployment complete'
field 'Image' "$image"
field 'Remote host' "$ssh_host"
field 'Archive retained' "$remote_archive"
(( start_container )) && field 'Container' "$container_name"
printf '\n%s%s✓ Image shipment completed successfully.%s\n' "$C_GREEN" "$C_BOLD" "$C_RESET"
