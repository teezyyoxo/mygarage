#!/usr/bin/env bash
# image-shipper.sh — build/select, save, SCP, load, run, and verify an OCI image.
# Requires Bash 3.2+, OpenSSH, gzip, curl (for HTTP verification), and Docker
# or Podman locally and remotely. SSH authentication is handled by ssh/scp.

set -Eeuo pipefail

SCRIPT_VERSION="1.2.1"

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
  scripts/image-shipper.sh [REMOTE_COMPOSE_DIR] [options]

Passing `.` selects Compose deployment in the remote SSH user's current
directory. Any other positional path selects that remote Compose directory.

Selection/build:
  --deploy TARGET           Build TARGET, ship it, and recreate its Compose service
  --build                   Build before shipping (implied by --deploy)
  --image IMAGE             Existing local image reference to ship
  --build-context PATH      Build locally from this context before shipping
  --dockerfile PATH         Dockerfile/Containerfile path for the local build
  --tag IMAGE               Tag assigned to the locally built image
  --build-option VALUE      One docker/podman build argument; repeat as needed
  --platform PLATFORM       native, amd64, arm64, or linux/ARCH
  --engine docker|podman    Local engine (auto-detected or prompted otherwise)

Destination:
  --host HOST               Destination FQDN, hostname, or IP
  --user USER               Destination SSH user
  --port PORT               SSH port (default: 22)
  --destination PATH        Remote archive folder (default: /tmp)
  --remote-engine ENGINE    Remote docker/podman name or absolute executable

Run/verify:
  --compose-dir PATH        Recreate a service from this remote Compose project
  --compose-service NAME    Compose service to recreate after loading the image
  --compose-restart NAME    Compose service to restart afterward; repeatable
  --standalone              Run a standalone container instead of Compose
  --container NAME          Remote container name
  --run-option VALUE        One docker/podman run argument; repeat as needed
  --health-url URL          URL checked with curl after startup; '-' skips HTTP
  --no-start                Load the image without starting a container
  --yes                     Replace an existing named container without prompting

Information:
  --changelog               Print this script's changelog
  -h, --help                Show this help

Examples:
  scripts/image-shipper.sh --build-context . --tag mygarage:3.1.6

  scripts/image-shipper.sh . --image vehicle-hub_mygarage:latest \
    --host deskmini --user montel --compose-service mygarage \
    --compose-restart vehicle-hub-gateway

  scripts/image-shipper.sh --build-context . --tag mygarage:3.1.6 \
    --build-option=--build-arg --build-option=BUILD_COMMIT=abc1234

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

1.2.1 — 2026-08-25
  • MyGarage deployments now query the live public /api/version endpoint from
    the recreated container, verify its build ID against the loaded image, and
    print the API-reported version and commit in the completion summary.

1.2.0 — 2026-08-25
  • Added --deploy TARGET as a streamlined build, ship, Compose recreate, and
    verification workflow. It implies --build and infers MyGarage defaults.
  • Added target-platform selection plus safe reuse of /tmp image archives
    when their sidecar image ID matches the current local image.
  • Compose projects are preflighted before transfer, and `.` can discover a
    matching Compose project beneath the remote user's home directory.

1.1.0 — 2026-08-25
  • Added remote Compose deployment: after loading an image, the shipper can
    align the service's configured image tag, force-recreate that service,
    restart optional dependent services, and verify the running image ID.
  • A positional remote directory such as `.` selects Compose mode, and /tmp
    is now the default remote archive destination.
  • Fixed empty build/run option arrays crashing under macOS Bash 3.2 with
    nounset enabled.

1.0.2 — 2026-08-25
  • Fixed remote Docker/Podman discovery when non-interactive SSH sessions do
    not inherit the PATH used by the destination user's interactive shell.
  • Added Linux, Homebrew, Docker Desktop, and per-user CLI locations while
    preserving the resolved absolute executable for every remote operation.

1.0.1 — 2026-08-24
  • Added repeatable --build-option arguments for build args, platform flags,
    resource limits, and other Docker/Podman build settings.
  • Added captured build diagnostics that recognize memory-exhaustion failures,
    print the container engine's available memory, and retain the real exit code.

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

