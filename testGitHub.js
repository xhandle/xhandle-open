/**
 * xHandle: test git hub module.
 * This file provides supporting logic for the xHandle codebase.
 * It participates in the broader local-first architecture by isolating one focused concern that other modules can build on.
 * Related files: src/App.js.
 */

import { getLatestCommits, getFileContent } from "./components/GitHubIntegration.js";

/**
 * testGitHubIntegration encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function testGitHubIntegration() {
    console.log("Testing GitHub API integration...\n");

    // Test commit fetching
    const commits = await getLatestCommits();
    console.log("Latest Commits:", commits);

    // Test file fetching (update the filename to one in your repo)
    const filePath = "index.js";  // Change this to an actual file in your repo
    const fileContent = await getFileContent(filePath);
    console.log(`\nContents of ${filePath}:\n`, fileContent ? fileContent.substring(0, 500) : "File not found.");
}

testGitHubIntegration();
