#!/usr/bin/env bash
# Forge setup for Ubuntu 24.04 under WSL2 (the user's laptop).
#
# Run it from anywhere inside the repo checkout:
#     bash tools/forge/scripts/setup-wsl.sh          # asks before every sudo step
#     bash tools/forge/scripts/setup-wsl.sh --yes    # no prompts
#
# What it does (safe to re-run; every step checks first and skips what is already done):
#   1. apt packages: ffmpeg, build-essential, libsndfile1, rubberband-cli, git, curl,
#      ca-certificates (sudo, after showing the list and asking).
#   2. uv: uses the one on PATH, else installs it into ~/.stemdeck/bin.
#   3. Python 3.11 via uv, into ~/.stemdeck/python (Ubuntu 24.04 ships 3.12 only).
#   4. uv sync for tools/forge with the analysis + separation extras (torch CUDA wheels, ~6 GB).
#   5. GPU check: nvidia-smi and torch.cuda, with what to do if CUDA is not visible in WSL2.
#   6. Optionally downloads the separation model weights (~1 GB) into ~/.stemdeck/models.
#   7. Runs `forge doctor`; the script's exit status is doctor's.
#
# It writes only under ~/.stemdeck/ and the repo (tools/forge/.venv). System packages are the
# only exception, and only after you confirm the sudo step.

set -euo pipefail

ASSUME_YES=0
WITH_SEPARATION=1
MODELS=ask
usage() {
  cat <<'EOF'
Usage: setup-wsl.sh [--yes] [--no-separation] [--models | --no-models]

  --yes            do not ask before sudo steps or the model download
  --no-separation  skip the torch/audio-separator/beat_this extra (CPU-only quick setup)
  --models         download separation model weights (~1 GB) without asking
  --no-models      do not download model weights
EOF
}
for arg in "$@"; do
  case "$arg" in
    -y | --yes) ASSUME_YES=1 ;;
    --no-separation) WITH_SEPARATION=0 ;;
    --models) MODELS=yes ;;
    --no-models) MODELS=no ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# confirm "question" -> 0 for yes. --yes answers yes; no terminal answers no.