resolve_remote_engine() {
  local requested=${1:-} requested_q probe probe_q
  requested_q=$(shell_quote "$requested")
  probe='requested=$1
PATH="${HOME:-}/.docker/bin:${HOME:-}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PATH

resolve_named_engine() {
  engine_name=$1
  resolved=$(command -v "$engine_name" 2>/dev/null || true)
  if [ -n "$resolved" ] && [ -x "$resolved" ]; then
    printf "%s\n" "$resolved"
    return 0
  fi

  for candidate in \
    "${HOME:-}/.docker/bin/$engine_name" \
    "${HOME:-}/.local/bin/$engine_name" \
    "/usr/local/bin/$engine_name" \
    "/opt/homebrew/bin/$engine_name" \
    "/usr/bin/$engine_name" \
    "/Applications/Docker.app/Contents/Resources/bin/$engine_name"
  do
    if [ -x "$candidate" ]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done
  return 1
}

if [ -n "$requested" ]; then
  case "$requested" in
    /*)
      [ -x "$requested" ] || exit 127
      printf "%s\n" "$requested"
      ;;
    docker|podman)
      resolve_named_engine "$requested" || exit 127
      ;;
    *) exit 126 ;;
  esac
else
  resolve_named_engine docker || resolve_named_engine podman || exit 127
fi'
  probe_q=$(shell_quote "$probe")

  "${ssh_cmd[@]}" "$target" "sh -c $probe_q sh $requested_q"
}

resolve_remote_compose_dir() {
  local requested=$1 service=$2 requested_q service_q probe probe_q
  requested_q=$(shell_quote "$requested")
  service_q=$(shell_quote "$service")
  probe='requested=$1
service=$2

has_compose_file() {
  [ -f "$1/compose.yml" ] || [ -f "$1/compose.yaml" ] || \
    [ -f "$1/docker-compose.yml" ] || [ -f "$1/docker-compose.yaml" ]
}

compose_file() {
  for name in compose.yml compose.yaml docker-compose.yml docker-compose.yaml; do
    if [ -f "$1/$name" ]; then printf "%s\n" "$1/$name"; return 0; fi
  done
  return 1
}

if [ -d "$requested" ] && has_compose_file "$requested"; then
  file=$(compose_file "$requested") || exit 127
  if grep -Eq "^[[:space:]]*$service[[:space:]]*:" "$file"; then
    cd "$requested" && pwd -P
    exit 0
  fi
fi

matches=""
for candidate in "$HOME" "$HOME"/* "$HOME"/*/* "$HOME"/*/*/*; do
  [ -d "$candidate" ] || continue
  has_compose_file "$candidate" || continue
  file=$(compose_file "$candidate") || continue
  if grep -Eq "^[[:space:]]*$service[[:space:]]*:" "$file"; then
    resolved=$(cd "$candidate" && pwd -P) || continue
    if [ -z "$matches" ]; then
      matches=$resolved
    else
      matches="$matches
$resolved"
    fi
  fi
done

count=$(printf "%s\n" "$matches" | awk "NF { count++ } END { print count + 0 }")
if [ "$count" -eq 1 ]; then
  printf "%s\n" "$matches"
  exit 0
fi
if [ "$count" -gt 1 ]; then
  printf "%s\n" "$matches" >&2
  exit 2
fi
exit 127'
  probe_q=$(shell_quote "$probe")
  "${ssh_cmd[@]}" "$target" "sh -c $probe_q sh $requested_q $service_q"
}

human_bytes() {
  awk -v bytes="$1" 'BEGIN {
    split("B KiB MiB GiB TiB", units, " ")
    value = bytes + 0
    unit = 1
    while (value >= 1024 && unit < 5) { value /= 1024; unit++ }
    printf "%.2f %s", value, units[unit]
  }'
}

