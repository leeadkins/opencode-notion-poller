import { Client } from "@notionhq/client";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { watchFile } from "fs";
import { writeFile } from "fs/promises";

// Load environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;
const OPENCODE_BASE_URL =
  process.env.OPENCODE_BASE_URL || "http://localhost:4096";
const CHECK_INTERVAL_MINUTES = parseInt(
  process.env.CHECK_INTERVAL_MINUTES || "30",
);
const OPENCODE_AGENT_NAME = process.env.OPENCODE_AGENT_NAME || "OpenCode";
const DEFAULT_REASSIGN_TO = process.env.DEFAULT_REASSIGN_TO || "YourName";
const OPENCODE_MODEL_PROVIDER = process.env.OPENCODE_MODEL_PROVIDER || "google";
const OPENCODE_MODEL_ID =
  process.env.OPENCODE_MODEL_ID || "gemini-3-flash-preview";
const TRIGGER_FILE = process.env.TRIGGER_FILE || ".trigger";

// Parse project mappings
let PROJECT_MAPPINGS: Record<string, string> = {};
try {
  PROJECT_MAPPINGS = JSON.parse(process.env.PROJECT_MAPPINGS || "{}");
} catch (error) {
  console.error("❌ Invalid PROJECT_MAPPINGS JSON format");
  process.exit(1);
}

// Validate required env vars
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("❌ Missing required environment variables!");
  console.error("Please set: NOTION_TOKEN, NOTION_DATABASE_ID");
  process.exit(1);
}

if (Object.keys(PROJECT_MAPPINGS).length === 0) {
  console.error("❌ No project mappings configured!");
  console.error("Please set PROJECT_MAPPINGS in .env");
  process.exit(1);
}

// Initialize clients
const notion = new Client({ auth: NOTION_TOKEN });
const opencode = createOpencodeClient({
  baseUrl: OPENCODE_BASE_URL,
});

interface NotionTask {
  pageId: string;
  title: string;
  status: string;
  agent: string;
  project: string;
  projectPath: string;
  url: string;
}

/**
 * Query Notion database for tasks assigned to OpenCode with Todo status
 */
async function getOpenCodeTasks(): Promise<NotionTask[]> {
  try {
    // First, retrieve the database to get its data source ID
    const database = await notion.databases.retrieve({
      database_id: NOTION_DATABASE_ID,
    });

    // Extract the data source ID from the database
    const dataSourceId = (database as any).data_sources?.[0]?.id;
    if (!dataSourceId) {
      console.error("❌ Could not find data source ID in database");
      return [];
    }

    // Now query the data source
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [
          {
            property: "Status",
            select: {
              equals: "Todo",
            },
          },
          {
            property: "Agent",
            select: {
              equals: OPENCODE_AGENT_NAME,
            },
          },
        ],
      },
    });

    return response.results
      .map((page: any) => {
        const titleProp =
          page.properties.Name ||
          page.properties.Title ||
          page.properties.title;
        const title = titleProp?.title?.[0]?.plain_text || "Untitled";
        const status = page.properties.Status?.select?.name || "Unknown";
        const agent = page.properties.Agent?.select?.name || "Unknown";
        const project = page.properties.Project?.select?.name || "";
        const projectPath = PROJECT_MAPPINGS[project] || "";

        return {
          pageId: page.id,
          title,
          status,
          agent,
          project,
          projectPath,
          url: page.url,
        };
      })
      .filter((task) => {
        // Filter out tasks without a valid project mapping
        if (!task.projectPath) {
          console.warn(
            `⚠️  Skipping task "${task.title}" - no project mapping for "${task.project}"`,
          );
          return false;
        }
        return true;
      });
  } catch (error) {
    console.error("❌ Error querying Notion:", error);
    return [];
  }
}

/**
 * Update Notion page status to "In Progress"
 */
async function markTaskInProgress(pageId: string): Promise<boolean> {
  try {
    // Update status to "In Progress"
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Status: {
          select: {
            name: "In Progress",
          },
        },
      },
    });

    console.log(`✓ Marked task as "In Progress"`);
    return true;
  } catch (error) {
    console.error("❌ Error updating Notion page:", error);
    return false;
  }
}

/**
 * Generate the prompt for the OpenCode agent
 */