confirm() {
  if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
  if [[ ! -t 0 ]]; then
    warn "no terminal to ask on; re-run with --yes to accept: $1"
    return 1
  fi
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# --------------------------------------------------------------------------- locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$FORGE_DIR/../.." && pwd)"
[[ -f "$FORGE_DIR/pyproject.toml" ]] || die "cannot find tools/forge/pyproject.toml next to this script"

STEMDECK_HOME="${STEMDECK_HOME:-$HOME/.stemdeck}"
export STEMDECK_HOME
# Keep uv's binary, interpreters and cache inside ~/.stemdeck.
export UV_INSTALL_DIR="$STEMDECK_HOME/bin"
export UV_PYTHON_INSTALL_DIR="$STEMDECK_HOME/python"
export UV_CACHE_DIR="$STEMDECK_HOME/cache/uv"
export UV_NO_MODIFY_PATH=1
export PATH="$UV_INSTALL_DIR:$PATH"
mkdir -p "$STEMDECK_HOME"

info "Repo: $REPO_DIR"
info "Forge data folder: $STEMDECK_HOME"

# --------------------------------------------------------------------------- platform
if grep -qi microsoft /proc/version 2>/dev/null; then
  info "Running under WSL2"
else
  warn "this does not look like WSL2; continuing, but the GPU notes below assume WSL2"
fi
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
    warn "tested on Ubuntu 24.04; found ${PRETTY_NAME:-unknown}"
  fi
fi

# --------------------------------------------------------------------------- 1. apt
APT_PACKAGES=(ffmpeg build-essential libsndfile1 rubberband-cli git curl ca-certificates)
missing=()
for pkg in "${APT_PACKAGES[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    missing+=("$pkg")
  fi
done
if [[ ${#missing[@]} -eq 0 ]]; then
  info "apt packages already installed: ${APT_PACKAGES[*]}"
else
  info "About to run with sudo:"
  echo "      sudo apt-get update"
  echo "      sudo apt-get install -y ${missing[*]}"
  echo "    ffmpeg decodes songs; build-essential builds madmom; libsndfile1 reads audio;"
  echo "    rubberband-cli is the offline time-stretcher (grid-warp); git fetches madmom."
  if confirm "Install these system packages now?"; then
    sudo apt-get update
    sudo apt-get install -y "${missing[@]}"
  else
    die "system packages are required; install them yourself and re-run"
  fi
fi

# --------------------------------------------------------------------------- 2. uv
if command -v uv >/dev/null 2>&1; then
  info "uv found: $(command -v uv) ($(uv --version))"
else
  info "Installing uv into $UV_INSTALL_DIR (official installer from astral.sh, no sudo)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  command -v uv >/dev/null 2>&1 || die "uv install failed"
  info "uv installed: $(uv --version)"
fi

# --------------------------------------------------------------------------- 3. Python 3.11
if uv python find 3.11 >/dev/null 2>&1; then
  info "Python 3.11 found: $(uv python find 3.11)"
else
  info "Installing Python 3.11 with uv into $UV_PYTHON_INSTALL_DIR"
  uv python install 3.11
fi

# --------------------------------------------------------------------------- 4. uv sync
extras=(--extra analysis)
if [[ $WITH_SEPARATION -eq 1 ]]; then
  extras+=(--extra separation)
  info "Syncing Forge with the analysis + separation extras (torch CUDA wheels: ~3 GB download, ~6 GB on disk)"
else
  info "Syncing Forge with the analysis extra only (--no-separation)"
fi
uv sync --project "$FORGE_DIR" --python 3.11 "${extras[@]}"

# Let later shells find uv and the interpreter: source this file from ~/.bashrc if you like.
ENV_FILE="$STEMDECK_HOME/env.sh"
cat >"$ENV_FILE" <<EOF
# Written by tools/forge/scripts/setup-wsl.sh. Add to ~/.bashrc:  source "$ENV_FILE"
export PATH="$UV_INSTALL_DIR:\$PATH"
export UV_PYTHON_INSTALL_DIR="$UV_PYTHON_INSTALL_DIR"
export UV_CACHE_DIR="$UV_CACHE_DIR"
EOF
info "Wrote $ENV_FILE (add 'source $ENV_FILE' to ~/.bashrc so uv finds the same Python and cache)"

forge() { uv run --project "$FORGE_DIR" forge "$@"; }

# --------------------------------------------------------------------------- 5. GPU
NVSMI="$(command -v nvidia-smi || true)"
[[ -z "$NVSMI" && -x /usr/lib/wsl/lib/nvidia-smi ]] && NVSMI=/usr/lib/wsl/lib/nvidia-smi
if [[ -n "$NVSMI" ]] && "$NVSMI" >/dev/null 2>&1; then
  info "GPU visible to WSL2:"
  "$NVSMI" --query-gpu=name,driver_version,memory.total --format=csv,noheader | sed 's/^/      /'
else
  warn "nvidia-smi is not available, so CUDA is not visible inside WSL2. Forge still works, but"
  cat >&2 <<'EOF'
      separation will run on the CPU (several minutes per song). To fix:
        1. In Windows, install the current NVIDIA Game Ready or Studio driver
           (it includes WSL2 CUDA support). Do NOT install an NVIDIA/CUDA driver inside Ubuntu.
        2. In PowerShell: wsl --update   then   wsl --shutdown
        3. Reopen Ubuntu and run: nvidia-smi   (it lives in /usr/lib/wsl/lib)
        4. Re-run this script.
EOF
fi
if [[ $WITH_SEPARATION -eq 1 ]]; then
  if uv run --project "$FORGE_DIR" python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 3)"; then
    info "torch sees CUDA: $(uv run --project "$FORGE_DIR" python -c 'import torch; print(torch.cuda.get_device_name(0), "CUDA", torch.version.cuda)')"
  else
    warn "torch cannot use CUDA. If nvidia-smi works above, the Windows driver is probably too old for"
    warn "this torch build (PyPI torch uses CUDA 13, which needs an R580 or newer driver): update it,"
    warn "then 'wsl --shutdown' and try again."
  fi
fi

# --------------------------------------------------------------------------- 6. model weights
if [[ $WITH_SEPARATION -eq 1 ]]; then
  do_models=0
  case "$MODELS" in
    yes) do_models=1 ;;
    no) do_models=0 ;;
    ask) confirm "Download separation + beat model weights (~1 GB) into $STEMDECK_HOME/models now?" && do_models=1 ;;
  esac
  if [[ $do_models -eq 1 ]]; then
    forge models download || warn "some model downloads failed; 'forge doctor' lists what is missing"
  else
    info "Skipping model download. Later: uv run --project tools/forge forge models download"
  fi
fi

# --------------------------------------------------------------------------- 7. doctor
info "Running forge doctor"
set +e
forge doctor
status=$?
set -e
if [[ $status -eq 0 ]]; then
  info "Forge is ready. Next: uv run --project tools/forge forge fixtures --out .fixtures"
else
  warn "forge doctor reported a failed required check (see the table above)"
fi
exit $status