run_local_build() {
  local engine=$1 build_file=$2 image_tag=$3 context=$4 build_status memory_bytes
  local build_log
  shift 4
  build_log=$(mktemp "${TMPDIR:-/tmp}/image-shipper-build.XXXXXX")

  if "$engine" build "$@" -f "$build_file" -t "$image_tag" "$context" 2>&1 | tee "$build_log"; then
    rm -f "$build_log"
    return 0
  else
    build_status=${PIPESTATUS[0]}
  fi

  if grep -Eiq 'cannot allocate memory|resourceexhausted|out of memory|oom|signal sigkill|(^|[[:space:]])killed([[:space:]]|$)' "$build_log"; then
    printf '\n  %s%sMemory exhaustion detected during the image build.%s\n' "$C_RED" "$C_BOLD" "$C_RESET" >&2
    memory_bytes=$("$engine" info --format '{{.MemTotal}}' 2>/dev/null || true)
    if [[ "$memory_bytes" =~ ^[0-9]+$ ]]; then
      field 'Engine memory' "$(human_bytes "$memory_bytes")" >&2
    fi
    printf '  Stop unneeded containers or increase the Docker/Podman VM memory, then retry.\n' >&2
    printf '  MyGarage uses Bun low-memory mode automatically for its frontend build.\n' >&2
  fi
  printf '  %sBuild log:%s %s\n' "$C_DIM" "$C_RESET" "$build_log" >&2
  return "$build_status"
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
health_url=''; deploy_mode=''; compose_dir=''; compose_service=''; start_container=1; assume_yes=0
fast_deploy=0; force_build=0; deploy_target=''; build_platform=''
declare -a build_options run_options compose_restart_services
build_options=(); run_options=(); compose_restart_services=()

while (($#)); do
  case "$1" in
    --engine) local_engine=${2:?}; shift 2 ;;
    --engine=*) local_engine=${1#*=}; shift ;;
    --remote-engine) remote_engine=${2:?}; shift 2 ;;
    --remote-engine=*) remote_engine=${1#*=}; shift ;;
    --deploy)
      deploy_target=${2:-.}
      if [[ "$deploy_target" == -* ]]; then deploy_target='.'; shift; else shift 2; fi
      fast_deploy=1; force_build=1; deploy_mode=compose
      ;;
    --deploy=*) deploy_target=${1#*=}; fast_deploy=1; force_build=1; deploy_mode=compose; shift ;;
    --build) force_build=1; shift ;;
    --image) image=${2:?}; shift 2 ;;
    --image=*) image=${1#*=}; shift ;;
    --build-context) build_context=${2:?}; shift 2 ;;
    --build-context=*) build_context=${1#*=}; shift ;;
    --dockerfile) dockerfile=${2:?}; shift 2 ;;
    --dockerfile=*) dockerfile=${1#*=}; shift ;;
    --tag) tag=${2:?}; shift 2 ;;
    --tag=*) tag=${1#*=}; shift ;;
    --build-option) build_options+=("${2:?}"); shift 2 ;;
    --build-option=*) build_options+=("${1#*=}"); shift ;;
    --platform) build_platform=${2:?}; shift 2 ;;
    --platform=*) build_platform=${1#*=}; shift ;;
    --host) ssh_host=${2:?}; shift 2 ;;
    --host=*) ssh_host=${1#*=}; shift ;;
    --user) ssh_user=${2:?}; shift 2 ;;
    --user=*) ssh_user=${1#*=}; shift ;;
    --port) ssh_port=${2:?}; shift 2 ;;
    --port=*) ssh_port=${1#*=}; shift ;;
    --destination) remote_destination=${2:?}; shift 2 ;;
    --destination=*) remote_destination=${1#*=}; shift ;;
    --compose-dir) compose_dir=${2:?}; deploy_mode=compose; shift 2 ;;
    --compose-dir=*) compose_dir=${1#*=}; deploy_mode=compose; shift ;;
    --compose-service) compose_service=${2:?}; deploy_mode=compose; shift 2 ;;
    --compose-service=*) compose_service=${1#*=}; deploy_mode=compose; shift ;;
    --compose-restart) compose_restart_services+=("${2:?}"); deploy_mode=compose; shift 2 ;;
    --compose-restart=*) compose_restart_services+=("${1#*=}"); deploy_mode=compose; shift ;;
    --standalone) deploy_mode=standalone; shift ;;
    --container) container_name=${2:?}; deploy_mode=standalone; shift 2 ;;
    --container=*) container_name=${1#*=}; deploy_mode=standalone; shift ;;
    --health-url) health_url=${2:?}; shift 2 ;;
    --health-url=*) health_url=${1#*=}; shift ;;
    --run-option) run_options+=("${2:?}"); deploy_mode=standalone; shift 2 ;;
    --run-option=*) run_options+=("${1#*=}"); deploy_mode=standalone; shift ;;
    --no-start) start_container=0; deploy_mode=none; shift ;;
    --yes) assume_yes=1; shift ;;
    --changelog) changelog; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    -*) die "Unknown argument: $1 (use --help)." ;;
    *)
      [[ -z "$compose_dir" ]] || die 'Only one positional remote Compose directory may be supplied.'
      compose_dir=$1; deploy_mode=compose; shift
      ;;
  esac
