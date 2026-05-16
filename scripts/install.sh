#!/usr/bin/env bash
# Deploymate Agent installer
# Usage: curl -fsSL https://your-domain/install.sh | bash
# Or with options: curl -fsSL ... | AGENT_TOKEN=xxx BACKEND_WS_URL=wss://... bash

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────
AGENT_USER="deploymate"
AGENT_DIR="/opt/deploymate-agent"
SERVICE_NAME="deploymate-agent"
NODE_VERSION="20"
LOG_FILE="/var/log/deploymate-agent-install.log"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $*" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*" | tee -a "$LOG_FILE"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" | tee -a "$LOG_FILE"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
# Platform detection
# ─────────────────────────────────────────────────────────────────────────
detect_os() {
  if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    OS=$ID
    OS_VERSION=${VERSION_ID:-""}
  elif [[ "$(uname)" == "Darwin" ]]; then
    OS="darwin"
  else
    OS="unknown"
  fi
  ARCH="$(uname -m)"
  info "Detected OS: $OS, Arch: $ARCH"
}

detect_service_manager() {
  if command -v systemctl &>/dev/null && systemctl --version &>/dev/null 2>&1; then
    SERVICE_MANAGER="systemd"
  elif [[ "$OS" == "darwin" ]]; then
    SERVICE_MANAGER="launchd"
  else
    SERVICE_MANAGER="none"
    warn "No supported service manager found — agent will not start automatically"
  fi
  info "Service manager: $SERVICE_MANAGER"
}

# ─────────────────────────────────────────────────────────────────────────
# Docker installation
# ─────────────────────────────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    info "Docker already installed: $(docker --version)"
    return
  fi

  info "Installing Docker..."
  case "$OS" in
    ubuntu|debian)
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl gnupg lsb-release
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
      apt-get update -qq
      apt-get install -y -qq docker-ce docker-ce-cli containerd.io
      systemctl enable --now docker
      ;;
    centos|rhel|fedora)
      dnf install -y docker-ce docker-ce-cli containerd.io
      systemctl enable --now docker
      ;;
    *)
      error "Automatic Docker install not supported on $OS. Please install Docker manually: https://docs.docker.com/get-docker/"
      ;;
  esac
  info "Docker installed: $(docker --version)"
}

# ─────────────────────────────────────────────────────────────────────────
# Node.js installation
# ─────────────────────────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$ver" -ge "$NODE_VERSION" ]]; then
      info "Node.js already installed: $(node --version)"
      return
    fi
  fi

  info "Installing Node.js $NODE_VERSION..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y -qq nodejs
  info "Node.js installed: $(node --version)"
}

# ─────────────────────────────────────────────────────────────────────────
# Traefik installation
# ─────────────────────────────────────────────────────────────────────────
install_traefik() {
  if command -v traefik &>/dev/null; then
    info "Traefik already installed: $(traefik version --short 2>/dev/null || echo unknown)"
    return
  fi

  info "Installing Traefik..."
  TRAEFIK_VERSION="v3.3.0"
  TRAEFIK_URL="https://github.com/traefik/traefik/releases/download/${TRAEFIK_VERSION}/traefik_${TRAEFIK_VERSION}_linux_amd64.tar.gz"
  curl -fsSL "$TRAEFIK_URL" | tar -xz -C /usr/local/bin traefik
  chmod +x /usr/local/bin/traefik
  info "Traefik installed"
}

# ─────────────────────────────────────────────────────────────────────────
# Agent installation
# ─────────────────────────────────────────────────────────────────────────
install_agent() {
  info "Installing Deploymate Agent..."

  # Create agent user
  if ! id "$AGENT_USER" &>/dev/null; then
    useradd -r -s /bin/false -d "$AGENT_DIR" "$AGENT_USER" || true
  fi

  # Add agent user to docker group
  usermod -aG docker "$AGENT_USER" || true

  # Create directories
  mkdir -p "$AGENT_DIR" "/tmp/deploymate-agent/workspaces" "/var/log/$SERVICE_NAME"
  chown -R "$AGENT_USER:$AGENT_USER" "$AGENT_DIR" "/tmp/deploymate-agent" "/var/log/$SERVICE_NAME"

  # Install from npm or local (in dev, skip)
  # In production: npm install -g @deploymate/agent@latest
  # For now just ensure the directory structure
  info "Agent directory created at $AGENT_DIR"
}

# ─────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────
configure_agent() {
  local token="${AGENT_TOKEN:-}"
  local ws_url="${BACKEND_WS_URL:-}"
  local http_url="${BACKEND_HTTP_URL:-}"

  if [[ -z "$token" ]]; then
    read -rp "Enter your AGENT_TOKEN: " token
  fi
  if [[ -z "$ws_url" ]]; then
    read -rp "Enter backend WebSocket URL (e.g. wss://api.example.com/ws/agents): " ws_url
  fi
  if [[ -z "$http_url" ]]; then
    http_url="${ws_url/wss:/https:}"
    http_url="${http_url/ws:/http:}"
    http_url="${http_url%%/ws/agents}"
  fi

  cat > "$AGENT_DIR/.env" <<EOF
AGENT_TOKEN=$token
BACKEND_WS_URL=$ws_url
BACKEND_HTTP_URL=$http_url
DOCKER_SOCKET_PATH=/var/run/docker.sock
TRAEFIK_NETWORK=traefik-public
WORKSPACE_DIR=/tmp/deploymate-agent/workspaces
LOG_LEVEL=info
NODE_ENV=production
EOF
  chmod 600 "$AGENT_DIR/.env"
  chown "$AGENT_USER:$AGENT_USER" "$AGENT_DIR/.env"
  info "Configuration written to $AGENT_DIR/.env"
}

# ─────────────────────────────────────────────────────────────────────────
# Systemd service
# ─────────────────────────────────────────────────────────────────────────
install_systemd_service() {
  if [[ "$SERVICE_MANAGER" != "systemd" ]]; then return; fi

  cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Deploymate Runtime Agent
Documentation=https://docs.deploymate.io
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=$AGENT_USER
Group=$AGENT_USER
WorkingDirectory=$AGENT_DIR
EnvironmentFile=$AGENT_DIR/.env
ExecStart=/usr/bin/node $AGENT_DIR/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/tmp/deploymate-agent /var/log/$SERVICE_NAME
PrivateTmp=no

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl start "$SERVICE_NAME"
  info "Systemd service installed and started: $SERVICE_NAME"
  info "Check status: systemctl status $SERVICE_NAME"
  info "View logs: journalctl -u $SERVICE_NAME -f"
}

# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────
main() {
  if [[ $EUID -ne 0 ]]; then
    error "This installer must be run as root. Use: sudo bash"
  fi

  info "Deploymate Agent Installer"
  info "=========================="

  detect_os
  detect_service_manager
  install_docker
  install_node
  install_traefik
  install_agent
  configure_agent
  install_systemd_service

  info ""
  info "✓ Deploymate Agent installation complete!"
  info "  Agent will appear in your Deploymate dashboard within 30 seconds."
}

main "$@"