function generateAgentPrompt(task: NotionTask, assignBackTo: string): string {
  return `You are working on a task from our Notion task database. Here are the details:

**Task Title:** ${task.title}
**Project:** ${task.project}
**Working Directory:** ${task.projectPath}
**Notion Page URL:** ${task.url}
**Default Assign Back To:** ${assignBackTo}

## FIRST STEP - READ THE NOTION PAGE

Before doing ANYTHING else, you MUST:
1. Use the Notion MCP to fetch the COMPLETE Notion page at: ${task.url}
2. Read ALL the content on the page (not just the title)
3. Read ALL comments on the page to understand full context
4. Only after reading everything, understand what needs to be done

DO NOT make assumptions based on the title alone. The full page content and comments contain the actual requirements.

**CRITICAL:** If you CANNOT load the Notion page using the Notion MCP (e.g., authentication error, page not found, etc.), STOP IMMEDIATELY. Do not try alternative methods. Do not proceed with any work. Just exit the session. The Notion page is essential for understanding what to do.

## Your Mission

After reading the full Notion page and comments, work on completing this task in the project directory: ${task.projectPath}

You have access to a Notion MCP server that allows you to interact with Notion pages.

## CRITICAL RULES

1. **Work in the correct directory.** All your work should be done in: ${task.projectPath}

2. **DO NOT compile, run, or deploy anything.** Your job is to write code, fix bugs, or make changes, but NOT to execute or deploy.

3. **When you're done or reach a stopping point**, you MUST update the Notion page:
   - Use the Notion MCP to update the page at ${task.url}
   - Change the "Agent" property to whoever was requested in the document, or to the default if no one is mentioned to: "${assignBackTo}"
   - Update the "Status" property:
     * Set to "Done" if you've fully completed the task with high confidence
     * Keep as "In Progress" if there's more work to do or you're uncertain
   - Add a detailed comment to the page explaining:
     * What you accomplished
     * What still needs to be done (if anything)
     * Any blockers or questions
     * Current state of the code
     * Any specific instructions for ${assignBackTo} about what to do next

4. **Be thorough in your updates.** The next person (human or agent) needs to understand exactly where things stand.

5. **Task list management.** If you use task lists during your work, make sure to update them in your final comment so we know what's complete and what remains.

## Getting Started

Begin by understanding the task requirements, then proceed with the work in ${task.projectPath}. Remember: your final update to Notion is just as important as the code you write.

Good luck!`;
}

/**
 * Start an OpenCode session for a task
 */
async function startOpenCodeSession(task: NotionTask, assignBackTo: string) {
  try {
    console.log(`🚀 Starting OpenCode session for: "${task.title}"`);
    console.log(`   Project: ${task.project} (${task.projectPath})`);

    // Create a new session
    const sessionResponse = await opencode.session.create({
      body: {
        title: task.title,
      },
    });

    if (sessionResponse.error) {
      console.error("❌ Failed to create session:", sessionResponse.error);
      return;
    }

    const session = sessionResponse.data;
    console.log(`✓ Session created: ${session.id}`);

    // First, send a shell command to change to the project directory
    // This ensures the session starts in the right place
    try {
      await opencode.session.shell({
        path: { id: session.id },
        body: {
          agent: "user", // Required by the SDK
          command: `cd "${task.projectPath}" && pwd`,
        },
      });
      console.log(`✓ Changed directory to ${task.projectPath}`);
    } catch (error) {
      console.warn(`⚠️  Could not change directory:`, error);
    }

    // Send the prompt to the session
    const prompt = generateAgentPrompt(task, assignBackTo);

    const promptResponse = await opencode.session.prompt({
      path: { id: session.id },
      body: {
        model: {
          providerID: OPENCODE_MODEL_PROVIDER,
          modelID: OPENCODE_MODEL_ID,
        },
        parts: [{ type: "text", text: prompt }],
      },
    });

    if (promptResponse.error) {
      console.error("❌ Failed to send prompt:", promptResponse.error);
      return;
    }

    console.log(`✓ Prompt sent to session`);
    console.log(`  Task: ${task.title}`);
    console.log(`  Project: ${task.project}`);
    console.log(`  Working Dir: ${task.projectPath}`);
    console.log(`  Page: ${task.url}`);
    console.log(`  Session ID: ${session.id}`);

    // Note: We're not waiting for the session to complete
    // The agent will update Notion itself when done via Notion MCP
  } catch (error) {
    console.error("❌ Error starting OpenCode session:", error);
  }
}

/**
 * Main processing loop
 */