done

[[ "$ssh_port" =~ ^[0-9]+$ ]] || die 'SSH port must be numeric.'
[[ -z "$local_engine" || "$local_engine" == docker || "$local_engine" == podman ]] || die 'Local engine must be docker or podman.'
[[ -z "$remote_engine" || "$remote_engine" == docker || "$remote_engine" == podman || "$remote_engine" == /* ]] || die 'Remote engine must be docker, podman, or an absolute executable path.'

banner
step 'Resolve local engine and image'
local_engine=$(choose_local_engine "$local_engine")
ok "Using local engine: $local_engine"

if (( fast_deploy )); then
  if [[ -d "$deploy_target" ]]; then
    if [[ -f "$deploy_target/Dockerfile" ]]; then
      build_context=$deploy_target
      image=${image:-"$(basename "$(cd "$deploy_target" && pwd)"):latest"}
    elif [[ -f "$deploy_target/mygarage/Dockerfile" ]]; then
      build_context="$deploy_target/mygarage"
      image=${image:-vehicle-hub_mygarage:latest}
      compose_service=${compose_service:-mygarage}
    else
      die "--deploy directory has no Dockerfile: $deploy_target"
    fi
  else
    image=$deploy_target
    case "$image" in
      *mygarage*)
        script_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
        build_context=$script_root
        compose_service=${compose_service:-mygarage}
        ;;
      *)
        if [[ -z "$build_context" ]]; then
          build_context=$(prompt_default 'Local build context' '.')
        fi
        [[ -f "$build_context/Dockerfile" ]] || die "Build context has no Dockerfile: $build_context"
        ;;
    esac
  fi
  tag=${tag:-$image}
fi

if (( force_build )) && [[ -z "$build_context" ]]; then
  build_context=$(prompt_default 'Local build context' '.')
fi

if [[ -n "$build_context" ]]; then
  if [[ -z "$build_platform" ]]; then
    build_platform=$(prompt_default 'Build platform (native, amd64, arm64)' 'amd64')
  fi
  case "$build_platform" in
    native) ;;
    amd64|arm64) build_options+=(--platform "linux/$build_platform") ;;
    linux/amd64|linux/arm64) build_options+=(--platform "$build_platform") ;;
    *) die 'Build platform must be native, amd64, arm64, linux/amd64, or linux/arm64.' ;;
  esac
  if [[ "${image:-$tag}" == *mygarage* ]]; then
    has_build_commit=0
    if ((${#build_options[@]})); then
      for build_option in "${build_options[@]}"; do
        [[ "$build_option" == BUILD_COMMIT=* ]] && has_build_commit=1
      done
    fi
    if (( ! has_build_commit )); then
      build_commit=$(git -C "$build_context" rev-parse --short HEAD 2>/dev/null || true)
      [[ -n "$build_commit" ]] || die 'Could not determine the MyGarage BUILD_COMMIT.'
      build_options+=(--build-arg "BUILD_COMMIT=$build_commit")
    fi
  fi
fi

if [[ -n "$build_context" ]]; then
  [[ -d "$build_context" ]] || die "Build context does not exist: $build_context"
  tag=${tag:-$image}
  tag=$(prompt_required 'Image tag for the build' "$tag")
  dockerfile=${dockerfile:-"$build_context/Dockerfile"}
  [[ -f "$dockerfile" ]] || die "Build file does not exist: $dockerfile"
  field 'Build context' "$build_context"
  field 'Build file' "$dockerfile"
  field 'Image tag' "$tag"
  if ((${#build_options[@]})); then
    run_local_build "$local_engine" "$dockerfile" "$tag" "$build_context" "${build_options[@]}" || die "Local image build failed: $tag"
  else
    run_local_build "$local_engine" "$dockerfile" "$tag" "$build_context" || die "Local image build failed: $tag"
  fi
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
      if ((${#build_options[@]} == 0)); then
        printf '  %sEnter optional build arguments separated by spaces.%s\n' "$C_DIM" "$C_RESET"
        read -r -p "$(printf '%s?%s Build options (blank for none): ' "$C_CYAN" "$C_RESET")" build_option_line
        if [[ -n "$build_option_line" ]]; then
          # Intentional shell-word splitting without eval: no substitutions execute.
          read -r -a build_options <<< "$build_option_line"
        fi
      fi
      if ((${#build_options[@]})); then
        run_local_build "$local_engine" "$dockerfile" "$tag" "$build_context" "${build_options[@]}" || die "Local image build failed: $tag"
      else
        run_local_build "$local_engine" "$dockerfile" "$tag" "$build_context" || die "Local image build failed: $tag"
      fi
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
if [[ -z "$remote_destination" && $fast_deploy -eq 1 ]]; then
  remote_destination=/tmp
elif [[ -z "$remote_destination" ]]; then
  remote_destination=$(prompt_default 'Remote image destination folder' '/tmp')
fi
if (( ! fast_deploy )); then
  ssh_port=$(prompt_default 'SSH port' "$ssh_port")
fi
[[ "$ssh_port" =~ ^[0-9]+$ ]] || die 'SSH port must be numeric.'
[[ "$remote_destination" == /* ]] || die 'Remote destination must be an absolute path.'
target="$ssh_user@$ssh_host"
scp_target=$target
[[ "$ssh_host" == *:* ]] && scp_target="$ssh_user@[$ssh_host]"

if [[ -z "$deploy_mode" ]]; then
  printf '  1) Recreate a service with Docker/Podman Compose\n'
  printf '  2) Run a standalone container\n'
  printf '  3) Load the image only\n'
  deploy_selection=$(prompt_default 'Remote deployment method' '1')
  case "$deploy_selection" in
    1) deploy_mode=compose ;;
    2) deploy_mode=standalone ;;
    3) deploy_mode=none; start_container=0 ;;
    *) die 'Remote deployment method must be 1, 2, or 3.' ;;
  esac
fi

if [[ "$deploy_mode" == compose ]]; then
  if (( fast_deploy )); then
    compose_dir=${compose_dir:-.}
  else
    compose_dir=$(prompt_default 'Remote Compose project directory' "${compose_dir:-.}")
  fi
  default_service=$(printf '%s' "$image" | sed 's|.*/||; s|[:@].*||; s|[^A-Za-z0-9_.-]|-|g')
  case "$image" in
    *mygarage*) default_service=mygarage ;;
    *vehicle-hub-sync*|*vehicle-hub_vehicle-hub-sync*) default_service=vehicle-hub-sync ;;
  esac
  if (( fast_deploy )); then
    compose_service=${compose_service:-$default_service}
  else
    compose_service=$(prompt_default 'Compose service to recreate' "${compose_service:-$default_service}")
  fi
  [[ "$compose_service" =~ ^[A-Za-z0-9_.-]+$ ]] || die 'Compose service contains invalid characters.'
  if ((${#compose_restart_services[@]} == 0)); then
    restart_default='-'
    [[ "$compose_service" == mygarage ]] && restart_default='vehicle-hub-gateway'
    if (( fast_deploy )); then
      restart_service=$restart_default
    else
      restart_service=$(prompt_default "Dependent Compose service to restart ('-' for none)" "$restart_default")
    fi
    [[ "$restart_service" == '-' ]] || compose_restart_services+=("$restart_service")
  fi
  if (( fast_deploy )); then
    health_url=${health_url:--}
  else
    health_url=$(prompt_default "HTTP health URL ('-' to skip)" "${health_url:--}")
  fi
elif [[ "$deploy_mode" == standalone ]]; then
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
if [[ "$deploy_mode" == compose ]]; then
  field 'Deploy method' 'Compose recreate'
  field 'Compose directory' "$compose_dir"
  field 'Compose service' "$compose_service"
elif [[ "$deploy_mode" == standalone ]]; then
  field 'Deploy method' 'Standalone container'
  field 'Container' "$container_name"
else
  field 'Deploy method' 'Load only'
fi

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/image-shipper.XXXXXX")
control_path="$tmp_dir/ssh-control"
archive_slug=$(printf '%s' "$image" | sed 's|[^A-Za-z0-9_.-]|-|g')
archive="/tmp/${archive_slug}.tar.gz"
archive_id_file="$archive.image-id"
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
requested_remote_engine=$remote_engine
remote_engine=$(resolve_remote_engine "$requested_remote_engine") || die 'Docker/Podman was not visible to non-interactive SSH. Checked the remote PATH and common Linux, Homebrew, Docker Desktop, and per-user locations; use --remote-engine /absolute/path if needed.'
remote_engine_q=$(shell_quote "$remote_engine")
"${ssh_cmd[@]}" "$target" "test -x $remote_engine_q" || die "Remote engine is not executable: $remote_engine"
ok "Authenticated; remote engine is $remote_engine"
if [[ "$deploy_mode" == compose ]]; then
  requested_compose_dir=$compose_dir
  if ! compose_dir=$(resolve_remote_compose_dir "$requested_compose_dir" "$compose_service"); then
    die "No unambiguous Compose project containing service '$compose_service' was found from '$requested_compose_dir'. Pass its remote path with --compose-dir."
  fi
  compose_dir_q=$(shell_quote "$compose_dir")
  ok "Preflighted Compose project: $compose_dir"
fi

step 'Save and compress image'
reuse_archive=0
if [[ -f "$archive" && -f "$archive_id_file" ]]; then
  archived_image_id=$(<"$archive_id_file")
  if [[ "$archived_image_id" == "$local_image_id" ]]; then
    if (( fast_deploy )) || confirm "Reuse matching staged archive $archive?"; then
      reuse_archive=1
      ok "Reusing staged archive for image ID $local_image_id"
    fi
  else
    warn "Ignoring stale staged archive for image ID ${archived_image_id:-unknown}."
  fi
elif [[ -f "$archive" ]]; then
  warn 'Ignoring staged archive without a verifiable image-ID sidecar.'
fi
if (( ! reuse_archive )); then
  "$local_engine" save "$image" | gzip -1 > "$archive"
  printf '%s\n' "$local_image_id" > "$archive_id_file"
fi
archive_size=$(du -h "$archive" | awk '{print $1}')
ok "Staged $(basename "$archive") ($archive_size)"

step 'Transfer image archive with SCP'
"${scp_cmd[@]}" "$archive" "$scp_target:$remote_archive"
ok "Transferred archive to $remote_archive"

step 'Load image on destination'
remote_archive_q=$(shell_quote "$remote_archive")
"${ssh_cmd[@]}" "$target" "gzip -dc $remote_archive_q | $remote_engine_q load"
remote_image_id=$("${ssh_cmd[@]}" "$target" "$remote_engine_q image inspect --format '{{.Id}}' $(shell_quote "$image")")
image_build_commit=$("${ssh_cmd[@]}" "$target" "$remote_engine_q image inspect --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' $(shell_quote "$image")" 2>/dev/null || true)
[[ "$image_build_commit" == '<no value>' ]] && image_build_commit=''
ok "Loaded $image"
field 'Local image ID' "$local_image_id"
field 'Remote image ID' "$remote_image_id"

if [[ "$deploy_mode" == compose ]]; then
  step 'Recreate destination Compose service'
  compose_dir_q=$(shell_quote "$compose_dir")
  compose_service_q=$(shell_quote "$compose_service")
  if [[ -n "$image_build_commit" ]]; then
    remote_compose="BUILD_COMMIT=$(shell_quote "$image_build_commit") $remote_engine_q compose"
    field 'Compose build ID' "$image_build_commit"
  else
    remote_compose="$remote_engine_q compose"
  fi
  "${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose version >/dev/null" || die "Docker/Podman Compose is unavailable in $compose_dir."
  "${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose config --services | grep -Fx -- $compose_service_q >/dev/null" || die "Compose service '$compose_service' was not found in $compose_dir."

  compose_image=$("${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose config --images $compose_service_q | head -n 1")
  if [[ -n "$compose_image" && "$compose_image" != "$image" ]]; then
    "${ssh_cmd[@]}" "$target" "$remote_engine_q tag $(shell_quote "$image") $(shell_quote "$compose_image")"
    ok "Aligned Compose image tag $compose_image with $image"
  fi

  "${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose up -d --no-build --no-deps --force-recreate $compose_service_q"
  ok "Recreated Compose service $compose_service"
  if ((${#compose_restart_services[@]})); then
    for restart_service in "${compose_restart_services[@]}"; do
      restart_service_q=$(shell_quote "$restart_service")
      "${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose restart $restart_service_q"
      ok "Restarted dependent service $restart_service"
    done
  fi

  step 'Verify Compose service image identity and logs'
  compose_container_id=$("${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose ps -q $compose_service_q")
  [[ -n "$compose_container_id" ]] || die "Compose service '$compose_service' did not create a running container."
  running_image_id=$("${ssh_cmd[@]}" "$target" "$remote_engine_q inspect --format '{{.Image}}' $(shell_quote "$compose_container_id")")
  [[ "$running_image_id" == "$remote_image_id" ]] || die "Compose service image ID $running_image_id does not match loaded image $remote_image_id."
  ok 'Compose service uses the newly loaded image'
  printf '%s%s── remote logs (last 80 lines) ───────────────────────────%s\n' "$C_DIM" "$C_BOLD" "$C_RESET"
  "${ssh_cmd[@]}" "$target" "cd $compose_dir_q && $remote_compose logs --tail 80 $compose_service_q" || warn 'Compose logs returned a non-zero status.'
  printf '%s────────────────────────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"
elif [[ "$deploy_mode" == standalone ]]; then
  step 'Start destination container'
  container_q=$(shell_quote "$container_name")
  if "${ssh_cmd[@]}" "$target" "$remote_engine_q container inspect $container_q >/dev/null 2>&1"; then
    if (( assume_yes )) || confirm "Replace existing container '$container_name'?"; then
      "${ssh_cmd[@]}" "$target" "$remote_engine_q container rm -f $container_q >/dev/null"
      ok "Removed previous $container_name container"
    else
      die 'Deployment cancelled before replacing the existing container.'
    fi
  fi
  remote_run="$remote_engine_q run -d --name $container_q"
  if ((${#run_options[@]})); then
    for option in "${run_options[@]}"; do remote_run+=" $(shell_quote "$option")"; done
  fi
  remote_run+=" $(shell_quote "$image")"
  "${ssh_cmd[@]}" "$target" "$remote_run"
  ok "Started $container_name"

  step 'Verify image identity and inspect recent logs'
  running_image_id=$("${ssh_cmd[@]}" "$target" "$remote_engine_q inspect --format '{{.Image}}' $container_q")
  [[ "$running_image_id" == "$remote_image_id" ]] || die "Container image ID $running_image_id does not match loaded image $remote_image_id."
  ok 'Running container uses the newly loaded image'
  printf '%s%s── remote logs (last 80 lines) ───────────────────────────%s\n' "$C_DIM" "$C_BOLD" "$C_RESET"
  "${ssh_cmd[@]}" "$target" "$remote_engine_q logs --tail 80 $container_q" || warn 'Container logs returned a non-zero status.'
  printf '%s────────────────────────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"

else
  warn 'Image was loaded successfully; --no-start suppressed container startup.'
fi

live_version=''
live_build_commit=''
if [[ "$image" == *mygarage* && "$deploy_mode" != none ]]; then
  step 'Verify live MyGarage API identity'
  if [[ "$deploy_mode" == compose ]]; then
    identity_container=$compose_container_id
  else
    identity_container=$container_name
  fi
  identity_container_q=$(shell_quote "$identity_container")
  runtime_json=$("${ssh_cmd[@]}" "$target" "for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do $remote_engine_q exec $identity_container_q curl -fsS --max-time 8 http://127.0.0.1:8686/api/version && exit 0; sleep 2; done; exit 1") || die 'The recreated MyGarage container did not return its runtime identity API.'
  live_version=$(printf '%s' "$runtime_json" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  live_build_commit=$(printf '%s' "$runtime_json" | sed -n 's/.*"build_commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  [[ -n "$live_version" && -n "$live_build_commit" ]] || die "MyGarage returned an invalid runtime identity payload: $runtime_json"
  if [[ -n "$image_build_commit" && "$live_build_commit" != "$image_build_commit" ]]; then
    die "MyGarage API build $live_build_commit does not match loaded image build $image_build_commit."
  fi
  ok "MyGarage API reports v$live_version · $live_build_commit"
fi

if [[ "$deploy_mode" != none && "$health_url" != '-' ]]; then
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
elif [[ "$deploy_mode" != none ]]; then
  warn 'HTTP verification skipped; image identity and remote logs were verified.'
fi

step 'Deployment complete'
field 'Image' "$image"
field 'Remote host' "$ssh_host"
field 'Archive retained' "$remote_archive"
field 'Local archive' "$archive"
if [[ "$deploy_mode" == compose ]]; then
  field 'Compose service' "$compose_service"
elif [[ "$deploy_mode" == standalone ]]; then
  field 'Container' "$container_name"
fi
if [[ -n "$live_version" ]]; then
  field 'MyGarage version' "$live_version"
  field 'MyGarage build' "$live_build_commit"
fi
printf '\n%s%s✓ Image shipment completed successfully.%s\n' "$C_GREEN" "$C_BOLD" "$C_RESET"
