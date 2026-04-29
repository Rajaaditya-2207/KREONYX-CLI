<p align="center">
  <picture>
      <source srcset="packages/console/app/src/asset/lander/kreonyx-logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/lander/kreonyx-logo-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/lander/kreonyx-logo-light.svg" alt="KREONYX CLI logo">
  </picture>
</p>
<p align="center">The KREONYX CLI — AI-powered coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/kreonyx"><img alt="npm" src="https://img.shields.io/npm/v/kreonyx?style=flat-square" /></a>
  <a href="https://github.com/Rajaaditya-2207/kreonyx/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Rajaaditya-2207/kreonyx/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a>
</p>

[![KREONYX CLI Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g kreonyx@latest        # or bun/pnpm/yarn
scoop install kreonyx             # Windows
choco install kreonyx             # Windows
brew install anomalyco/tap/kreonyx # macOS and Linux (recommended, always up to date)
brew install kreonyx              # macOS and Linux (official brew formula, updated less)
sudo pacman -S kreonyx            # Arch Linux (Stable)
paru -S kreonyx-bin               # Arch Linux (Latest from AUR)
mise use -g kreonyx               # Any OS
nix run nixpkgs#kreonyx           # or github:Rajaaditya-2207/kreonyx for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

KREONYX CLI is also available as a desktop application. Download directly from the [releases page](https://github.com/Rajaaditya-2207/kreonyx/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                             |
| --------------------- | ------------------------------------ |
| macOS (Apple Silicon) | `kreonyx-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `kreonyx-desktop-darwin-x64.dmg`     |
| Windows               | `kreonyx-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage          |

```bash
# macOS (Homebrew)
brew install --cask kreonyx-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/kreonyx-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.kreonyx/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

KREONYX CLI includes multiple built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes
- **orchestrator** - Multi-agent coordinator for collaborative tasks
  - Creates and manages collaboration sessions
  - Coordinates debates, votes, code reviews, and distributed tasks
  - Uses MapReduce for parallel file processing
  - See [Multi-Agent Collaboration](#multi-agent-collaboration) below

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Multi-Agent Collaboration

KREONYX CLI supports multi-agent collaboration through the orchestrator agent, enabling teams of specialized agents to work together on complex tasks.

**Features:**

- **Collaboration Sessions** - Create sessions with multiple participating agents
- **Debates** - Structured multi-round discussions on implementation approaches
- **Voting** - Multiple strategies: majority, unanimous, weighted, and ranked
- **Code Reviews** - PR-like review cycles with comments, approvals, and change requests
- **MapReduce Jobs** - Distribute tasks across agents with parallel processing
- **Shared Workspace** - Common memory and filesystem for coordination

**CLI Commands:**

```bash
kreonyx orchestrator:create-session    # Create new collaboration session
kreonyx orchestrator:status            # View session status
kreonyx orchestrator:debate            # Start a debate
kreonyx orchestrator:vote              # Create a voting proposal
kreonyx orchestrator:review            # Request code review
kreonyx orchestrator:map-reduce        # Create distributed task
```

**Example Workflow:**

```typescript
// 1. Create session
const session = await Orchestrator.createSession(orchestratorAgent, {
  title: "Feature Implementation",
  participants: ["implementer", "reviewer", "debater"]
})

// 2. Debate implementation approach
const debate = await Orchestrator.createDebate(session.id, initiator, {
  topic: "REST vs GraphQL",
  participants: ["debater-1", "debater-2"],
  format: "structured",
  maxRounds: 3
})

// 3. Vote on decision
const vote = await Orchestrator.createVote(session.id, proposer, {
  title: "Choose API style",
  options: [{ id: "rest", label: "REST" }, { id: "graphql", label: "GraphQL" }],
  votingStrategy: "majority"
})

// 4. Distribute implementation
const job = await Orchestrator.createMapReduceJob(session.id, orchestrator, {
  title: "Implement endpoints",
  inputs: ["auth.ts", "users.ts", "posts.ts"],
  mapper: "implementer",
  reducer: "integrator"
})

// 5. Request review
const review = await Orchestrator.requestReview(session.id, submitter, {
  title: "Review implementation",
  artifacts: [...],
  reviewers: ["reviewer-1"]
})
```

Learn more about [multi-agent collaboration](./docs/collaboration.md).

### Documentation

For more info on how to configure KREONYX CLI, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to KREONYX CLI, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on KREONYX CLI

If you are working on a project that's related to KREONYX CLI and is using "kreonyx" as part of its name, for example "kreonyx-dashboard" or "kreonyx-mobile", please add a note to your README to clarify that it is not built by the KREONYX CLI team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [KREONYX Zen](https://opencode.ai/zen), KREONYX CLI can be used with Claude, OpenAI, Google, or even local models. As models evolve, the gaps between them will close and pricing will drop, so being provider-agnostic is important.
- Out-of-the-box LSP support
- A focus on TUI. KREONYX CLI is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This, for example, can allow KREONYX CLI to run on your computer while you drive it remotely from a mobile app, meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/kreonyx) | [X.com](https://x.com/kreonyx)
