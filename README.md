# OpenCode-Notion Agent Harness

> STATUS: This is a huge hack for a very specific setup I'm experimenting with. Your mileage may vary.

Automated task management system that connects Notion databases with OpenCode AI agents. This harness continuously monitors a Notion database for tasks assigned to "OpenCode" and automatically creates OpenCode AI sessions to work on them.

## How It Works

1. **Every 30 minutes** (or when manually triggered), the harness checks your Notion database
2. **Finds tasks** with `Status="Todo"` AND `Agent="OpenCode"` and a valid `Project`
3. **Locks the task** by updating `Status` to `"In Progress"` (prevents duplicate work)
4. **Starts an OpenCode session** with detailed instructions for the agent
5. **The agent** (with Notion MCP access) works on the task and updates Notion when done:
   - Reads the full Notion page and all comments first
   - Works in the correct project directory
   - Reassigns `Agent` back to a configured person (default: see `DEFAULT_REASSIGN_TO`)
   - Sets `Status` to "Done" (if complete) or keeps "In Progress"
   - Adds detailed comments about progress and remaining work

## Prerequisites

- [Bun](https://bun.sh) installed
- [OpenCode](https://opencode.ai) running locally (`opencode serve`)
- A Notion integration with access to your task database
- Notion MCP configured in your OpenCode server

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Create Notion Integration

1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Give it a name (e.g., "OpenCode Harness")
4. Copy the **Internal Integration Token** - this is your `NOTION_TOKEN`

### 3. Set Up Your Notion Database

Your Notion database must have these properties:

| Property | Type | Values | Purpose |
|----------|------|--------|---------|
| **Name** or **Title** | Title | Any text | The task description |
| **Status** | Select | "Inbox", "Todo", "In Progress", "Done" | Task status |
| **Agent** | Select | "OpenCode", "Alice", "Bob", etc. | Who is working on it |
| **Project** | Select | "Mobile", "Service", etc. | Which codebase to work in |

**Important:** Make sure to **share your database** with your integration:
- Open your database in Notion
- Click `•••` (more options) in the top-right
- Click "Connections" → Add your integration

### 4. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then edit `.env` with your values:

```bash
# Notion credentials
NOTION_TOKEN=secret_xxxxxxxxxxxxxxxxxxxxx
NOTION_DATABASE_ID=12345678-90ab-cdef-1234-567890abcdef

# OpenCode configuration
OPENCODE_BASE_URL=http://localhost:4096
OPENCODE_MODEL_PROVIDER=google
OPENCODE_MODEL_ID=gemini-3-flash-preview

# Task assignment
OPENCODE_AGENT_NAME=OpenCode
DEFAULT_REASSIGN_TO=YourName

# Timing
CHECK_INTERVAL_MINUTES=30
TRIGGER_FILE=.trigger

# Project mappings (JSON format)
PROJECT_MAPPINGS={"Mobile":"/Users/you/work/mobile-app","Service":"/Users/you/work/backend"}
```

**Finding your Database ID:**
- Open your database in Notion
- Copy the URL - it looks like: `https://notion.so/workspace/XXXXXX?v=YYYYYY`
- The database ID is the part after the last `/` and before the `?`
- If it's missing dashes, add them: `1234567890abcdef12345678` → `12345678-90ab-cdef-1234-567890abcdef`

### 5. Start OpenCode Server

Make sure OpenCode is running with Notion MCP configured:

```bash
opencode serve
```

The server should be accessible at `http://localhost:4096`.

**Configure Notion MCP** in your OpenCode settings so agents can read/update Notion pages.

### 6. Run the Harness

```bash
bun start
```

You should see:
```
🤖 OpenCode-Notion Agent Harness
⏱️  Check interval: 30 minutes
📊 Notion Database: 12345678-90ab-cdef-1234-567890abcdef
🔗 OpenCode URL: http://localhost:4096
🤖 Model: google/gemini-3-flash-preview
🎯 Watching for Agent: OpenCode
📁 Project Mappings:
   Mobile → /Users/you/work/mobile-app
   Service → /Users/you/work/backend

✓ Connected to OpenCode server
✓ Trigger file ready: .trigger

👀 Watching trigger file: .trigger
   Tip: Run 'touch .trigger' to trigger immediate check
```

## Usage

### Creating Tasks for OpenCode

1. Create or open a task in your Notion database
2. Set **Status** to `"Todo"`
3. Set **Agent** to `"OpenCode"`
4. Set **Project** to one of your configured projects (e.g., "Mobile")
5. Fill in the task details in the page content and comments

The harness will pick it up on the next check (or when you trigger it manually).

### Manual Triggering

To trigger an immediate check without waiting for the interval:

```bash
touch .trigger
```

This is useful for:
- Testing
- Integrating with other systems
- Forcing an immediate check after creating a task

### What the Agent Does

When OpenCode picks up a task, it will:

1. **Read the full Notion page** and all comments (not just the title!)
2. **Change to the correct project directory**
3. **Work on the task** following these rules:
   - ❌ Does NOT compile, run, or deploy code
   - ✅ Makes code changes, fixes bugs, adds features
   - ✅ Reads the full context before starting
   - ✅ Stops immediately if it can't access the Notion page
4. **Update the Notion page** when done:
   - Changes **Agent** back to the configured person (e.g., "Alice")
   - Sets **Status** to "Done" or keeps as "In Progress"
   - Adds a detailed comment explaining what was done and what remains

## Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `NOTION_TOKEN` | *required* | Your Notion integration token |
| `NOTION_DATABASE_ID` | *required* | The ID of your task database |
| `OPENCODE_BASE_URL` | `http://localhost:4096` | URL of your OpenCode server |
| `OPENCODE_MODEL_PROVIDER` | `google` | Model provider (e.g., "google", "anthropic") |
| `OPENCODE_MODEL_ID` | `gemini-3-flash-preview` | Model ID to use for sessions |
| `OPENCODE_AGENT_NAME` | `OpenCode` | Agent name to watch for in Notion |
| `DEFAULT_REASSIGN_TO` | `YourName` | Who to reassign tasks to when complete |
| `CHECK_INTERVAL_MINUTES` | `30` | How often to check for new tasks |
| `TRIGGER_FILE` | `.trigger` | File to watch for manual triggers |
| `PROJECT_MAPPINGS` | *required* | JSON mapping of project names to paths |

## Safety Features

- **Task locking**: Tasks are marked "In Progress" immediately to prevent duplicate sessions
- **No execution**: Agent is strictly instructed NOT to compile, run, or deploy code
- **Read-first policy**: Agent must read the full Notion page before starting work
- **Fail-fast**: Agent stops immediately if it can't access the Notion page
- **Detailed updates**: Agent must provide comprehensive progress comments
- **Project isolation**: Each task works in its designated project directory

## Troubleshooting

### No tasks found
- Verify tasks have `Status="Todo"` AND `Agent="OpenCode"` AND a valid `Project`
- Check that the project name matches your `PROJECT_MAPPINGS`
- Make sure the database is shared with your integration

### Permission errors
- Ensure your Notion integration has access to the database
- Click `•••` → "Connections" in your database and add the integration

### Can't connect to OpenCode
- Make sure OpenCode is running: `opencode serve`
- Check that `OPENCODE_BASE_URL` matches your OpenCode server URL
- Verify the server is accessible: `curl http://localhost:4096`

### Notion authentication errors
- The Notion MCP may need to be re-authenticated
- Check your Notion MCP configuration in OpenCode
- Make sure the integration token is still valid

### Agent doesn't update Notion
- Verify the Notion MCP is properly configured in OpenCode
- Check that the agent has access to the Notion page URL
- Look at the OpenCode session logs for errors

## Development

Run in development mode with auto-reload:

```bash
bun dev
```

Run TypeScript type checking:

```bash
bunx tsc --noEmit
```

## Architecture

```
┌─────────────────┐
│  Notion         │
│  Database       │
│  (Tasks)        │
└────────┬────────┘
         │
         │ Query every 30min
         │ or on trigger
         ↓
┌─────────────────┐
│  Harness        │◄─── touch .trigger
│  (This Script)  │
└────────┬────────┘
         │
         │ Create sessions
         │ with instructions
         ↓
┌─────────────────┐      ┌─────────────────┐
│  OpenCode       │◄────►│  Notion MCP     │
│  Server         │      │  (Read/Write)   │
└────────┬────────┘      └─────────────────┘
         │
         │ Works in
         ↓
┌─────────────────┐
│  Project        │
│  Directory      │
│  (Code)         │
└─────────────────┘
```

## License

MIT
