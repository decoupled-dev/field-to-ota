#!/usr/bin/env bash
# setup-mcp.sh — configure MCP servers for field-to-fix in Kiro
# Run once after cloning. Writes .kiro/settings/mcp.json.
# Requires: uvx (uv), npx (Node 18+).
# Optional env vars: AWS_REGION (default: aws configure region, else ap-southeast-2), GITHUB_PERSONAL_ACCESS_TOKEN, JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SETTINGS="$ROOT/.kiro/settings"

mkdir -p "$SETTINGS"

# Resolve uvx path
UVX=$(which uvx 2>/dev/null || echo "$HOME/.local/bin/uvx")
if ! "$UVX" --version >/dev/null 2>&1; then
  echo "uvx not found. Installing uv..."
  pip install uv --break-system-packages || pip install uv
  UVX="$HOME/.local/bin/uvx"
fi
echo "Using uvx: $UVX"

GH_TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-}"
JIRA_URL="${JIRA_URL:-}"
JIRA_USER="${JIRA_EMAIL:-}"
JIRA_TOK="${JIRA_API_TOKEN:-}"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo ap-southeast-2)}"

cat > "$SETTINGS/mcp.json" << MCPEOF
{
  "mcpServers": {
    "aws-core": {
      "command": "$UVX",
      "args": ["awslabs.core-mcp-server@latest"],
      "env": {
        "AWS_REGION": "$REGION",
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false
    },
    "aws-docs": {
      "command": "$UVX",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false
    },
    "bedrock-kb": {
      "command": "$UVX",
      "args": ["awslabs.bedrock-kb-retrieval-mcp-server@latest"],
      "env": {
        "AWS_REGION": "$REGION",
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false
    },
    "aws-iot": {
      "command": "$UVX",
      "args": ["awslabs.iot-twinmaker-mcp-server@latest"],
      "env": {
        "AWS_REGION": "$REGION",
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false
    },
    "aws-diagram": {
      "command": "$UVX",
      "args": ["awslabs.aws-diagram-mcp-server@latest"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "$GH_TOKEN"
      },
      "disabled": false
    },
    "jira": {
      "command": "npx",
      "args": ["-y", "@sooperset/mcp-atlassian"],
      "env": {
        "JIRA_URL": "$JIRA_URL",
        "JIRA_USERNAME": "$JIRA_USER",
        "JIRA_API_TOKEN": "$JIRA_TOK"
      },
      "disabled": false
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "$ROOT"],
      "disabled": false
    }
  }
}
MCPEOF

echo "✓ Written $SETTINGS/mcp.json"
echo ""
echo "Reconnect MCP servers in Kiro: Command Palette → 'MCP: Reconnect All Servers'"
echo "Or open the Kiro feature panel → MCP Server view."
