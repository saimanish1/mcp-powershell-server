# MCP PowerShell Server

A memory-optimized MCP server for executing PowerShell commands on Windows.

## Why This Exists

This server was created to solve a common Windows development issue: many AI coding assistants (like Claude Code) attempt to execute PowerShell commands through Bash on Windows, which fails because Bash doesn't understand PowerShell syntax. This server provides direct PowerShell execution with proper quoting, path handling, and memory optimization.

Instead of fighting with Bash translation layers or constantly reminding the AI to use `cmd.exe`, this MCP server gives AI assistants direct, reliable access to PowerShell with all the Windows-specific features they need.

## Features

- PowerShell-only execution with -EncodedCommand for robust quoting
- Memory optimized with 64KB default output limit, 2MB maximum
- Buffer-based output handling to prevent memory leaks
- Process tree killing with taskkill /t /f
- Timeout protection (default 60 seconds, max 10 minutes)
- Cross-platform MCP client compatibility

## Installation

```bash
npm install
```

## Usage

### Start the server
```bash
node mcp-shell-server.mjs
```

### Configure with MCP clients

Add to your MCP client configuration (e.g., Gemini CLI settings.json):

```json
{
  "mcpServers": {
    "mcp-powershell-server": {
      "command": "node",
      "args": ["path/to/mcp-shell-server/mcp-shell-server.mjs"],
      "env": {
        "MCP_SHELL_EXE": "pwsh.exe"  // Optional: override shell executable
      }
    }
  }
}
```

## Tool: run_shell_command

Execute PowerShell commands with memory and timeout protection.

### Parameters
- `command` (required): PowerShell command/script to execute
- `cwd` (optional): Working directory
- `timeoutMs` (optional): Timeout in milliseconds (max 10 minutes)
- `maxOutputBytes` (optional): Max output bytes per stream (default 64KB, max 2MB)

### Response
```json
{
  "stdout": "...",
  "stderr": "...",
  "exitCode": 0,
  "signal": null,
  "truncated": false,
  "timedOut": false,
  "platform": "win32",
  "shell": "pwsh.exe"
}
```

### Examples

#### List files
```json
{
  "command": "Get-ChildItem -Path ."
}
```

#### Get system information
```json
{
  "command": "Get-ComputerInfo"
}
```

#### With custom timeout and output limit
```json
{
  "command": "Get-Process",
  "timeoutMs": 30000,
  "maxOutputBytes": 128000
}
```

## Memory Optimization

- Default output limit: 64KB per stream
- Maximum output limit: 2MB per stream
- Buffer chunks instead of string concatenation
- Automatic cleanup of event listeners
- Process tree termination on timeout/truncation

## Security Notes

- Commands run with user permissions
- PowerShell ExecutionPolicy bypassed for MCP commands
- Consider implementing command whitelisting for production use
- Use working directory restrictions if needed

## Environment Variables

- `MCP_SHELL_EXE`: Override PowerShell executable (pwsh.exe or powershell.exe)
- Standard environment variables are passed through to child processes

## Requirements

- Node.js 18+
- Windows OS
- PowerShell (pwsh.exe recommended)

## License

MIT
