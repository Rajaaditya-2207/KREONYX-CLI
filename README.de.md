<p align="center">
  <picture>
      <source srcset="packages/console/app/src/asset/lander/kreonyx-logo-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/lander/kreonyx-logo-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/lander/kreonyx-logo-light.svg" alt="KREONYX CLI logo">
  </picture>
</p>
<p align="center">Der Open-Source KI-Coding-Agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/kreonyx"><img alt="npm" src="https://img.shields.io/npm/v/kreonyx?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/kreonyx/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/kreonyx/publish.yml?style=flat-square&branch=dev" /></a>
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

# Paketmanager
npm i -g kreonyx@latest        # oder bun/pnpm/yarn
scoop install kreonyx             # Windows
choco install kreonyx             # Windows
brew install anomalyco/tap/kreonyx # macOS und Linux (empfohlen, immer aktuell)
brew install kreonyx              # macOS und Linux (offizielle Brew-Formula, seltener aktualisiert)
sudo pacman -S kreonyx            # Arch Linux (Stable)
paru -S kreonyx-bin               # Arch Linux (Latest from AUR)
mise use -g kreonyx               # jedes Betriebssystem
nix run nixpkgs#kreonyx           # oder github:anomalyco/kreonyx für den neuesten dev-Branch
```

> [!TIP]
> Entferne Versionen älter als 0.1.x vor der Installation.

### Desktop-App (BETA)

KREONYX CLI ist auch als Desktop-Anwendung verfügbar. Lade sie direkt von der [Releases-Seite](https://github.com/anomalyco/kreonyx/releases) oder [opencode.ai/download](https://opencode.ai/download) herunter.

| Plattform             | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `kreonyx-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `kreonyx-desktop-darwin-x64.dmg`     |
| Windows               | `kreonyx-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` oder AppImage          |

```bash
# macOS (Homebrew)
brew install --cask kreonyx-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/kreonyx-desktop
```

#### Installationsverzeichnis

Das Installationsskript beachtet die folgende Prioritätsreihenfolge für den Installationspfad:

1. `$OPENCODE_INSTALL_DIR` - Benutzerdefiniertes Installationsverzeichnis
2. `$XDG_BIN_DIR` - XDG Base Directory Specification-konformer Pfad
3. `$HOME/bin` - Standard-Binärverzeichnis des Users (falls vorhanden oder erstellbar)
4. `$HOME/.kreonyx/bin` - Standard-Fallback

```bash
# Beispiele
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

KREONYX CLI enthält zwei eingebaute Agents, zwischen denen du mit der `Tab`-Taste wechseln kannst.

- **build** - Standard-Agent mit vollem Zugriff für Entwicklungsarbeit
- **plan** - Nur-Lese-Agent für Analyse und Code-Exploration
  - Verweigert Datei-Edits standardmäßig
  - Fragt vor dem Ausführen von bash-Befehlen nach
  - Ideal zum Erkunden unbekannter Codebases oder zum Planen von Änderungen

Außerdem ist ein **general**-Subagent für komplexe Suchen und mehrstufige Aufgaben enthalten.
Dieser wird intern genutzt und kann in Nachrichten mit `@general` aufgerufen werden.

Mehr dazu unter [Agents](https://opencode.ai/docs/agents).

### Dokumentation

Mehr Infos zur Konfiguration von KREONYX CLI findest du in unseren [**Docs**](https://opencode.ai/docs).

### Beitragen

Wenn du zu KREONYX CLI beitragen möchtest, lies bitte unsere [Contributing Docs](./CONTRIBUTING.md), bevor du einen Pull Request einreichst.

### Auf KREONYX CLI aufbauen

Wenn du an einem Projekt arbeitest, das mit KREONYX CLI zusammenhängt und "kreonyx" als Teil seines Namens verwendet (z.B. "kreonyx-dashboard" oder "kreonyx-mobile"), füge bitte einen Hinweis in deine README ein, dass es nicht vom KREONYX CLI-Team gebaut wird und nicht in irgendeiner Weise mit uns verbunden ist.

### FAQ

#### Worin unterscheidet sich das von Claude Code?

In Bezug auf die Fähigkeiten ist es Claude Code sehr ähnlich. Hier sind die wichtigsten Unterschiede:

- 100% open source
- Nicht an einen Anbieter gekoppelt. Wir empfehlen die Modelle aus [KREONYX CLI Zen](https://opencode.ai/zen); KREONYX CLI kann aber auch mit Claude, OpenAI, Google oder sogar lokalen Modellen genutzt werden. Mit der Weiterentwicklung der Modelle werden die Unterschiede kleiner und die Preise sinken, deshalb ist Provider-Unabhängigkeit wichtig.
- LSP-Unterstützung direkt nach dem Start
- Fokus auf TUI. KREONYX CLI wird von Neovim-Nutzern und den Machern von [terminal.shop](https://terminal.shop) gebaut; wir treiben die Grenzen dessen, was im Terminal möglich ist.
- Client/Server-Architektur. Das ermöglicht z.B., KREONYX CLI auf deinem Computer laufen zu lassen, während du es von einer mobilen App aus fernsteuerst. Das TUI-Frontend ist nur einer der möglichen Clients.

---

**Tritt unserer Community bei** [Discord](https://discord.gg/kreonyx) | [X.com](https://x.com/kreonyx)
