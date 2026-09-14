import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import nodeTest from "node:test";

type Command = { tool: string; args: string[]; cwd: string; archive?: string };

// On Windows, `bash` resolves to the WSL launcher stub, which never completes without a WSL
// distribution installed, so locate the POSIX shell that ships with Git for Windows instead.
function findBash() {
  if (process.platform !== "win32") return "bash";
  const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]];
  const localPrograms = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs");
  return [...roots, localPrograms]
    .filter((root): root is string => Boolean(root))
    .map(root => path.join(root, "Git", "bin", "bash.exe"))
    .find(existsSync);
}

// Packaging falls back to the bsdtar bundled with Windows when the zip command is unavailable.
function hasSystemArchiver() {
  const root = process.env.SYSTEMROOT ?? process.env.SystemRoot;
  if (process.platform === "win32" && root && existsSync(path.join(root, "System32", "tar.exe"))) return true;
  return !spawnSync("zip", ["-h"], { encoding: "utf8" }).error;
}

const bash = findBash();
const test = bash ? nodeTest : nodeTest.skip;
const archiveTest = bash && hasSystemArchiver() ? nodeTest : nodeTest.skip;

// Git Bash needs POSIX paths (`C:\dir` becomes `/c/dir`) for its own shell and utilities.
const shellPath = (value: string) =>
  process.platform === "win32" ? `/${value.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1")}` : value;