async function processTasks() {
  console.log("\n" + "=".repeat(60));
  console.log(
    `🔍 Checking for OpenCode tasks... (${new Date().toLocaleString()})`,
  );
  console.log("=".repeat(60));

  const tasks = await getOpenCodeTasks();

  if (tasks.length === 0) {
    console.log("✓ No tasks found assigned to OpenCode with Todo status.");
    return;
  }

  console.log(`📋 Found ${tasks.length} task(s) to process:\n`);

  for (const task of tasks) {
    console.log(`\n📌 Processing: "${task.title}"`);
    console.log(`   Project: ${task.project}`);
    console.log(`   Current Agent: ${task.agent}`);
    console.log(`   Current Status: ${task.status}`);

    // Determine who to reassign to when done
    // TODO: Could read from an optional "Assign To" field in Notion if desired
    const assignBackTo = DEFAULT_REASSIGN_TO;
    console.log(`   Will assign back to: ${assignBackTo}`);

    // Mark as "In Progress" immediately to prevent re-pickup
    const success = await markTaskInProgress(task.pageId);

    if (!success) {
      console.log("⚠️  Could not mark task as In Progress, skipping...");
      continue;
    }

    // Start the OpenCode session
    await startOpenCodeSession(task, assignBackTo);

    console.log("✓ Task handed off to OpenCode agent\n");
  }

  console.log("=".repeat(60));
  console.log("✓ Processing complete");
  console.log("=".repeat(60) + "\n");
}

/**
 * Main entry point
 */
async function main() {
  console.log("🤖 OpenCode-Notion Agent Harness");
  console.log(`⏱️  Check interval: ${CHECK_INTERVAL_MINUTES} minutes`);
  console.log(`📊 Notion Database: ${NOTION_DATABASE_ID}`);
  console.log(`🔗 OpenCode URL: ${OPENCODE_BASE_URL}`);
  console.log(`🤖 Model: ${OPENCODE_MODEL_PROVIDER}/${OPENCODE_MODEL_ID}`);
  console.log(`🎯 Watching for Agent: ${OPENCODE_AGENT_NAME}`);
  console.log(`📁 Project Mappings:`);
  for (const [project, path] of Object.entries(PROJECT_MAPPINGS)) {
    console.log(`   ${project} → ${path}`);
  }
  console.log();

  // Verify OpenCode connection
  try {
    await opencode.session.list();
    console.log("✓ Connected to OpenCode server\n");
  } catch (error) {
    console.error(
      "❌ Could not connect to OpenCode server at",
      OPENCODE_BASE_URL,
    );
    console.error("   Make sure OpenCode is running!");
    process.exit(1);
  }

  // Create the trigger file if it doesn't exist
  try {
    await writeFile(TRIGGER_FILE, new Date().toISOString() + "\n", {
      flag: "a",
    });
    console.log(`✓ Trigger file ready: ${TRIGGER_FILE}\n`);
  } catch (error) {
    console.warn("⚠️  Could not create trigger file:", error);
  }

  // Set up file watcher for immediate triggers
  let isProcessing = false;
  let lastMtime = 0;

  console.log(`👀 Watching trigger file: ${TRIGGER_FILE}`);
  console.log(
    `   Tip: Run 'touch ${TRIGGER_FILE}' to trigger immediate check\n`,
  );

  watchFile(TRIGGER_FILE, { interval: 1000 }, async (curr, prev) => {
    // Check if file was modified (mtime changed)
    if (
      curr.mtimeMs !== lastMtime &&
      curr.mtimeMs > prev.mtimeMs &&
      !isProcessing
    ) {
      lastMtime = curr.mtimeMs;
      isProcessing = true;
      console.log(
        `\n🔔 Trigger file modified (${new Date(curr.mtime).toLocaleTimeString()}) - running immediate check...\n`,
      );
      await processTasks();
      isProcessing = false;
    }
  });

  // Run immediately on startup
  await processTasks();

  // Then run on interval
  const intervalMs = CHECK_INTERVAL_MINUTES * 60 * 1000;
  setInterval(async () => {
    await processTasks();
  }, intervalMs);

  console.log(
    `⏰ Scheduled to check every ${CHECK_INTERVAL_MINUTES} minutes...`,
  );
  console.log(`💡 Or touch '${TRIGGER_FILE}' anytime to trigger immediately`);
}

// Start the harness
main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