function runDeployment(args: string[], values: Record<string, string> = {}, failCommand = "", omitTools: string[] = []) {
  const directory = mkdtempSync(path.join(tmpdir(), "webapp-deploy-test-"));
  const repository = path.join(directory, "repository");
  const tools = path.join(directory, "tools");
  const log = path.join(directory, "commands.jsonl");
  const parameters = Object.fromEntries(Object.entries({
    environmentName: "test-app",
    location: "eastus2",
    foundryProjectName: "test-project",
    foundryProjectEndpoint: "https://example.services.ai.azure.com/api/projects/test-project",
    foundryAgentName: "test-agent",
    ...values,
  }).map(([name, value]) => [name, { value }]));

  try {
    for (const folder of ["infra", "build/server", "dist"]) {
      mkdirSync(path.join(repository, folder), { recursive: true });
    }
    mkdirSync(tools);
    copyFileSync(new URL("./deploy.sh", import.meta.url), path.join(repository, "infra/deploy.sh"));
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(new URL(`../${file}`, import.meta.url), path.join(repository, file));
    }
    writeFileSync(path.join(repository, ".env"), "DO_NOT_PACKAGE=true\n");
    writeFileSync(path.join(repository, "build/server/index.js"), "console.log('compiled server');\n");
    writeFileSync(path.join(repository, "dist/index.html"), "<html></html>\n");
    writeFileSync(path.join(repository, "infra/main.bicepparam"), "using './main.bicep'\n");
    writeFileSync(path.join(directory, "custom parameters.bicepparam"), "using './repository/infra/main.bicep'\n");

    const mockTool = `#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const record = { tool, args, cwd: process.cwd() };
const source = args.indexOf('--src-path');
if (source >= 0 && fs.existsSync(args[source + 1])) record.archive = fs.readFileSync(args[source + 1]).subarray(0, 2).toString('latin1');
fs.appendFileSync(process.env.DEPLOY_TEST_LOG, JSON.stringify(record) + '\\n');
if (process.env.DEPLOY_TEST_FAIL && (tool + ':' + args.join(' ')).startsWith(process.env.DEPLOY_TEST_FAIL)) process.exit(1);
if (tool === 'az') {
  const command = args.slice(0, 3).join(' ');
  if (command === 'bicep build-params --file') {
    fs.writeFileSync(args[args.indexOf('--outfile') + 1], process.env.DEPLOY_TEST_PARAMETERS);
  } else if (command === 'deployment sub create') {
    console.log(JSON.stringify({
      resourceGroupName: { value: 'rg-test-app' },
      webAppName: { value: 'app-test-app-unique' },
      widgetUrl: { value: 'https://app-test-app-unique.azurewebsites.net' },
      embedScript: { value: '<script src="https://app-test-app-unique.azurewebsites.net/treasurer-chat.js" defer></script>' },
    }));
  } else {
    assert.ok(['account show', 'bicep version', 'deployment sub what-if', 'deployment sub validate', 'provider register', 'webapp deploy'].some(prefix => args.join(' ').startsWith(prefix)), 'unexpected Azure command');
  }
} else if (tool === 'npm' && args.includes('--prefix')) {
  assert.ok(args.includes('--omit=dev'));
  fs.mkdirSync(path.join(args[args.indexOf('--prefix') + 1], 'node_modules'));
} else if (tool === 'zip') {
  const files = ['package.json', 'package-lock.json', 'build', 'dist', 'node_modules'];
  assert.deepEqual(args.slice(2), files);
  assert.deepEqual(fs.readdirSync(process.cwd()).sort(), files.sort());
  assert.ok(fs.existsSync('build/server/index.js'));
  assert.ok(fs.existsSync('dist/index.html'));
  fs.writeFileSync(args[1], 'mock archive');
}
`;
    for (const tool of ["az", "npm", "zip", "curl"].filter(name => !omitTools.includes(name))) {
      writeFileSync(path.join(tools, tool), mockTool, { mode: 0o755 });
    }

    // Git Bash prepends its own /usr/bin and /mingw64/bin to PATH at startup, which would shadow
    // mocked tools such as curl, so the mock directory is put first from inside the shell.
    const launch = ['export PATH="$1:$PATH"; shift; exec "$@"', "bash", shellPath(tools)];
    const result = spawnSync(bash!, ["-c", ...launch, shellPath(path.join(repository, "infra/deploy.sh")), ...args], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${tools}${path.delimiter}${process.env.PATH}`,
        TMPDIR: shellPath(directory),
        DEPLOY_TEST_LOG: log,
        DEPLOY_TEST_PARAMETERS: JSON.stringify({ parameters }),
        DEPLOY_TEST_FAIL: failCommand,
      },
      encoding: "utf8",
      timeout: 120000,
    });
    assert.ifError(result.error);
    const commands: Command[] = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    return { ...result, commands, directory, repository };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("preview uses default parameters without building or changing Azure resources", () => {
  const result = runDeployment(["test-subscription", "--what-if"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.commands.every(command => command.tool === "az"));
  const preview = result.commands.find(command => command.args.includes("what-if"));
  assert.ok(preview);
  assert.ok(!preview.args.some(argument => argument.startsWith("deployApplication=")));
  assert.ok(!result.commands.some(command => command.args.includes("create") || command.args.includes("register")));
  const compilation = result.commands.find(command => command.args.includes("build-params"));
  assert.ok(compilation?.args.includes(path.join(result.repository, "infra/main.bicepparam")));
});

test("deployment builds before provisioning and uploads an allowlisted production package", () => {
  const result = runDeployment(["test-subscription"]);
  assert.equal(result.status, 0, result.stderr);
  const calls = result.commands.map(command => `${command.tool} ${command.args.join(" ")}`);
  const registration = calls.findIndex(command => command.startsWith("az provider register"));
  const preflight = calls.findIndex(command => command.startsWith("az deployment sub validate"));
  assert.ok(registration >= 0 && preflight > registration);
  assert.ok(preflight < calls.indexOf("npm ci --include=dev"));
  assert.ok(calls.indexOf("npm run build") < calls.findIndex(command => command.startsWith("az deployment sub create")));
  assert.ok(calls.includes("npm test"));
  assert.ok(calls.includes("npm run lint"));
  assert.equal(calls.filter(command => command.startsWith("az deployment sub create")).length, 1);
  const upload = result.commands.find(command => command.tool === "az" && command.args[0] === "webapp");
  assert.ok(upload?.args.includes("app-test-app-unique"));
  assert.ok(upload.args.includes("rg-test-app"));
  assert.ok(upload.args.includes("zip"));
  assert.ok(result.commands.filter(command => command.tool === "az" && command.args[0] !== "bicep").every(command => command.args.includes("test-subscription")));
  assert.match(result.stdout, /Foundry connectivity check passed/);
  assert.equal(result.commands.at(-1)?.tool, "curl");
});

archiveTest("packages a real ZIP when the zip command is unavailable", () => {
  const result = runDeployment(["test-subscription"], {}, "", ["zip"]);
  assert.equal(result.status, 0, result.stderr);
  const upload = result.commands.find(command => command.tool === "az" && command.args[0] === "webapp");
  assert.equal(upload?.archive, "PK");
});

test("custom parameter paths resolve from the caller's directory, including spaces", () => {
  const result = runDeployment(["test-subscription", "custom parameters.bicepparam", "--what-if"]);
  assert.equal(result.status, 0, result.stderr);
  const compilation = result.commands.find(command => command.args.includes("build-params"));
  assert.ok(compilation?.args.includes(path.join(result.directory, "custom parameters.bicepparam")));
});

for (const [name, values] of Object.entries({
  placeholders: { foundryAgentName: "REPLACE_WITH_AGENT" },
  "invalid names": { environmentName: "Invalid_Name" },
  "mismatched endpoints": { foundryProjectEndpoint: "https://example.services.ai.azure.com/api/projects/other" },
})) {
  test(`invalid parameters reject ${name} before any Azure changes`, () => {
    const result = runDeployment(["test-subscription"], values);
    assert.equal(result.status, 1);
    assert.ok(result.commands.every(command => command.tool === "az" && ["account", "bicep"].includes(command.args[0])));
  });
}

test("failed Azure preflight stops before building or deploying and explains quota recovery", () => {
  const result = runDeployment(["test-subscription"], {}, "az:deployment sub validate");
  assert.equal(result.status, 1);
  assert.ok(result.commands.every(command => command.tool === "az"));
  assert.ok(!result.commands.some(command => command.args.includes("create") || command.args.includes("deploy")));
  assert.match(result.stderr, /Azure preflight failed; the app was not built or deployed/);
  assert.match(result.stderr, /App Service B1 quota in eastus2 for subscription test-subscription/);
  assert.match(result.stderr, /After the quota is approved/);
  const preflight = result.commands.at(-1);
  assert.ok(preflight?.args.includes("infra/main.bicep"));
  assert.ok(preflight.args.includes("eastus2"));
  assert.ok(preflight.args.some(argument => argument.startsWith("@") && argument.endsWith("parameters.json")));
});

test("failed local checks prevent provisioning and upload", () => {
  const result = runDeployment(["test-subscription"], {}, "npm:run lint");
  assert.equal(result.status, 1);
  assert.ok(!result.commands.some(command => command.args.includes("create") || command.args.includes("deploy")));
});

test("failed uploads stop before the connectivity check", () => {
  const result = runDeployment(["test-subscription"], {}, "az:webapp deploy");
  assert.equal(result.status, 1);
  assert.ok(!result.commands.some(command => command.tool === "curl"));
});

test("failed Foundry checks report that hosting deployed and explain how to recheck", () => {
  const result = runDeployment(["test-subscription"], {}, "curl:");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Web App was deployed, but the Foundry check failed/);
  assert.match(result.stderr, /Recheck with: curl --fail https:\/\/app-test-app-unique.azurewebsites.net\/api\/status/);
});